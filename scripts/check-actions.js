// Self-check for Ohm AI's actions (utils/assistantActions.js + utils/actionRunner.js), no model calls:
//   1. sample sentences fill the right fields (records, numbers, dates, choices) — on the demo's sample data;
//   2. every action runs end to end through app.js and its route, as the demo owner; staff go for approval; a client is refused.
// It WRITES, so it only runs against a local scratch database (a copy of the demo golden DB served by sqld):
//   TURSO_URL=http://127.0.0.1:8089 node scripts/check-actions.js
// Each run makes its own records (CHK… names), so it can run again on the same copy.
const assert = require('node:assert/strict');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.TURSO_URL || '')) {
  console.error('check-actions writes: set TURSO_URL to a local scratch copy (http://127.0.0.1:…), never a real database.');
  process.exit(1);
}
process.env.TURSO_AUTH_TOKEN = '';
process.env.SESSION_SECRET ||= 'check-actions-only';
delete process.env.GOLDEN_TURSO_URL;

const S = require('../db/schema');
const { ACTIONS, fill, check } = require('../utils/assistantActions');
const { runAction } = require('../utils/actionRunner');

(async () => {
  const day = S.istDateString();
  const one = async (sql, args = []) => S.queryOne(sql, args);

  // ---- 1. filling from words (demo sample data: Voltix, Orbit, SYS-2…) ----
  const voltix = (await one("SELECT id FROM crm_companies WHERE name LIKE 'Voltix%'")).id;
  const neha = (await one("SELECT id FROM crm_contacts WHERE poc_name = 'Neha Kapoor'")).id;
  const imran = (await one("SELECT id FROM crm_contacts WHERE poc_name = 'Imran Shaikh'")).id;
  const sys2 = (await one("SELECT id FROM crm_purchase_orders WHERE po_number = 'SYS-2'")).id;
  const sys5 = (await one("SELECT id FROM crm_purchase_orders WHERE po_number = 'SYS-5'")).id;
  const ss34line = (await one("SELECT id FROM crm_po_items WHERE po_id = ? AND item_code = 'SS34'", [sys2])).id;
  const cycleTask = (await one("SELECT id FROM crm_tasks WHERE title LIKE 'Cycle count%'"))?.id;
  const lm358 = (await one("SELECT i.id FROM procurement_items i WHERE i.item_code = 'LM358DR'")).id;
  const cases = [
    ['inward_stock', 'received 4 reels of SS34 at the main store', { item: 'SS34', num_reels: 4, store: 'primary' }],
    ['inward_stock', '6 reels of BC857B came in, 2 boxes', { item: 'BC857B', num_reels: 6, num_boxes: 2 }],
    ['ship_reels', 'ship REEL-10031 and REEL-10032 to Voltix, invoice INV-9001, PO SYS-2', { reels: 'REEL-10031, REEL-10032', customer: voltix, invoice_number: 'INV-9001', po: sys2 }],
    ['transfer_stock', `move REEL-10060 to the ${require('../utils/brand').partnerStore}`, { unit: 'REEL-10060', to_store: 'secondary' }],
    ['transfer_stock', 'send box 1004 back to the main store', { unit: 'BOX-1004', to_store: 'primary' }],
    ['add_item', 'add item BC817-40 NPN transistor SOT-23, 3000 per reel', { item_code: 'BC817-40', description: 'NPN transistor SOT-23', default_spq: 3000, category: 'Transistor' }],
    ['edit_item', 'change the SPQ of SS34 to 2000', { item: 'SS34', default_spq: 2000 }],
    ['set_item_price', 'set the rate of LM358DR to 4.9', { item: 'LM358DR', sale_rate: 4.9 }],
    ['add_client', 'add a new client Ravi Menon from Apex Drives, 98250 12345', { poc_name: 'Ravi Menon', company_name: 'Apex Drives', phone: '9825012345' }],
    ['log_client_note', 'log a call with Neha Kapoor: wants 15k BC857B next month', { client: neha, body: 'Wants 15k BC857B next month' }],
    ['set_client_watch', 'put Imran Shaikh on the watch list', { client: imran, severity: 3 }],
    ['set_client_stage', 'Pooja Iyer is now qualified', { status: 'qualified' }],
    ['add_task', 'add a task to call Neha Kapoor about the call-off on Friday', { client: neha }],
    ...(cycleTask ? [['complete_task', 'the cycle count task is done', { task: cycleTask }], ['reschedule_task', 'move the cycle count task to tomorrow', { task: cycleTask, due_date: S.istDateString(new Date(Date.now() + 864e5)) }]] : []),
    ['create_po', 'new PO from Voltix, PO number VM/889, 5000 SS34 at 1.9', { customer: voltix, po_number: 'VM/889', item: 'SS34', qty: 5000, unit_price: 1.9 }],
    ['confirm_po', 'confirm SYS-5', { po: sys5 }],
    ['reserve_stock', 'reserve stock for the SS34 line on SYS-2', { line: ss34line }],
    ['set_procurement_stage', 'the LM358DR order from the supplier is under QC now', { proc_item: lm358, stage: 'Under QC' }],
    ['create_procurement', 'order 10000 LM358DR from Lotus Semicon at 3.1', { supplier: 'Lotus Semicon', item: 'LM358DR', qty: 10000, unit_cost: 3.1 }],
  ];
  const bad = [];
  for (const [key, q, want] of cases) {
    const c = await fill(key, q, day);
    for (const [k, v] of Object.entries(want)) if (JSON.stringify(c.values[k]) !== JSON.stringify(v)) bad.push(`${key}: "${q}" → ${k} = ${JSON.stringify(c.values[k])}, wanted ${JSON.stringify(v)}`);
  }
  assert.deepEqual(bad, [], `filling:\n${bad.join('\n')}`);
  // A name given as text (how MCP passes it) resolves; a wrong id is an error, not a guess.
  assert.equal((await check('log_client_note', { client: 'Neha', body: 'x' })).values.client, neha);
  assert.ok((await check('complete_task', { task: 999999 })).errors.length);
  assert.ok((await check('transfer_stock', { unit: 'nothing', to_store: 'primary' })).errors.length);

  // ---- 2. end to end, as the owner, through app.js ----
  const owner = { id: 1, username: 'owner', role: 'admin' };
  const store = { id: 3, username: 'store', role: 'user' };
  const run = async (key, fields, who = owner) => { const r = await runAction(who, key, fields); assert.ok(r.ok, `${key}: ${r.error}`); return r; };
  const tag = `CHK${Date.now().toString(36).toUpperCase()}`;
  const done = [];
  const go = async (key, fields, who) => { const r = await run(key, fields, who); done.push(key); return r; };

  await go('add_item', { item_code: tag, description: 'Check part', default_spq: 1000, category: 'IC' });
  await go('edit_item', { item: tag, description: 'Check part, edited' });
  await go('set_item_price', { item: tag, sale_rate: 2.5, hsn_code: '8542' });
  await go('inward_stock', { item: tag, num_reels: 3, num_boxes: 1, store: 'primary' });
  const reels = (await S.queryAll("SELECT reel_number FROM reels WHERE item_code = ? AND status = 'In Stock' ORDER BY reel_number", [tag])).map((r) => r.reel_number);
  assert.equal(reels.length, 3);
  await go('transfer_stock', { unit: reels[0], to_store: 'secondary' });
  assert.equal((await one('SELECT store_code FROM reels WHERE reel_number = ?', [reels[0]])).store_code, 'secondary');
  await go('undo_transfer', { transfer: (await one('SELECT id FROM stock_transfers WHERE reel_number = ? ORDER BY id DESC', [reels[0]])).id });
  assert.equal((await one('SELECT store_code FROM reels WHERE reel_number = ?', [reels[0]])).store_code, 'primary');

  const cl = await go('add_client', { poc_name: `${tag} Person`, company_name: `${tag} Co`, phone: '9000000000' });
  const co = (await one('SELECT company_id FROM crm_contacts WHERE id = ?', [cl.result.id])).company_id;
  await go('log_client_note', { client: cl.result.id, body: 'Wants a sample' });
  await go('set_client_stage', { client: cl.result.id, status: 'qualified' });
  await go('set_client_watch', { client: cl.result.id, severity: 3 });
  await go('edit_client', { client: cl.result.id, email: 'check@example.com' });
  assert.deepEqual({ ...(await one('SELECT status, severity, email, phone FROM crm_contacts WHERE id = ?', [cl.result.id])) }, { status: 'qualified', severity: 3, email: 'check@example.com', phone: '9000000000' });

  const po = await go('create_po', { customer: co, item: tag, qty: 2000, unit_price: 3 });
  await go('add_po_line', { po: po.result.id, item: 'SS34', qty: 100, unit_price: 1.9 });
  await go('confirm_po', { po: po.result.id });
  await go('set_po_dispatch_date', { po: po.result.id, expected_dispatch_date: '2026-12-31' });
  const line = (await one('SELECT id FROM crm_po_items WHERE po_id = ? AND item_code = ?', [po.result.id, tag])).id;
  await go('reserve_stock', { line });
  assert.ok((await one('SELECT COUNT(*) AS n FROM reels WHERE reserved_po_item_id = ?', [line])).n > 0);
  await go('release_reservation', { line });
  await go('add_dispatch_lot', { line, qty: 500, dispatch_date: '2026-12-01' });
  await go('ship_reels', { reels: reels[1], customer: co, invoice_number: `${tag}-INV`, po: po.result.id });
  const ow = await one('SELECT id FROM outwards WHERE reel_number = ?', [reels[1]]);
  assert.ok(ow, 'shipped');
  await go('undo_outward', { outward: ow.id });
  assert.equal((await one('SELECT status FROM reels WHERE reel_number = ?', [reels[1]])).status, 'In Stock');
  await go('dispatch_po', { po: po.result.id, dispatch_date: day });
  const po2 = await go('create_po', { customer: co, po_number: `${tag}/2` });
  await go('cancel_po', { po: po2.result.id });

  const pr = await go('create_procurement', { supplier: `${tag} Supplier`, item: tag, qty: 1000 });
  await go('set_procurement_stage', { proc_item: (await one('SELECT id FROM procurement_items WHERE proc_id = ?', [pr.result.id])).id, stage: 'Under QC' });
  await go('cancel_procurement', { proc: pr.result.id });

  const t = await go('add_task', { title: `${tag} task`, due_date: day, client: cl.result.id, assignee: 'store' });
  const tid = (await one('SELECT id FROM crm_tasks WHERE title = ?', [`${tag} task`])).id;
  await go('reschedule_task', { task: tid, due_date: '2026-12-15' });
  await go('assign_task', { task: tid, assignee: 'manager' });
  await go('complete_task', { task: tid });
  await go('reopen_task', { task: tid });
  await go('delete_task', { task: tid });
  assert.ok(t.ok);

  // staff: inward goes for approval; the owner approves one request and rejects another
  const p1 = await run('inward_stock', { item: tag, num_reels: 1, store: 'primary' }, store);
  assert.ok(p1.pending, 'staff inward is a request');
  await run('inward_stock', { item: tag, num_reels: 1, store: 'primary' }, store);
  const [r1, r2] = (await S.queryAll("SELECT id FROM requests WHERE status = 'pending' AND payload LIKE ? ORDER BY id DESC LIMIT 2", [`%${tag}%`])).map((r) => r.id);
  await go('approve_request', { request: r1 });
  await go('reject_request', { request: r2, reject_reason: 'Duplicate' });
  assert.equal((await one('SELECT status FROM requests WHERE id = ?', [r2])).status, 'rejected');

  // documents waiting for review (rows made here; the real ones come from the AI read)
  const doc = async () => (await S.execute("INSERT INTO crm_invoices (doc_type, status, party_name, invoice_no) VALUES ('purchase_invoice', 'pending', ?, ?)", [`${tag} Supplier`, `${tag}/B`])).lastId;
  await go('approve_document', { doc: await doc() });
  await go('reject_document', { doc: await doc(), notes: 'Wrong GSTIN' });

  await go('archive_item', { item: tag });
  await go('delete_client', { client: cl.result.id });

  // roles: a staff member may not undo; a client may not act at all; missing fields are named
  const refused = await runAction(store, 'undo_transfer', { transfer: (await one('SELECT id FROM stock_transfers ORDER BY id DESC')).id });
  assert.ok(!refused.ok && refused.status === 403, `staff undo should be refused: ${refused.error}`);
  const client = await runAction({ id: 6, username: 'customer', role: 'client' }, 'add_task', { title: 'x', due_date: day });
  assert.ok(!client.ok && client.status === 403);
  const missing = await runAction(owner, 'add_client', {});
  assert.ok(!missing.ok && /Missing: poc_name/.test(missing.error));

  const untested = ACTIONS.map((a) => a.key).filter((k) => !done.includes(k));
  assert.deepEqual(untested, [], `not run end to end: ${untested.join(', ')}`);
  console.log(`check-actions: ${cases.length} sentences filled, all ${ACTIONS.length} actions ran end to end, role checks held`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
