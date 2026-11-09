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

// The US demo (MARKET=NA) has the same sample records under American names.
const US_NAMES = [['Neha Kapoor', 'Emily Carter'], ['Rahul Bansal', 'Jason Miller'], ['Imran Shaikh', 'Marcus Reed'], ['Pooja Iyer', 'Laura Chen'], ['Arvind Rao', 'Daniel Ortiz'], ['Neha', 'Emily']];
const market = (s) => (process.env.MARKET === 'NA' ? US_NAMES.reduce((t, [a, b]) => t.split(a).join(b), s) : s);
const S = require('../db/schema');
const { ACTIONS, fill, check } = require('../utils/assistantActions');
const { runAction } = require('../utils/actionRunner');

(async () => {
  const day = S.istDateString();
  const one = async (sql, args = []) => S.queryOne(sql, args);

  // ---- 1. filling from words (demo sample data: Voltix, Orbit, SYS-2…) ----
  const voltix = (await one("SELECT id FROM crm_companies WHERE name LIKE 'Voltix%'")).id;
  const neha = (await one('SELECT id FROM crm_contacts WHERE poc_name = ?', [market('Neha Kapoor')])).id;
  const imran = (await one('SELECT id FROM crm_contacts WHERE poc_name = ?', [market('Imran Shaikh')])).id;
  const sys2 = (await one("SELECT id FROM crm_purchase_orders WHERE po_number = 'SYS-2'")).id;
  const sys5 = (await one("SELECT id FROM crm_purchase_orders WHERE po_number = 'SYS-5'")).id;
  const ss34line = (await one("SELECT id FROM crm_po_items WHERE po_id = ? AND item_code = 'SS34'", [sys2])).id;
  const cycleTask = (await one("SELECT id FROM crm_tasks WHERE title LIKE 'Cycle count%'"))?.id;
  const lm358 = (await one("SELECT i.id FROM procurement_items i WHERE i.item_code = 'LM358DR'")).id;
  const orbit = (await one("SELECT id FROM crm_companies WHERE name LIKE 'Orbit%'")).id;
  const lineOf = async (po, item) => (await one("SELECT pi.id FROM crm_po_items pi JOIN crm_purchase_orders p ON p.id = pi.po_id WHERE p.po_number = ? AND pi.item_code = ?", [po, item])).id;
  const lotOf = async (po, item, qty) => (await one(`SELECT d.id FROM po_dispatches d JOIN crm_purchase_orders p ON p.id = d.po_id WHERE p.po_number = ? AND d.item_code = ?${qty ? ' AND d.quantity = ?' : ''}`, [po, item, ...(qty ? [qty] : [])])).id;
  const lm358line = await lineOf('SYS-3', 'LM358DR'), movLine = await lineOf('SYS-5', 'MOV-14D471');
  const stmLot = await lotOf('SYS-2', 'STM32G030', 5000), bcLot = await lotOf('SYS-4', 'BC857B'), ccLot = await lotOf('SYS-4', 'CC0603-104K');
  const prc1 = (await one("SELECT id FROM procurement_orders WHERE number = 'PRC-1'")).id;
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
    ['edit_approve_request', 'approve request 4 but with only 3 reels', { request: 4, num_reels: 3 }],
    ['edit_approve_request', "approve store's SS34 outward request with only REEL-10031", { request: 5, keep: 'REEL-10031' }],
    ['edit_po', 'change the customer on SYS-5 to Orbit', { po: sys5, customer: orbit }],
    ['edit_po_line', 'change the LM358DR on SYS-3 to 8000 pcs', { line: lm358line, qty: 8000 }],
    ['edit_po_line', 'set the SS34 price on SYS-2 to 1.85', { line: ss34line, qty: null, unit_price: 1.85 }],
    ['remove_po_line', 'remove the MOV-14D471 line from SYS-5', { line: movLine }],
    ['edit_dispatch_lot', 'move the SYS-2 STM32G030 lot of 5000 to the 28th', { lot: stmLot, qty: null }],
    ['edit_dispatch_lot', 'change the BC857B dispatch lot on SYS-4 to 8000 pcs', { lot: bcLot, qty: 8000 }],
    ['delete_dispatch_lot', 'delete the CC0603-104K dispatch lot on SYS-4', { lot: ccLot }],
    ['edit_procurement', 'PRC-1 is now expected next Friday', { proc: prc1 }],
    ['edit_procurement', 'mark PRC-1 as ordered', { proc: prc1, status: 'ordered' }],
    ['set_invoice_rate', 'set the rate of RC0603-10K on invoice 10001 to 0.07', { invoice: '10001', item: 'RC0603-10K', rate: 0.07 }],
    ['set_payment_reminder', 'remind me to chase payment on voucher S-104 next Friday', { voucher: 'S-104' }],
  ];
  const bad = [];
  for (const [key, q, want] of cases) {
    const c = await fill(key, market(q), day);
    for (const [k, v] of Object.entries(want)) if (JSON.stringify(c.values[k]) !== JSON.stringify(v)) bad.push(`${key}: "${q}" → ${k} = ${JSON.stringify(c.values[k])}, wanted ${JSON.stringify(v)}`);
  }
  assert.deepEqual(bad, [], `filling:\n${bad.join('\n')}`);
  // A name given as text (how MCP passes it) resolves; a wrong id is an error, not a guess.
  assert.equal((await check('log_client_note', { client: market('Neha'), body: 'x' })).values.client, neha);
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
  await go('edit_po', { po: po.result.id, order_date: '2026-11-01' });
  assert.equal((await one('SELECT order_date FROM crm_purchase_orders WHERE id = ?', [po.result.id])).order_date, '2026-11-01');
  await go('confirm_po', { po: po.result.id });
  await go('set_po_dispatch_date', { po: po.result.id, expected_dispatch_date: '2026-12-31' });
  const line = (await one('SELECT id FROM crm_po_items WHERE po_id = ? AND item_code = ?', [po.result.id, tag])).id;
  await go('reserve_stock', { line });
  assert.ok((await one('SELECT COUNT(*) AS n FROM reels WHERE reserved_po_item_id = ?', [line])).n > 0);
  await go('release_reservation', { line });
  await go('edit_po_line', { line, qty: 2500 });
  assert.equal((await one('SELECT quantity_ordered FROM crm_po_items WHERE id = ?', [line])).quantity_ordered, 2500);
  await go('remove_po_line', { line: (await one("SELECT id FROM crm_po_items WHERE po_id = ? AND item_code = 'SS34'", [po.result.id])).id });
  await go('add_dispatch_lot', { line, qty: 500, dispatch_date: '2026-12-01' });
  const lot = (await one('SELECT id FROM po_dispatches WHERE po_id = ? ORDER BY id DESC', [po.result.id])).id;
  await go('edit_dispatch_lot', { lot, dispatch_date: '2026-12-05' });
  assert.deepEqual({ ...(await one('SELECT quantity, dispatch_date FROM po_dispatches WHERE id = ?', [lot])) }, { quantity: 500, dispatch_date: '2026-12-05' });
  await go('delete_dispatch_lot', { lot });
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
  await go('edit_procurement', { proc: pr.result.id, expected_date: '2026-12-20', status: 'ordered' });
  assert.deepEqual({ ...(await one('SELECT status, expected_date, supplier FROM procurement_orders WHERE id = ?', [pr.result.id])) }, { status: 'ordered', expected_date: '2026-12-20', supplier: `${tag} Supplier` });
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
  // edit, then approve: fewer reels on an inward; one reel of two on a shipment
  await run('inward_stock', { item: tag, num_reels: 3, store: 'primary' }, store);
  const r3 = (await one("SELECT id FROM requests WHERE status = 'pending' AND payload LIKE ? ORDER BY id DESC", [`%${tag}%`])).id;
  const before = (await one('SELECT COUNT(*) AS n FROM reels WHERE item_code = ?', [tag])).n;
  await go('edit_approve_request', { request: r3, num_reels: 2 });
  assert.equal((await one('SELECT COUNT(*) AS n FROM reels WHERE item_code = ?', [tag])).n, before + 2);
  const two = (await S.queryAll("SELECT reel_number FROM reels WHERE item_code = ? AND status = 'In Stock' ORDER BY reel_number DESC LIMIT 2", [tag])).map((r) => r.reel_number);
  assert.ok((await run('ship_reels', { reels: two.join(', '), customer: co, invoice_number: `${tag}-INV2` }, store)).pending);
  const r4 = (await one("SELECT id FROM requests WHERE status = 'pending' AND type = 'outward' AND payload LIKE ? ORDER BY id DESC", [`%${tag}-INV2%`])).id;
  await go('edit_approve_request', { request: r4, keep: two[0] });
  assert.deepEqual((await S.queryAll('SELECT reel_number FROM outwards WHERE invoice_number = ?', [`${tag}-INV2`])).map((r) => r.reel_number), [two[0]]);
  assert.ok(!(await runAction(owner, 'edit_approve_request', { request: r4, keep: two[1] })).ok, 'a done request is not editable');

  // documents waiting for review (rows made here; the real ones come from the AI read)
  const doc = async () => (await S.execute("INSERT INTO crm_invoices (doc_type, status, party_name, invoice_no) VALUES ('purchase_invoice', 'pending', ?, ?)", [`${tag} Supplier`, `${tag}/B`])).lastId;
  await go('approve_document', { doc: await doc() });
  await go('reject_document', { doc: await doc(), notes: 'Wrong GSTIN' });

  // a partner-store sales invoice line (the demo's invoice 10001), set back to what it was
  const inv = await one("SELECT rate, hsn_code FROM sales_invoice_items WHERE invoice_no = '10001' AND item_code = 'RC0603-10K'");
  await go('set_invoice_rate', { invoice: '10001', item: 'RC0603-10K', rate: 0.07, hsn_code: '85332100' });
  assert.deepEqual({ ...(await one("SELECT rate, hsn_code, description FROM sales_invoice_items WHERE invoice_no = '10001' AND item_code = 'RC0603-10K'")) }, { rate: 0.07, hsn_code: '85332100', description: 'Resistor 10k 1% 0603' });
  await run('set_invoice_rate', { invoice: '10001', item: 'RC0603-10K', rate: inv.rate, hsn_code: inv.hsn_code });
  assert.ok(!(await runAction(owner, 'set_invoice_rate', { invoice: '10001', rate: 1 })).ok, 'two lines: the item must be named');
  await go('set_payment_reminder', { voucher: 'S-104', reminder_date: '2026-12-20' });
  assert.equal((await one("SELECT payment_reminder_date FROM crm_tally_sales_vouchers WHERE voucher_no = 'S-104'")).payment_reminder_date, '2026-12-20');
  assert.ok(await one("SELECT id FROM crm_tasks WHERE title LIKE '%S-104%' AND status = 'open' AND due_date = '2026-12-20'"));

  await go('archive_item', { item: tag });
  await go('delete_client', { client: cl.result.id });

  // roles: a staff member may not undo; a client may not act at all; missing fields are named
  const refused = await runAction(store, 'undo_transfer', { transfer: (await one('SELECT id FROM stock_transfers ORDER BY id DESC')).id });
  assert.ok(!refused.ok && refused.status === 403, `staff undo should be refused: ${refused.error}`);
  const client = await runAction({ id: 6, username: 'customer', role: 'client' }, 'add_task', { title: 'x', due_date: day });
  assert.ok(!client.ok && client.status === 403);
  const missing = await runAction(owner, 'add_client', {});
  assert.ok(!missing.ok && /Missing: poc_name/.test(missing.error));

  // ---- 3. Auto mode (Settings → AI). A scratch copy, so the settings rows may be written; put back to the defaults after. ----
  const { undoAction } = require('../utils/actionRunner');
  const setAuto = (actions, roles) => require('../utils/assistant').setSettings('check', [['assistant_actions', actions], ['assistant_auto_roles', JSON.stringify(roles)]]);
  const auto = (who, key, fields) => runAction(who, key, fields, { auto: true });
  const undo = async (r, who = owner) => { assert.ok(r.ok && r.undo_token, `auto save should give an undo: ${r.error}`); const u = await undoAction(who, r.undo_token); assert.ok(u.ok, `undo: ${u.error}`); };
  const tag2 = `${tag}A`;
  await setAuto('on', ['admin']);
  // a role not ticked, and an always-confirm action, get the card (nothing saved)
  assert.ok((await auto(store, 'add_task', { title: `${tag2} no`, due_date: day })).needsConfirm, 'staff not ticked for Auto');
  assert.ok(!(await one('SELECT id FROM crm_tasks WHERE title = ?', [`${tag2} no`])));
  const keep = (await one("SELECT id FROM crm_tasks WHERE status = 'open' ORDER BY id DESC")).id;
  assert.ok((await auto(owner, 'delete_task', { task: keep })).needsConfirm, 'a delete always confirms');
  assert.ok(await one('SELECT id FROM crm_tasks WHERE id = ?', [keep]));
  assert.ok((await auto(owner, 'log_client_note', { client: neha, body: 'x' })).needsConfirm, 'no clean reverse: card only');
  // saved at once, then undone through the routes' own reverse
  const added = await auto(owner, 'add_item', { item_code: tag2, description: 'Auto part', default_spq: 500 });
  assert.ok(added.ok && added.undo_token);
  const ed = await auto(owner, 'edit_item', { item: tag2, description: 'Auto part, edited' });
  await undo(ed);
  assert.equal((await one('SELECT description FROM items WHERE item_code = ?', [tag2])).description, 'Auto part');
  await run('set_item_price', { item: tag2, sale_rate: 1, hsn_code: '8542' }); // the partner store needs invoice details
  const inw = await auto(owner, 'inward_stock', { item: tag2, num_reels: 2, store: 'primary' });
  const r2s = (await S.queryAll("SELECT reel_number FROM reels WHERE item_code = ? AND status = 'In Stock' ORDER BY reel_number", [tag2])).map((r) => r.reel_number);
  await undo(await auto(owner, 'transfer_stock', { unit: r2s[0], to_store: 'secondary' }));
  assert.equal((await one('SELECT store_code FROM reels WHERE reel_number = ?', [r2s[0]])).store_code, 'primary');
  await undo(await auto(owner, 'ship_reels', { reels: r2s[1], customer: co, invoice_number: `${tag2}-INV` }));
  assert.equal((await one('SELECT status FROM reels WHERE reel_number = ?', [r2s[1]])).status, 'In Stock');
  await undo(inw);
  assert.equal((await one("SELECT COUNT(*) AS n FROM reels WHERE item_code = ? AND status != 'Deleted'", [tag2])).n, 0);
  await undo(await auto(owner, 'add_task', { title: `${tag2} task`, due_date: day }));
  assert.ok(!(await one('SELECT id FROM crm_tasks WHERE title = ?', [`${tag2} task`])));
  const pooja = (await one('SELECT id, status FROM crm_contacts WHERE poc_name = ?', [market('Pooja Iyer')]));
  await undo(await auto(owner, 'set_client_stage', { client: pooja.id, status: 'lost' }));
  assert.equal((await one('SELECT status FROM crm_contacts WHERE id = ?', [pooja.id])).status, pooja.status);
  await undo(added);
  assert.equal((await one('SELECT status FROM items WHERE item_code = ?', [tag2])).status, 'Deleted');
  // staff ticked for Auto: their stock entries still go for approval (no undo), their task saves at once
  await setAuto('on', ['admin', 'user']);
  const sp = await auto(store, 'inward_stock', { item: 'SS34', num_reels: 1, store: 'primary' });
  assert.ok(sp.needsConfirm, 'staff inward: no clean undo for staff, so the card (and then approval)');
  await undo(await auto(store, 'add_task', { title: `${tag2} staff`, due_date: day }), store);
  // an undo token is this login's only
  const other = await auto(owner, 'add_task', { title: `${tag2} mine`, due_date: day });
  assert.equal((await undoAction(store, other.undo_token)).status, 403);
  await undoAction(owner, other.undo_token);
  // switched off: no changes at all, Auto or not
  await setAuto('off', ['admin']);
  assert.equal((await runAction(owner, 'add_task', { title: `${tag2} off`, due_date: day })).status, 403);
  assert.ok(!require('../utils/assistant').autoAllowed(await require('../utils/assistant').getSettings(), 'admin'));
  await setAuto('on', []);

  const untested = ACTIONS.map((a) => a.key).filter((k) => !done.includes(k));
  assert.deepEqual(untested, [], `not run end to end: ${untested.join(', ')}`);
  console.log(`check-actions: ${cases.length} sentences filled, all ${ACTIONS.length} actions ran end to end, role checks held, Auto + Undo held`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
