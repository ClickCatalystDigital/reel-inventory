// Builds the Acme Components demo data (a made-up trader) in an EMPTY Turso database, which then
// becomes the golden copy the nightly reset restores (workers/demo-reset-cron).
//
//   DB_URL=libsql://ls-demo-golden-pujan.aws-ap-south-1.turso.io DB_TOKEN=... node scripts/demo/seed.mjs
//
// Schema, logins and stores go straight into the DB. Everything with business rules (items, inward
// numbering, transfers, POs, dispatch, staff requests) goes through the app's real API, served
// in-process from app.js, so counters, stock and statuses behave exactly as in real use. The app's clock
// (nowIST) is set before each step, so the story runs over the last ~4 months in order: stock arrives,
// moves, POs come in, shipments go out. What the office Tally agent and the AI document reader write in
// real use (crm_tally_*, crm_invoices, gelco_docs, po_docs) is inserted directly.
// The seed day goes into app_settings.demo_seeded_on; the nightly reset moves every date forward by the
// days since then, so the demo always reads as current. Run scripts/demo/scrub-check.mjs after.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { DB_URL, DB_TOKEN } = process.env;
if (!DB_URL) throw new Error('DB_URL is required (the golden demo database, never the live one)');
if (/ls-inventory-clickcatalyst/.test(DB_URL)) throw new Error('Refusing to seed the live LS Technologies database');

// The app reads these at load time.
process.env.TURSO_URL = DB_URL;
process.env.TURSO_AUTH_TOKEN = DB_TOKEN || '';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');

const require = createRequire(import.meta.url);
// Demo names (Acme, Partner Store) in everything the app writes, e.g. partner shipments' customer name:
// utils/brand.js loads once with DEMO_MODE on, then DEMO_MODE goes off so the seed can use the password login.
process.env.DEMO_MODE = '1';
const brand = require('../../utils/brand.js');
delete process.env.DEMO_MODE;
const bcrypt = require('bcryptjs');
const schema = require('../../db/schema.js');
const { initDB, queryAll, execute, batch, istDateString } = schema;
// The app's clock: patched before app.js loads, so every route picks up this nowIST.
let clock = null;
const realNow = schema.nowIST;
schema.nowIST = () => clock || realNow();
const app = require('../../app.js');

const TODAY = istDateString();
const day = (d) => new Date(Date.parse(TODAY) + d * 86400000).toISOString().slice(0, 10);
const at = (d, time = '11:00:00') => { clock = `${day(d)} ${time}`; };

// --- 1. Schema (production layout, incl. ls_crm's crm_* tables), then this app's own migrations ---
const [existing] = await queryAll("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
if (Number(existing.n) > 0) throw new Error('Database is not empty; seed only a fresh one');
const ddl = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);
await batch(ddl.map((sql) => [sql]));

// --- 2. Logins (before initDB, so it never creates its default accounts) ---
// One random password, never printed: visitors enter through /demo, and the seed logs in with it below.
const PASSWORD = randomBytes(18).toString('base64url');
const hash = bcrypt.hashSync(PASSWORD, 10);
const USERS = [['owner', 'admin'], ['manager', 'manager'], ['store', 'user'], ['partner_manager', 'gelco_manager'], ['partner_worker', 'gelco_worker'], ['customer', 'client']];
await batch(USERS.map(([u, r]) => ['INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [u, hash, r]]));
await initDB();
await batch([
  ["UPDATE stores SET name = 'Main Store' WHERE code = 'primary'"],
  ["UPDATE stores SET name = 'Partner Store' WHERE code = 'secondary'"],
  // System PO numbers (routes/po.js); ls_crm's initDB creates this counter on the live database.
  ["INSERT OR IGNORE INTO counters (name, value) VALUES ('po_sys', 1000)"],
  ["INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('demo_seeded_on', ?, 'seed', ?)", [TODAY, realNow()]],
]);

// --- 3. The real API, in-process ---
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const cookies = {};
async function login(username) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${username} failed: ${res.status}`);
  cookies[username] = res.headers.get('set-cookie').split(';')[0];
}
async function api(as, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie: cookies[as] }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${as} ${method} ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
for (const [u] of USERS) await login(u);

// --- 4. Product lines, customers (CRM) ---
const PRODUCTS = [['Passives (MLCC, resistors)', 'Recurring', 'Passives'], ['Discrete semiconductors', 'Recurring', 'Discretes'], ['ICs and MCUs', 'Recurring', 'ICs'], ['PCB assemblies', 'Project', 'PCBA']];
await batch(PRODUCTS.map((p) => ["INSERT INTO crm_products (name, product_type, category, status, created_at) VALUES (?, ?, ?, 'active', ?)", [...p, `${day(-150)} 10:00:00`]]));
const productId = Object.fromEntries((await queryAll('SELECT id, category FROM crm_products')).map((p) => [p.category, p.id]));

// [company, contact, designation, status, industry, product line, severity (3 = watch list)]
const CUSTOMERS = [
  ['Brightline Appliances Pvt Ltd', 'Neha Kapoor', 'Purchase Manager', 'customer', 'Home appliances', 'Passives', 1],
  ['Voltix Motors Ltd', 'Rahul Bansal', 'Supply Chain Head', 'customer', 'EV controllers', 'ICs', 2],
  ['Northwind Lighting', 'Sana Qureshi', 'Procurement Lead', 'customer', 'LED drivers', 'Passives', 1],
  ['Orbit Power Systems', 'Imran Shaikh', 'Stores In-charge', 'customer', 'Inverters and UPS', 'Discretes', 3],
  ['Keystone Meters Pvt Ltd', 'Pooja Iyer', 'Buyer', 'new', 'Energy meters', 'ICs', 1],
  ['Helios Solar Tech', 'Arvind Rao', 'Purchase Executive', 'lost', 'Solar charge controllers', 'Discretes', 1],
];
const NEXT = { customer: ["Check next month's call-off", 3], new: ['Send line card and price list', 0], lost: ['Ask again after their Q4 budget', 30] };
const contact = {};
at(-120);
for (const [company_name, poc_name, designation, status, industry, product, severity] of CUSTOMERS) {
  const [title, due] = NEXT[status];
  const r = await api('owner', 'POST', '/api/clients', {
    company_name, poc_name, designation, status, industry, severity, product_id: productId[product],
    email: `${poc_name.split(' ')[0].toLowerCase()}@${company_name.split(' ')[0].toLowerCase()}.example`, phone: '9800000000',
    note: `Buys ${industry.toLowerCase()} components; prefers monthly call-offs against a yearly PO.`,
    next_touchpoint: day(due), next_touchpoint_title: title, next_touchpoint_assignee: 'manager',
  });
  contact[company_name] = r.id;
}
const companyId = {};
for (const row of await queryAll('SELECT co.id company_id, co.name FROM crm_contacts c JOIN crm_companies co ON co.id = c.company_id')) companyId[row.name] = Number(row.company_id);
await execute('UPDATE crm_companies SET created_at = ?, updated_at = ?', [clock, clock]); // column default is the real time
// The customer login belongs to Brightline: it sees only Brightline's items and POs (utils/visibility.js).
const [customerUser] = await queryAll("SELECT id FROM users WHERE username = 'customer'");
await execute('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [customerUser.id, companyId['Brightline Appliances Pvt Ltd']]);

// --- 5. Catalog with invoice details (rate + HSN are required before anything moves to the partner store) ---
// [code, description, reel size, category, customers who may see it, HSN, sale rate ₹/pc, supplier]
const SUP = 'Eastbridge Components Trading', SUP2 = 'Lotus Semicon Distributors';
const ITEMS = [
  ['BC857B', 'PNP transistor SOT-23', 3000, 'Transistor', ['Brightline Appliances Pvt Ltd'], '8541', 0.42, SUP],
  ['BC847C', 'NPN transistor SOT-23', 3000, 'Transistor', ['Brightline Appliances Pvt Ltd'], '8541', 0.4, SUP],
  ['1N4148W', 'Switching diode SOD-123', 3000, 'Diode', [], '8541', 0.35, SUP],
  ['SS34', 'Schottky diode 3A 40V SMA', 1800, 'Diode', ['Voltix Motors Ltd'], '8541', 1.9, SUP],
  ['CC0603-104K', 'MLCC 100nF 50V X7R 0603', 4000, 'MLCC', ['Brightline Appliances Pvt Ltd'], '8532', 0.18, SUP],
  ['CC0805-106K', 'MLCC 10uF 25V X5R 0805', 4000, 'MLCC', [], '8532', 0.95, SUP],
  ['RC0603-10K', 'Resistor 10k 1% 0603', 5000, 'RESISTOR', ['Brightline Appliances Pvt Ltd'], '8533', 0.06, SUP],
  ['RC1206-0R1', 'Current-sense resistor 0.1R 1206', 5000, 'RESISTOR', ['Voltix Motors Ltd'], '8533', 1.1, SUP],
  ['EC-470U35', 'Electrolytic cap 470uF 35V 10x16', 500, 'Electrolytic Capacitor', ['Northwind Lighting'], '8532', 6.2, SUP2],
  ['TAN-22U16', 'SMD tantalum 22uF 16V case B', 2000, 'SMD Tan Cap', [], '8532', 3.4, SUP2],
  ['MOV-14D471', 'Varistor 14D471K', 1000, 'MOV', ['Northwind Lighting'], '8533', 2.4, SUP2],
  ['STM32G030', 'MCU 32-bit ARM Cortex-M0+ TSSOP20', 2500, 'IC', ['Voltix Motors Ltd'], '8542', 38.5, SUP2],
  ['LM358DR', 'Dual op-amp SOIC-8', 2500, 'IC', [], '8542', 4.6, SUP2],
  ['PCBA-BLDC-01', 'BLDC fan controller board', 200, 'PCBA', ['Brightline Appliances Pvt Ltd'], '8537', 450, SUP2],
];
at(-118);
for (const [item_code, description, default_spq, category, who, hsn_code, sale_rate, supplier] of ITEMS) {
  await api('owner', 'POST', '/api/items', { item_code, description, default_spq, category, company_ids: who.map((n) => companyId[n]) });
  await api('owner', 'PUT', `/api/items/${item_code}/invoice`, { hsn_code, sale_rate, gst_rate: 18 });
  await execute('UPDATE items SET supplier = ?, created_at = ? WHERE item_code = ?', [supplier, clock, item_code]); // no API sets supplier
}

// --- 6. Opening stock (one inward per item, each on its own day), part of it moved to the partner store ---
const reels = {};
const INWARD = [
  ['BC857B', 12, 2], ['BC847C', 10, 2], ['1N4148W', 8, 1], ['SS34', 9, 1], ['CC0603-104K', 15, 3], ['CC0805-106K', 6, 1],
  ['RC0603-10K', 14, 2], ['RC1206-0R1', 5, 0], ['EC-470U35', 10, 2], ['TAN-22U16', 3, 0], ['MOV-14D471', 6, 1],
  ['STM32G030', 8, 2], ['LM358DR', 2, 0], ['PCBA-BLDC-01', 6, 1],
];
for (const [n, [item_code, num_reels, num_boxes]] of INWARD.entries()) {
  at(-110 + n * 3, '10:30:00');
  const r = await api('owner', 'POST', '/api/inward', { item_code, num_reels, num_boxes, store_code: 'primary', notes: 'Supplier delivery' });
  reels[item_code] = r.reels.map((x) => x.reel_number);
}
at(-55, '16:00:00');
for (const item of ['BC857B', 'CC0603-104K', 'RC0603-10K', 'EC-470U35']) {
  for (const number of reels[item].splice(-3)) await api('manager', 'POST', '/api/transfer', { kind: 'reel', number, to_store: 'secondary', notes: 'Weekly top-up' });
}

// --- 7. Customer POs. Ordered quantities exceed what has shipped, so POs stay open or part-dispatched ---
async function po(customer, orderDay, dueDay, lines, stage) {
  at(orderDay, '12:00:00');
  const p = await api('owner', 'POST', '/api/po', { company_id: companyId[customer], contact_id: contact[customer], order_date: day(orderDay), expected_dispatch_date: day(dueDay), generate_number: true, notes: 'Monthly call-off' });
  const id = p.id ?? p.po?.id;
  for (const [item_code, quantity_ordered, unit_price] of lines) await api('owner', 'POST', `/api/po/${id}/items`, { item_code, quantity_ordered, unit_price });
  if (stage !== 'draft') await api('owner', 'POST', `/api/po/${id}/confirm`, {});
  await execute('UPDATE crm_purchase_orders SET created_at = ?, updated_at = ? WHERE id = ?', [clock, clock, id]);
  return id;
}
// One invoice = one shipment = one date.
async function ship(d, invoice, customer, poId, lines) {
  at(d, '15:30:00');
  for (const [item_code, n] of lines) {
    await api('manager', 'POST', '/api/outward/grouped', { item_code, reel_numbers: reels[item_code].splice(0, n), customer_name: customer, invoice_number: invoice, company_id: companyId[customer], po_id: poId, store_code: 'primary' });
  }
}
// Brightline #1: complete (shipped in full, PO marked dispatched).
const poBright1 = await po('Brightline Appliances Pvt Ltd', -50, -35, [['BC857B', 9000, 0.42], ['CC0603-104K', 12000, 0.18], ['RC0603-10K', 15000, 0.06]], 'confirmed');
await ship(-36, 'INV-2601', 'Brightline Appliances Pvt Ltd', poBright1, [['BC857B', 3], ['CC0603-104K', 3], ['RC0603-10K', 3]]);
await api('owner', 'POST', `/api/po/${poBright1}/dispatch`, { dispatch_date: day(-36) });
// Its dispatch reminder and post-dispatch follow-up were done on time, not left overdue.
const [{ po_number: b1 }] = await queryAll('SELECT po_number FROM crm_purchase_orders WHERE id = ?', [poBright1]);
for (const [title, d] of [[`Dispatch PO ${b1} %`, -36], [`Post-dispatch follow up — PO ${b1} %`, -33]]) {
  at(d, '17:30:00');
  const [task] = await queryAll('SELECT id FROM crm_tasks WHERE title LIKE ?', [title]);
  await api('owner', 'POST', `/api/tasks/${task.id}/done`);
}
// Voltix: part shipped; the rest of the MCUs partly reserved, partly on a procurement order.
const poVoltix = await po('Voltix Motors Ltd', -30, 5, [['STM32G030', 25000, 38.5], ['SS34', 9000, 1.9]], 'confirmed');
await ship(-12, 'INV-2604', 'Voltix Motors Ltd', poVoltix, [['STM32G030', 2]]);
// Orbit: diodes shipped in full, op-amps short (procurement). On the watch list for a late payment.
const poOrbit = await po('Orbit Power Systems', -18, 12, [['1N4148W', 6000, 0.35], ['LM358DR', 10000, 4.6]], 'confirmed');
await ship(-14, 'INV-2607', 'Orbit Power Systems', poOrbit, [['1N4148W', 2]]);
at(-9);
await api('manager', 'POST', `/api/clients/${contact['Orbit Power Systems']}/notes`, { body: 'INV-2607 is past due; hold the op-amp dispatch until it clears.' });
// Brightline #2: open and part-dispatched; this is what the customer portal shows.
const poBright2 = await po('Brightline Appliances Pvt Ltd', -20, 10, [['BC857B', 15000, 0.42], ['CC0603-104K', 20000, 0.18], ['PCBA-BLDC-01', 600, 450]], 'confirmed');
await ship(-6, 'INV-2611', 'Brightline Appliances Pvt Ltd', poBright2, [['BC857B', 2], ['PCBA-BLDC-01', 1]]);
// Northwind: still a draft (not on the customer portal, not planned for).
const poNorth = await po('Northwind Lighting', -3, 25, [['EC-470U35', 2000, 6.2], ['MOV-14D471', 2000, 2.4]], 'draft');

// Reserve free stock to the open confirmed POs' lines, then one procurement order only for what confirmed POs
// still lack (the shortfall list also counts drafts; a draft is not a real need yet).
at(-5);
for (const id of [poVoltix, poOrbit, poBright2]) {
  const { lines } = await api('owner', 'GET', `/api/orders/${id}`);
  for (const l of lines) if (l.free_stock > 0 && l.ordered > l.dispatched + l.reserved) await api('owner', 'POST', `/api/orders/${id}/lines/${l.id}/reserve`, {});
}
const short = (await api('owner', 'GET', '/api/procurement/shortfall'))
  .map((g) => ({ ...g, lines: g.lines.filter((l) => l.po_id !== poNorth) })).filter((g) => g.lines.length);
const COST = { STM32G030: 0.46, LM358DR: 0.055 };
if (short.length) {
  at(-4, '10:00:00');
  const order = await api('owner', 'POST', '/api/procurement', {
    supplier: SUP2, expected_date: day(14), notes: 'Air freight; QC at origin',
    items: short.map((g) => {
      const need = g.lines.reduce((s, l) => s + l.needed, 0);
      return { item_code: g.item_code, qty: Math.ceil(need / 2500) * 2500 + 2500, unit_cost: COST[g.item_code] ?? 0.05, currency: 'USD', allocations: g.lines.map((l) => ({ po_item_id: l.po_item_id, qty: l.needed })) };
    }),
  });
  await api('owner', 'PUT', `/api/procurement/${order.id}`, { status: 'ordered' });
  const detail = await api('owner', 'GET', `/api/procurement/${order.id}`);
  const stages = ['In Transit', 'Under QC', 'Under Manufacturing'];
  at(-1, '18:00:00');
  for (const [i, it] of detail.items.entries()) await api('owner', 'PUT', `/api/procurement/${order.id}/items/${it.id}/stage`, { stage: stages[i % stages.length] });
}
// Planned dispatch lots on lines still open.
at(-2, '12:00:00');
const lot = (po_id, item_code, quantity, d, notes) => api('owner', 'POST', '/api/orders/dispatches', { po_id, item_code, quantity, dispatch_date: day(d), notes });
await lot(poBright2, 'BC857B', 9000, 4, 'Lot 2 of 2, planned');
await lot(poBright2, 'CC0603-104K', 20000, 4, 'With lot 2');
await lot(poVoltix, 'STM32G030', 15000, 3, 'From reserved stock');
await lot(poVoltix, 'STM32G030', 5000, 18, 'After procurement lands');

// --- 8. Partner store: the partner manager approves each day, then the store ships, one invoice per shipment.
// Each shipment's "Partner Store" tax invoice (Docs → Sales) is created the way the Outward page does it.
// Partner calls are refused until the real today's gate is approved, so that comes first.
clock = null;
await api('partner_manager', 'POST', '/api/daily-gate/approve', { store: 'secondary' });
await execute('UPDATE daily_gate_approvals SET approved_at = ? WHERE gate_date = ?', [`${TODAY} 09:10:00`, TODAY]);
async function partnerShip(as, d, lines) {
  await execute('INSERT OR IGNORE INTO daily_gate_approvals (store_code, gate_date, approved_by, approved_at) VALUES (?, ?, ?, ?)', ['secondary', day(d), 'partner_manager', `${day(d)} 09:15:00`]);
  at(d, '14:00:00');
  const { invoice_number } = await api(as, 'POST', '/api/outward/next-invoice-number');
  for (const [item_code, n] of lines) {
    const nums = (await queryAll("SELECT reel_number FROM reels WHERE item_code = ? AND store_code = 'secondary' AND status = 'In Stock' ORDER BY reel_number LIMIT ?", [item_code, n])).map((r) => r.reel_number);
    await api(as, 'POST', '/api/outward/grouped', { item_code, reel_numbers: nums, customer_name: brand.partnerStore, invoice_number, outward_type: 'Full', store_code: 'secondary' });
  }
  await api(as, 'POST', `/api/sales-invoices/${invoice_number}`);
}
await partnerShip('partner_manager', -8, [['BC857B', 1], ['CC0603-104K', 1]]);
await partnerShip('partner_worker', -1, [['RC0603-10K', 1], ['EC-470U35', 1]]); // yesterday: today's gate summary

// --- 9. Staff requests: history (approved, rejected) and work waiting for a manager ---
async function reviewLast(action, body = {}) {
  const [r] = await queryAll("SELECT id FROM requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1");
  await api('manager', 'POST', `/api/requests/${r.id}/${action}`, body);
}
at(-25, '11:20:00');
await api('store', 'POST', '/api/transfer', { kind: 'reel', number: reels['CC0805-106K'].pop(), to_store: 'secondary', notes: 'Partner asked for 10uF' });
at(-25, '13:05:00');
await reviewLast('approve');
at(-16, '09:50:00');
await api('store', 'POST', '/api/inward', { item_code: 'TAN-22U16', num_reels: 2, num_boxes: 0, store_code: 'primary', notes: 'Supplier delivery' });
at(-16, '11:30:00');
await reviewLast('approve');
at(-11, '10:40:00');
await api('store', 'POST', '/api/transfer', { kind: 'reel', number: reels.STM32G030.at(-1), to_store: 'secondary', notes: 'Top-up' });
at(-11, '12:10:00');
await reviewLast('reject', { reject_reason: 'MCUs stay at Main Store; they are reserved for Voltix' });
// Waiting now: an inward to check, an outward and a transfer to approve.
at(0, '09:30:00');
await api('store', 'POST', '/api/inward', { item_code: 'LM358DR', num_reels: 4, num_boxes: 0, store_code: 'primary', notes: 'Supplier delivery, awaiting check' });
at(0, '10:15:00');
const ss34 = (await queryAll("SELECT reel_number FROM reels WHERE item_code = 'SS34' AND reserved_po_item_id IS NOT NULL ORDER BY reel_number LIMIT 2")).map((r) => r.reel_number);
await api('store', 'POST', '/api/outward/grouped', { item_code: 'SS34', reel_numbers: ss34, customer_name: 'Voltix Motors Ltd', invoice_number: 'INV-2615', company_id: companyId['Voltix Motors Ltd'], po_id: poVoltix, store_code: 'primary' });
at(0, '10:40:00');
await api('store', 'POST', '/api/transfer', { kind: 'reel', number: reels['MOV-14D471'].pop(), to_store: 'secondary', notes: 'Partner store is out of varistors' });

// Tasks for today: the store login's own, and the manager's.
at(-1, '17:00:00');
await api('manager', 'POST', '/api/tasks', { title: 'Cycle count: SS34 and LM358DR shelves', due_date: day(0), assigned_to: 'store' });
await api('manager', 'POST', '/api/tasks', { contact_id: contact['Orbit Power Systems'], title: 'Call Orbit about overdue INV-2607', due_date: day(0), assigned_to: 'manager' });

// --- 10. What the office Tally agent and the AI document reader write in real use, inserted directly ---
clock = null;
const ts = (d, t = '10:00:00') => `${day(d)} ${t}`;
const SYNC = ts(0, '08:45:00');
const J = JSON.stringify;
const ACME_GSTIN = '24AAACA0000A1Z5'; // made up
const bill = (table) => `INSERT INTO ${table} (party_name, bill_ref, voucher_no, bill_date, original_amt, settled_amt, pending_amt, credit_days, due_date, overdue_days, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const billArgs = ([party, ref, vno, d, orig, paid, credit]) => [party, ref, vno, day(d), orig, paid, orig - paid, credit, day(d + credit), Math.max(0, -(d + credit)), SYNC];
await batch([
  // Tally sync: masters as epoch seconds, vouchers-from as YYYYMMDD (the reset shifts both).
  ["INSERT OR REPLACE INTO counters (name, value) VALUES ('tally_masters_last_sync', ?)", [Math.floor(Date.parse(`${TODAY}T03:15:00Z`) / 1000)]],
  ["INSERT OR REPLACE INTO counters (name, value) VALUES ('tally_voucher_sync_from', ?)", [Number(day(-180).replace(/-/g, ''))]],
  ...[
    ['Brightline Appliances Pvt Ltd', 'Sundry Debtors', '-109174.00'], ['Voltix Motors Ltd', 'Sundry Debtors', '-127150.00'],
    ['Orbit Power Systems', 'Sundry Debtors', '-2478.00'], ['Northwind Lighting', 'Sundry Debtors', '0'],
    [SUP, 'Sundry Creditors Import', '187800.00'], [SUP2, 'Sundry Creditors Import', '186500.00'], ['Swift Cargo Movers', 'Sundry Creditors', '0'],
    ['Demo Bank Current A/c', 'Bank Accounts', '-845300.00'], ['Petty Cash', 'Cash-in-Hand', '-14200.00'],
    ['Sales - Components', 'Sales Accounts', '2645000.00'], ['Purchase - Import', 'Purchase Accounts', '-1890000.00'],
    ['Freight Inward', 'Direct Expenses', '-96000.00'], ['Office Expenses', 'Indirect Expenses', '-58000.00'], ['GST Payable', 'Duties & Taxes', '64200.00'],
  ].map(([n, p, b]) => ['INSERT INTO crm_tally_ledgers (name, parent, closing_balance, synced_at) VALUES (?, ?, ?, ?)', [n, p, b, SYNC]]),
  // Unpaid customer bills: INV-2607 is overdue (Orbit, watch list); INV-2601 was paid in full.
  ...[
    ['Voltix Motors Ltd', 'INV-2604', 'S-104', -12, 227150, 100000, 45], ['Orbit Power Systems', 'INV-2607', 'S-107', -14, 2478, 0, 7],
    ['Brightline Appliances Pvt Ltd', 'INV-2611', 'S-111', -6, 109174, 0, 30],
  ].map((b) => [bill('crm_tally_outstanding'), billArgs(b)]),
  ...[
    ['S-101', -36, 'Brightline Appliances Pvt Ltd', 8071, 'INV-2601', [['BC857B', 9000, 0.42], ['CC0603-104K', 12000, 0.18], ['RC0603-10K', 15000, 0.06]]],
    ['S-104', -12, 'Voltix Motors Ltd', 227150, 'INV-2604', [['STM32G030', 5000, 38.5]]],
    ['S-107', -14, 'Orbit Power Systems', 2478, 'INV-2607', [['1N4148W', 6000, 0.35]]],
    ['S-111', -6, 'Brightline Appliances Pvt Ltd', 109174, 'INV-2611', [['BC857B', 6000, 0.42], ['PCBA-BLDC-01', 200, 450]]],
  ].map(([vno, d, party, amt, ref, inv]) => {
    const net = Math.round(amt / 1.18);
    return ['INSERT INTO crm_tally_sales_vouchers (voucher_no, date, party_name, amount, narration, ledger_lines, bill_refs, inventory_lines, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [vno, day(d), party, amt, `Sales ${ref}`, J([{ ledger: party, amount: amt }, { ledger: 'Sales - Components', amount: -net }, { ledger: 'GST Payable', amount: net - amt }]),
       J([{ bill_ref: ref, amount: amt }]), J(inv.map(([item, q, rate]) => ({ item, actual_qty: q, billed_qty: q, rate, amount: Math.round(q * rate * 100) / 100 }))), SYNC]];
  }),
  ...[
    ['R-201', 'Receipt', -30, 'Brightline Appliances Pvt Ltd', 8071, 'Against INV-2601', [{ bill_ref: 'INV-2601', amount: 8071 }]],
    ['R-202', 'Receipt', -3, 'Voltix Motors Ltd', 100000, 'Part payment against INV-2604', [{ bill_ref: 'INV-2604', amount: 100000 }]],
    ['P-301', 'Payment', -40, SUP, 225000, 'TT remittance against EB/26/0412', []],
    ['P-302', 'Payment', -19, 'Swift Cargo Movers', 18400, 'Freight and clearing, air shipment', []],
    ['P-303', 'Payment', -7, 'Petty Cash', 5000, 'Cash for office expenses', []],
  ].map(([vno, type, d, party, amt, nar, refs]) => ['INSERT INTO crm_tally_bank_txns (voucher_no, voucher_type, date, party_name, amount, narration, bill_refs, synced_at, bank_ledger) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [vno, type, day(d), party, amt, nar, J(refs), SYNC, 'Demo Bank Current A/c']]),
  ...[
    ['PV-01', -62, SUP, 412800, 'EB/26/0412', 'Transistors, diodes and MLCC, import'],
    ['PV-02', -33, SUP2, 186500, 'LSD/7781', 'MCUs and op-amps, import'],
    ['PV-03', -21, 'Swift Cargo Movers', 18400, 'SCM/1093', 'Freight and clearing'],
  ].map(([vno, d, party, amt, ref, nar]) => ['INSERT INTO crm_tally_purchase_vouchers (voucher_no, date, party_name, amount, narration, ledger_lines, bill_refs, inventory_lines, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [vno, day(d), party, amt, nar, J([{ ledger: 'Purchase - Import', amount: amt }, { ledger: party, amount: -amt }]), J([{ bill_ref: ref, amount: amt }]), '[]', SYNC]]),
  ...[
    [SUP, 'EB/26/0412', 'PV-01', -62, 412800, 225000, 60], [SUP2, 'LSD/7781', 'PV-02', -33, 186500, 0, 45], ['Swift Cargo Movers', 'SCM/1093', 'PV-03', -21, 18400, 18400, 15],
  ].map((b) => [bill('crm_tally_purchase_outstanding'), billArgs(b)]),
  ...ITEMS.map(([code, desc, , category, , hsn, rate]) => ['INSERT INTO crm_tally_stock_items (name, parent, base_units, closing_qty, closing_rate, synced_at, hsn_code, gst_applicable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`${code} ${desc}`, category, 'Pcs', '0', String(rate), SYNC, hsn, 'Applicable']]),
  ['INSERT INTO crm_bank_accounts (account_no, bank_ledger, label) VALUES (?, ?, ?)', ['XXXX4410', 'Demo Bank Current A/c', 'Current account']],
]);
// Tally's closing stock = the reels actually in stock.
await execute(`UPDATE crm_tally_stock_items SET closing_qty = COALESCE((SELECT CAST(SUM(quantity) AS TEXT) FROM reels
  WHERE reels.status = 'In Stock' AND crm_tally_stock_items.name LIKE reels.item_code || ' %'), '0')`);

// AI-read documents (Docs): purchase invoices pushed / approved / in review, a bill of entry waiting, a bank statement.
const INV_COLS = 'created_at, uploaded_by, original_filename, doc_type, invoice_no, invoice_date, party_name, party_gstin, buyer_gstin, place_of_supply, taxable_value, cgst, sgst, igst, total_tax, net_amount, line_items, status, review_notes, approved_at, pushed_at, purchase_ledger';
const invRow = (d, by, file, type, no, party, gstin, pos, taxable, igst, lines, status, notes, ledger) =>
  [`INSERT INTO crm_invoices (${INV_COLS}) VALUES (${INV_COLS.split(',').map(() => '?').join(',')})`,
    [ts(d), by, file, type, no, day(d), party, gstin, ACME_GSTIN, pos, taxable, 0, 0, igst, igst, taxable + igst, J(lines), status, notes,
     ['approved', 'pushed'].includes(status) ? ts(d + 1) : null, status === 'pushed' ? ts(d + 1, '18:00:00') : null, ledger]];
await batch([
  invRow(-62, 'manager', 'eastbridge-invoice-0412.pdf', 'purchase_invoice', 'EB/26/0412', SUP, null, 'Import', 349830, 62970,
    [{ description: 'BC857B PNP transistor SOT-23', qty: 36000, unit: 'Pcs', rate: 0.21, amount: 7560 }, { description: 'CC0603-104K MLCC 100nF', qty: 60000, unit: 'Pcs', rate: 0.07, amount: 4200 }], 'pushed', null, 'Purchase - Import'),
  invRow(-33, 'manager', 'lotus-semicon-7781.pdf', 'purchase_invoice', 'LSD/7781', SUP2, '24AAGCL1234M1Z2', 'Gujarat', 158050, 28450,
    [{ description: 'STM32G030 MCU TSSOP20', qty: 4000, unit: 'Pcs', rate: 36.0, amount: 144000 }, { description: 'LM358DR op-amp SOIC-8', qty: 5000, unit: 'Pcs', rate: 2.81, amount: 14050 }], 'approved', 'Rates match the PO.', 'Purchase - Import'),
  invRow(-21, 'store', 'swift-cargo-1093.pdf', 'freight_invoice', 'SCM/1093', 'Swift Cargo Movers', '24AAJCS5678K1Z9', 'Gujarat', 15593, 2807,
    [{ description: 'Air freight and clearing', qty: 1, unit: 'Shipment', rate: 15593, amount: 15593 }], 'under_review', 'Check the weight against the airway bill before approving.', 'Freight Inward'),
  invRow(-2, 'store', 'bill-of-entry-2291.pdf', 'bill_of_entry', 'BE-2291', SUP2, null, 'Import', 52000, 9360,
    [{ description: 'MCUs, air shipment', qty: 1, unit: 'Lot', rate: 52000, amount: 52000 }], 'pending', null, null),
]);
await execute(`INSERT INTO crm_invoices (created_at, uploaded_by, original_filename, doc_type, party_name, status, review_notes, approved_at, bank_ledger, account_no, statement_from, statement_to, opening_balance, closing_balance, total_debit, total_credit)
  VALUES (?, 'manager', 'bank-statement.pdf', 'bank_statement', 'Demo Bank', 'approved', 'All entries matched.', ?, 'Demo Bank Current A/c', 'XXXX4410', ?, ?, 640000, 845300, 248400, 453700)`, [ts(-1), ts(-1, '15:00:00'), day(-31), day(-1)]);
await execute("INSERT INTO crm_tasks (title, due_date, assigned_to, created_by, created_at, invoice_id) SELECT 'Review freight invoice SCM/1093', ?, 'manager', 'store', ?, id FROM crm_invoices WHERE invoice_no = 'SCM/1093'", [day(0), ts(-21)]);

// Partner-store papers and customer PO documents (listed only: the demo has no file bucket).
const doc = 'INSERT INTO po_docs (po_id, doc_type, original_filename, r2_key, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)';
const pdoc = 'INSERT INTO gelco_docs (doc_type, original_filename, file_url, uploaded_by, uploaded_at, store_code) VALUES (?, ?, ?, ?, ?, ?)';
await batch([
  [pdoc, ['po', 'partner-po-0931.pdf', '/api/gelco-docs/file?key=inventory-docs%2Fdemo-partner-po.pdf', 'partner_manager', ts(-9), 'secondary']],
  [pdoc, ['invoice', 'partner-invoice-signed.pdf', '/api/gelco-docs/file?key=inventory-docs%2Fdemo-partner-invoice.pdf', 'partner_manager', ts(-7), 'secondary']],
  [doc, [poBright2, 'po', 'brightline-po.pdf', 'inventory-docs/po/demo/brightline-po.pdf', 'owner', ts(-20, '12:30:00')]],
  [doc, [poBright2, 'packing_list', 'packing-list-INV-2611.pdf', 'inventory-docs/po/demo/packing-list-2611.pdf', 'manager', ts(-6, '16:00:00')]],
  [doc, [poVoltix, 'po', 'voltix-po.pdf', 'inventory-docs/po/demo/voltix-po.pdf', 'owner', ts(-30, '12:30:00')]],
]);

server.close();
// Every table a demo screen reads must have rows.
const MUST = ['users', 'items', 'reels', 'boxes', 'outwards', 'stock_transfers', 'requests', 'daily_gate_approvals', 'crm_companies', 'crm_contacts', 'crm_notes',
  'crm_tasks', 'crm_products', 'crm_purchase_orders', 'crm_po_items', 'po_dispatches', 'po_docs', 'procurement_orders', 'procurement_items', 'procurement_allocations',
  'sales_invoices', 'sales_invoice_items', 'gelco_docs', 'crm_invoices', 'crm_bank_accounts', 'crm_tally_ledgers', 'crm_tally_outstanding', 'crm_tally_bank_txns',
  'crm_tally_sales_vouchers', 'crm_tally_purchase_vouchers', 'crm_tally_purchase_outstanding', 'crm_tally_stock_items', 'item_visibility', 'user_companies', 'app_settings'];
const counts = {};
for (const t of MUST) counts[t] = Number((await queryAll(`SELECT COUNT(*) n FROM ${t}`))[0].n);
for (const s of ['pending', 'approved', 'rejected']) counts[`requests ${s}`] = Number((await queryAll('SELECT COUNT(*) n FROM requests WHERE status = ?', [s]))[0].n);
console.log('Acme Components demo data seeded:', counts);
const empty = Object.entries(counts).filter(([, n]) => !n).map(([t]) => t);
if (empty.length) throw new Error(`Empty after seeding: ${empty.join(', ')}`);
process.exit(0);
