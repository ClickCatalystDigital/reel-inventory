// utils/quickbooks-sync.js — QuickBooks Online Phase 2, sales side (North American public demo only): partner-store
// sales invoices (sales_invoices) go to QuickBooks as Invoices, payments received (Receipt rows in crm_tally_bank_txns,
// written by the books sync, not by this app) as Payments. An invoice is sent in the background when it is final (no
// line without a rate: right after it is created and after each save, routes/sales-invoices.js); a failure is kept with
// its reason and shown on the invoice and in the QuickBooks card with Retry (POST /api/quickbooks/send).
// The app records no payments itself, so there is no "payment recorded" moment to hook: payments go with Send/Retry.
// A payment is linked to our invoice when its bill_refs name one; otherwise it goes in unapplied (a credit on the customer).
//
// History: one document per site in R2 (loadSyncDoc), keyed by number + fingerprint so the nightly reset never
// re-sends seeded invoices nor mistakes a new invoice for an old one:
//   { realm_id, item_id, customers: {name: qboId}, invoices: {key: entry}, receipts: {key: entry} }
//   entry = { no, status: 'sent'|'failed', qbo_id, qbo_doc, ours, theirs, error, at }
// `site` is the request's host (req.get('host')), passed down: no per-request globals.
// ponytail: one document per site, rewritten on every send; split it per record if it ever outgrows a demo.
const { queryOne, queryAll } = require('../db/schema');
const runInBackground = require('./background');
const { qboConfig, qboCall, qboGet, connectionStatus, loadSyncDoc, saveSyncDoc } = require('./quickbooks');
const { fingerprint, syncKey, requestId, customerQuery, itemQuery, buildCustomer, buildInvoice, buildPayment } = require('./quickbooks-core');

const ITEM_NAME = 'Component sales';
const invoiceFp = (head) => fingerprint(head.invoice_date, head.customer_name);
const receiptFp = (r) => fingerprint(r.date, Math.abs(r.amount), r.party_name);
const receiptKey = (r) => syncKey(r.voucher_no, receiptFp(r));
const lazy = () => require('../routes/sales-invoices'); // loaded on use: that route requires this file

async function freshDoc(site, realm) {
  const rec = await loadSyncDoc(site);
  const data = rec?.data?.realm_id === realm ? rec.data : { realm_id: realm, customers: {}, invoices: {}, receipts: {} };
  return { data, version: rec?.version };
}
// Read-modify-write of the history with compare-and-set; `change` mutates data.
async function updateDoc(site, realm, change) {
  for (let i = 0; i < 4; i++) {
    const { data, version } = await freshDoc(site, realm);
    change(data);
    if (await saveSyncDoc(site, data, version)) return data;
  }
  throw new Error('Could not save the QuickBooks send history; try again');
}
async function connected(site) {
  if (!qboConfig()) throw new Error('QuickBooks is not set up on this server');
  const conn = await connectionStatus(site);
  if (conn.status !== 'connected') throw new Error('QuickBooks is not connected');
  return conn;
}
async function findOrCreate(site, query, entity, create) {
  const found = (await qboGet(site, '/query', { query }))?.QueryResponse?.[entity]?.[0];
  if (found) return String(found.Id);
  return String((await qboCall(site, 'POST', `/${entity.toLowerCase()}`, { body: create() }))[entity].Id);
}
// The customer is the CRM company of that name (with its first contact's email and phone) when there is one.
async function customerId(site, doc, name) {
  if (doc.customers[name]) return doc.customers[name];
  const c = await queryOne(`SELECT co.name, ct.email, ct.phone FROM crm_companies co LEFT JOIN crm_contacts ct ON ct.company_id = co.id
                             WHERE co.name = ? ORDER BY ct.id LIMIT 1`, [name]);
  const id = await findOrCreate(site, customerQuery(name), 'Customer', () => buildCustomer(c || { name }));
  await updateDoc(site, doc.realm_id, (d) => { d.customers[name] = id; });
  doc.customers[name] = id;
  return id;
}
async function itemId(site, doc, conn) {
  if (doc.item_id) return doc.item_id;
  const income = conn.account_map.sales;
  if (!income) throw new Error('Map Sales to a QuickBooks income account first (Settings > Integrations)');
  const id = await findOrCreate(site, itemQuery(ITEM_NAME), 'Item', () => ({ Name: ITEM_NAME, Type: 'Service', IncomeAccountRef: { value: income } }));
  await updateDoc(site, doc.realm_id, (d) => { d.item_id = id; });
  doc.item_id = id;
  return id;
}
const record = (site, realm, bucket, key, entry) => updateDoc(site, realm, (d) => { d[bucket][key] = { ...entry, at: new Date().toISOString() }; });

async function sendInvoice(site, no) {
  const { load, ensure } = lazy();
  const inv = (await load(String(no))) || (await ensure(String(no), 'quickbooks'));
  if (!inv) throw new Error('Invoice not found');
  const conn = await connected(site);
  const key = syncKey(inv.invoice_no, invoiceFp(inv));
  const { data: doc } = await freshDoc(site, conn.realm_id);
  if (doc.invoices[key]?.status === 'sent') return doc.invoices[key];
  const base = { no: inv.invoice_no, ours: inv.total };
  try {
    if (inv.missing_rates) throw new Error('Fill in the missing rates first');
    if (!inv.lines.length) throw new Error('The invoice has no lines');
    const body = buildInvoice(inv, inv.lines, { customerId: await customerId(site, doc, inv.customer_name), itemId: await itemId(site, doc, conn) });
    const res = await qboCall(site, 'POST', '/invoice', { params: { requestid: requestId(conn.realm_id, 'invoice', key), include: 'allowduplicatedocnum' }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.Invoice.Id), qbo_doc: res.Invoice.DocNumber, theirs: res.Invoice.TotalAmt, error: null };
    await record(site, conn.realm_id, 'invoices', key, entry);
    return entry;
  } catch (err) {
    await record(site, conn.realm_id, 'invoices', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

async function sendReceipt(site, voucherNo) {
  const r = await queryOne("SELECT * FROM crm_tally_bank_txns WHERE voucher_no = ? AND voucher_type = 'Receipt'", [String(voucherNo)]);
  if (!r) throw new Error('Payment not found');
  const conn = await connected(site);
  const key = receiptKey(r);
  const { data: doc } = await freshDoc(site, conn.realm_id);
  if (doc.receipts[key]?.status === 'sent') return doc.receipts[key];
  const base = { no: r.voucher_no, ours: Math.abs(r.amount) };
  try {
    let refs = []; try { refs = JSON.parse(r.bill_refs || '[]'); } catch { /* none */ }
    const ours = refs.length ? await queryOne(`SELECT invoice_no FROM sales_invoices WHERE invoice_no IN (${refs.map(() => '?').join(',')})`, refs.map((x) => String(x.bill_ref))) : null;
    const inv = ours ? await sendInvoice(site, ours.invoice_no) : null; // a linked payment needs its invoice in QuickBooks first
    const body = buildPayment(r, { customerId: await customerId(site, doc, r.party_name), invoiceId: inv?.qbo_id, depositAccountId: conn.account_map.bank });
    const res = await qboCall(site, 'POST', '/payment', { params: { requestid: requestId(conn.realm_id, 'payment', key) }, body });
    const entry = { ...base, status: 'sent', qbo_id: String(res.Payment.Id), theirs: res.Payment.TotalAmt, applied: !!inv, error: null };
    await record(site, conn.realm_id, 'receipts', key, entry);
    return entry;
  } catch (err) {
    await record(site, conn.realm_id, 'receipts', key, { ...base, status: 'failed', error: err.message });
    throw err;
  }
}

const send = (site, kind, id) => (kind === 'invoice' ? sendInvoice(site, id) : sendReceipt(site, id));

// Right after an invoice becomes final. Never fails the user's own save: runs after the response (utils/background.js)
// and a failure is already kept in the history with its reason.
function autoSend(site, kind, id) {
  if (!qboConfig()) return;
  return runInBackground(send(site, kind, id).catch(() => {}));
}

// For the screens: each invoice's state by invoice number, the failures to retry, and payments not sent yet.
async function syncState(site) {
  const out = { invoices: {}, failures: [], unsent: [], sentToday: 0 };
  const conn = await connectionStatus(site).catch(() => null);
  if (conn?.status !== 'connected') return out;
  const { data } = await freshDoc(site, conn.realm_id);
  const [heads, rcts] = await Promise.all([
    queryAll('SELECT invoice_no, invoice_date, customer_name FROM sales_invoices'),
    queryAll("SELECT voucher_no, date, party_name, amount FROM crm_tally_bank_txns WHERE voucher_type = 'Receipt' ORDER BY date DESC"),
  ]);
  for (const h of heads) {
    const e = data.invoices[syncKey(h.invoice_no, invoiceFp(h))];
    out.invoices[h.invoice_no] = e ? { status: e.status, qbo_doc: e.qbo_doc, ours: e.ours, theirs: e.theirs, error: e.error } : { status: 'not_sent' };
    if (e?.status === 'failed') out.failures.push({ kind: 'invoice', id: h.invoice_no, no: h.invoice_no, error: e.error, at: e.at });
  }
  for (const r of rcts) {
    const e = data.receipts[receiptKey(r)];
    if (e?.status === 'failed') out.failures.push({ kind: 'receipt', id: r.voucher_no, no: r.voucher_no, error: e.error, at: e.at });
    else if (!e && out.unsent.length < 20) out.unsent.push({ id: r.voucher_no, no: r.voucher_no, party: r.party_name, amount: Math.abs(r.amount) });
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const e of [...Object.values(data.invoices), ...Object.values(data.receipts)]) if (e.status === 'sent' && e.at?.startsWith(today)) out.sentToday++;
  return out;
}

module.exports = { send, autoSend, syncState };
