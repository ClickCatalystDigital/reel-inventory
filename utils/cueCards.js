// Cue Cards (/cue-cards): the prompts Ohm AI understands, by area and by level. Each card names what it should trigger
// (`expect`), and scripts/assistant-eval.js asks every card through the real pipeline, so a card on the page is one that
// works. {slots} are filled from this system's own records (fillCards), so the cards read right on any deployment: the
// demo, the US demo or lstechnologies.in. A card whose record doesn't exist here is left out.
// Includes the tested questions on ahromlabs.com/ai-assistant/trading-distribution.
const { queryOne } = require('../db/schema');
const brand = require('./brand');

// The capability ladder. Predict and Optimize are built separately and shown as coming.
const LEVELS = [
  { key: 'know', n: 1, label: 'Know', blurb: 'Explains how the app and the stock processes work.', status: 'live' },
  { key: 'diagnose', n: 2, label: 'Diagnose', blurb: 'Reads your records and points out what needs attention. Every number comes straight from the data.', status: 'live' },
  { key: 'predict', n: 3, label: 'Predict', blurb: 'Forecasts shortages, demand and delays.', status: 'soon' },
  { key: 'optimize', n: 4, label: 'Optimize', blurb: 'Recommends what to buy, reserve or move.', status: 'soon' },
  { key: 'execute', n: 5, label: 'Execute', blurb: 'Makes everyday changes for you. Each one shows as a card first and is saved only when you press Save.', status: 'live' },
];

const AREAS = [
  { key: 'today', label: 'Today' },
  { key: 'stock', label: 'Stock & catalog' },
  { key: 'moves', label: 'Inward, outward & transfers' },
  { key: 'orders', label: 'Customer POs' },
  { key: 'buying', label: 'Buying & bills' },
  { key: 'clients', label: 'Clients & follow-ups' },
];

const K = 'know', D = 'diagnose', X = 'execute';
const US = process.env.MARKET === 'NA';
const PHONE = US ? '(512) 555-0142' : '98250 12345';
const text = { type: 'text' };
const tool = (t) => ({ type: 'table', tool: t });
const act = (a) => ({ type: 'draft', draft: 'action', action: a });

// [area, level, prompt, expect]
const CARDS = [
  ['today', D, 'What happened today?', tool('daily_report')],
  ['today', D, 'Are any approval requests waiting?', tool('pending_requests')],
  ['today', D, "What's overdue?", tool('tasks')],
  ['today', K, 'Where do I approve requests?', text],
  ['today', X, 'Approve request {request}', act('approve_request')],
  ['today', X, 'Reject request {request2}, wrong quantity', act('reject_request')],
  ['today', X, 'The {task} task is done', act('complete_task')],
  ['today', X, 'Move the {task} task to Friday', act('reschedule_task')],

  ['stock', D, 'How many reels of {item} do we have, in each store?', tool('stock_for_item')],
  ['stock', D, 'What is running low?', tool('low_stock')],
  ['stock', D, `Low stock at ${brand.partnerStore}`, tool('low_stock')],
  ['stock', D, "Which items haven't shipped in 30 days?", tool('dead_stock')],
  ['stock', D, 'What is our total stock?', tool('stock_overview')],
  ['stock', D, 'Which items will run out in 30 days?', tool('stock_cover')],
  ['stock', D, 'Do we have any {item_word}?', tool('search_items')],
  ['stock', D, 'Where is {reel}?', tool('trace')],
  ['stock', D, 'What is in {box}?', tool('trace')],
  ['stock', K, 'How do I add a new item to the catalog?', text],
  ['stock', X, 'Add item BC817-40 NPN transistor SOT-23, 3000 per reel', act('add_item')],
  ['stock', X, 'Set the rate of {item} to 4.9', act('set_item_price')],
  ['stock', X, 'Change the SPQ of {item} to 2000', act('edit_item')],

  ['moves', D, 'What came in last week?', tool('inward_history')],
  ['moves', D, 'What did we ship to {customer} this month?', tool('outward_by_customer')],
  ['moves', D, 'What moved between our two stores this month?', tool('stock_transfers')],
  ['moves', K, 'How do I receive new reels?', text],
  ['moves', K, `How do I transfer stock to ${brand.partnerStore}?`, text],
  ['moves', X, 'Received 4 reels of {item} at the main store', act('inward_stock')],
  ['moves', X, 'Ship {reel} to {customer}, invoice INV-9001', act('ship_reels')],
  ['moves', X, `Move {reel} to ${brand.partnerStore}`, act('transfer_stock')],
  ['moves', X, 'Undo the transfer of {moved_reel}', act('undo_transfer')],
  ['moves', X, 'Undo the shipment of {shipped_reel}', act('undo_outward')],

  ['orders', D, 'Which purchase orders are confirmed but not dispatched?', tool('purchase_orders')],
  ['orders', D, 'What is the status of {po}?', tool('purchase_orders')],
  ['orders', D, 'How much are the confirmed POs worth?', tool('purchase_orders')],
  ['orders', X, '{customer} sent a new PO for 5000 {item} at 1.9', act('create_po')],
  ['orders', X, 'Confirm {draft_po}', act('confirm_po')],
  ['orders', X, 'Reserve stock for the {po_line}', act('reserve_stock')],
  ['orders', X, 'Move the {po} dispatch date to the 28th', act('set_po_dispatch_date')],

  ['buying', X, 'Order 10000 {item} from {supplier} at 3.1', act('create_procurement')],
  ['buying', X, 'The {proc_item} order from the supplier is under QC now', act('set_procurement_stage')],
  ['buying', X, 'Approve bill {doc}', act('approve_document')],

  ['clients', D, 'How many clients are at each stage?', tool('clients_pipeline')],
  ['clients', D, 'Who is on the client watch list?', tool('clients_pipeline')],
  ['clients', D, 'Which customers have stopped ordering?', tool('customer_activity')],
  ['clients', D, 'What did we last discuss with {company}?', tool('client_notes')],
  ['clients', K, 'How do I add a new client?', text],
  ['clients', X, `Add a new client Ravi Menon from Apex Drives, ${PHONE}`, act('add_client')],
  ['clients', X, 'Log a call with {contact}: wants 15k next month', act('log_client_note')],
  ['clients', X, 'Put {contact} on the watch list', act('set_client_watch')],
  ['clients', X, 'Add a task to call {contact} on Friday', act('add_task')],
].map(([area, level, q, expect]) => ({ area, level, q, expect }));

// One real record per slot, the kind each card needs (an item with stock, a confirmed PO, a pending request…).
const SLOT_SQL = {
  item: "SELECT r.item_code AS v FROM reels r JOIN items i ON i.item_code = r.item_code AND i.status = 'active' WHERE r.status = 'In Stock' AND r.store_code = 'primary' GROUP BY r.item_code ORDER BY COUNT(*) DESC LIMIT 1",
  item_word: "SELECT i.description AS v FROM items i WHERE i.status = 'active' AND i.description LIKE '% %' ORDER BY length(i.description) LIMIT 1",
  reel: "SELECT reel_number AS v FROM reels WHERE status = 'In Stock' AND store_code = 'primary' AND reserved_po_item_id IS NULL ORDER BY reel_number DESC LIMIT 1",
  box: "SELECT box_number AS v FROM reels WHERE status = 'In Stock' AND box_number IS NOT NULL ORDER BY box_number DESC LIMIT 1",
  moved_reel: "SELECT t.reel_number AS v FROM stock_transfers t JOIN reels r ON r.reel_number = t.reel_number AND r.store_code = t.to_store AND r.status = 'In Stock' ORDER BY t.id DESC LIMIT 1",
  shipped_reel: 'SELECT reel_number AS v FROM outwards ORDER BY id DESC LIMIT 1',
  customer: `SELECT co.name AS v FROM outwards o JOIN crm_companies co ON co.id = o.company_id GROUP BY co.id ORDER BY COUNT(*) DESC LIMIT 1`,
  company: 'SELECT co.name AS v FROM crm_notes n JOIN crm_contacts c ON c.id = n.contact_id JOIN crm_companies co ON co.id = c.company_id ORDER BY n.id DESC LIMIT 1',
  contact: "SELECT poc_name AS v FROM crm_contacts WHERE status != 'lost' ORDER BY id LIMIT 1",
  task: "SELECT title AS v FROM crm_tasks WHERE status = 'open' AND contact_id IS NULL ORDER BY length(title) LIMIT 1",
  request: "SELECT id AS v FROM requests WHERE status = 'pending' ORDER BY id LIMIT 1",
  request2: "SELECT id AS v FROM requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1",
  po: "SELECT po_number AS v FROM crm_purchase_orders WHERE status = 'confirmed' ORDER BY id DESC LIMIT 1",
  draft_po: "SELECT po_number AS v FROM crm_purchase_orders WHERE status = 'draft' ORDER BY id DESC LIMIT 1",
  po_line: "SELECT pi.item_code || ' line on ' || p.po_number AS v FROM crm_po_items pi JOIN crm_purchase_orders p ON p.id = pi.po_id WHERE p.status = 'confirmed' ORDER BY p.id, pi.id LIMIT 1",
  supplier: "SELECT supplier AS v FROM procurement_orders ORDER BY id DESC LIMIT 1",
  proc_item: "SELECT i.item_code AS v FROM procurement_items i JOIN procurement_orders o ON o.id = i.proc_id WHERE i.stage NOT IN ('Received', 'Under QC') AND o.status NOT IN ('cancelled', 'closed') LIMIT 1",
  doc: "SELECT invoice_no AS v FROM crm_invoices WHERE status = 'pending' AND invoice_no IS NOT NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
};

// How a record reads in a sentence: before " — ", a comma or a colon; companies without "Pvt Ltd"; a task in lower case.
const short = (slot, v) => {
  let s = String(v).split(' — ')[0].split(',')[0].split(':')[0].trim();
  if (['customer', 'company', 'supplier'].includes(slot)) s = s.replace(/\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|distributors|co\.?)(\s|$).*$/i, '').trim();
  if (slot === 'item_word') s = `${s.split(' ')[0].toLowerCase().replace(/s$/, '')}s`; // "Varistor 14D471K" → "varistors"
  return slot === 'task' ? s.charAt(0).toLowerCase() + s.slice(1) : s;
};

async function fillCards() {
  const values = {};
  for (const [slot, sql] of Object.entries(SLOT_SQL)) {
    const r = await queryOne(sql).catch(() => null);
    if (r?.v != null && r.v !== '') values[slot] = short(slot, r.v);
  }
  const out = [];
  for (const c of CARDS) {
    const slots = [...c.q.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (slots.some((s) => values[s] == null)) continue;
    out.push({ ...c, q: c.q.replace(/\{(\w+)\}/g, (_, s) => values[s]) });
  }
  return out;
}

module.exports = { LEVELS, AREAS, CARDS, fillCards };
