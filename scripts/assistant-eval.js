// Ohm AI evaluation: runs a fixed set of questions through the real pipeline in DRY mode (no daily-cap use, no writing
// model) with the REAL Jev model, and compares what it decided against what we expect. Costs a few cents.
//   node scripts/assistant-eval.js            (needs OPEN_ROUTER_KEY in .env or a key saved in Settings, and SETTINGS_ENC_KEY in .dev.vars)
// It never writes settings: the key and the data-access consent are overridden in-process (the shared database may hold the REAL key and
// consent, which this script must not touch). It only removes its own assistant_log rows.
require('dotenv').config();
const fs = require('fs');
if (!process.env.SETTINGS_ENC_KEY && fs.existsSync('.dev.vars')) process.env.SETTINGS_ENC_KEY = (fs.readFileSync('.dev.vars', 'utf8').match(/^SETTINGS_ENC_KEY=(.*)$/m) || [])[1];
const A = require('../utils/assistant');
const S = require('../db/schema');
const { turn } = require('../utils/assistantChat');
// in-process overrides: use OPEN_ROUTER_KEY from .env and pretend consent is on — nothing is written to app_settings
A.getKey = async () => process.env.OPEN_ROUTER_KEY;
const realSettings = A.getSettings;
A.getSettings = async () => ({ ...(await realSettings()), dataAccess: { on: true } });

// expect: reply type (table | text | ask), tool (for table), kind-ish text match (for text), params that must appear
const CASES = [
  // --- stock ---
  ['How many reels of 0603103KB500 do we have?', { type: 'table', tool: 'stock_for_item', has: ['Item=0603103KB500'] }],
  ['stock of 0402103JB500 at Gelco Stores', { type: 'table', tool: 'stock_for_item', has: ['Store=Gelco Stores'] }],
  ['What is our total stock?', { type: 'table', tool: 'stock_overview' }],
  ['top items by quantity at LS Tech Stores', { type: 'table', tool: 'stock_overview', has: ['Store=LS Tech Stores'] }],
  ["What's running low?", { type: 'table', tool: 'low_stock' }],
  ['low stock at Gelco Stores', { type: 'table', tool: 'low_stock', has: ['Store=Gelco Stores'] }],
  ['which items have not moved in a month', { type: 'table', tool: 'dead_stock' }],
  ['do we have 22pf disc caps', { type: 'table', tool: 'search_items' }],
  ['BLDC CARD stock', { type: 'ask' }],
  // --- movements ---
  ['what came in last week', { type: 'table', tool: 'inward_history' }],
  ['inward in September', { type: 'table', tool: 'inward_history', has: ['Period=September 2026'] }],
  ['What did we ship to Gelco in September?', { type: 'table', tool: 'outward_by_customer', has: ['Customer=Gelco Electronics Pvt. Ltd.', 'Store=All stores'] }],
  ['top customers this year', { type: 'table', tool: 'outward_by_customer', has: ['Period=This year'] }],
  ['what did we ship to Sansui', { type: 'table', tool: 'outward_by_customer' }],
  ['shipments to impax last 30 days', { type: 'table', tool: 'outward_by_customer' }],
  ['what moved to Gelco Stores this month', { type: 'table', tool: 'stock_transfers' }],
  ['transfers in September', { type: 'table', tool: 'stock_transfers', has: ['Period=September 2026'] }],
  ['where is REEL-15665', { type: 'table', tool: 'trace', has: ['Reel=REEL-15665'] }],
  ['what is in BOX-1582', { type: 'table', tool: 'trace', has: ['Box=BOX-1582'] }],
  ["today's numbers", { type: 'table', tool: 'daily_report' }],
  ['daily report for 2 Oct', { type: 'table', tool: 'daily_report', has: ['Period=2 Oct 2026'] }],
  // --- ops / CRM ---
  ['any approvals waiting?', { type: 'table', tool: 'pending_requests' }],
  ['which POs are confirmed but not dispatched', { type: 'table', tool: 'purchase_orders' }],
  ['status of PO P0055838', { type: 'table', tool: 'purchase_orders', has: ['PO=P0055838'] }],
  ["what's overdue for zakir", { type: 'table', tool: 'tasks', has: ['Person=zakir'] }],
  ['how many tasks are open', { type: 'table', tool: 'tasks' }],
  ['who is on the client watch list', { type: 'table', tool: 'clients_pipeline' }],
  ['how many clients at each stage', { type: 'table', tool: 'clients_pipeline' }],
  // --- how-to ---
  ['how do I ship reels to a customer', { type: 'text', title: 'Outward' }],
  ['where can I see low stock items', { type: 'text', title: 'Dead & Low Stock' }],
  ['how does the gelco daily approval work', { type: 'text', title: 'Gelco daily approval' }],
  // --- must refuse / deflect ---
  ['delete REEL-15665', { type: 'text', says: /can only look things up/i }],
  ['approve all pending requests', { type: 'text', says: /can only look things up/i }],
  ['create a new client called Acme', { type: 'text', says: /can only look things up/i }],
  ['what is the capital of France', { type: 'text', says: /only help with LS TECH/i }],
  ['write me a python script', { type: 'text', says: /only help with LS TECH/i }],
  ['hello', { type: 'text', says: /Hi!/ }],
  // --- complex: follow-ups carry the subject, comparisons, two look-ups (3rd item = the question asked just before) ---
  ['and last month?', { type: 'table', tool: 'inward_history', has: ['Period=Last month'] }, 'what came in this month'],
  ['what about Gelco Stores?', { type: 'table', tool: 'low_stock', has: ['Store=Gelco Stores'] }, "what's running low?"],
  ['and in September?', { type: 'table', tool: 'outward_by_customer', has: ['Customer=Gelco Electronics Pvt. Ltd.', 'Period=September 2026'] }, 'what did we ship to Gelco in August'],
  ['compare shipments this month with last month', { type: 'table', tool: 'outward_by_customer', says: /vs September 2026/ }],
  ['inward in September versus August', { type: 'table', tool: 'inward_history', says: /September 2026 vs August 2026/ }],
  // --- coverage gaps found by the 2026-10-06 probe ---
  ['what has Gelco Stores done today', { type: 'table', tool: 'daily_report', has: ['Store=Gelco Stores'] }],
  ['what tasks does zakir have this week', { type: 'table', tool: 'tasks', has: ['Person=zakir', 'Period=This week'] }],
  ['when is the next follow up with Sansui', { type: 'table', tool: 'tasks', has: ['Client=SANSUI ELECTRONICS'] }],
  ['which clients have we not contacted', { type: 'table', tool: 'clients_pipeline', says: /never logged|no call note/ }],
  ['which customers stopped ordering', { type: 'table', tool: 'customer_activity', says: /quiet/ }],
  ['how often does Gelco Electronics order', { type: 'table', tool: 'customer_activity', has: [] }],
  ['will 0603103KB500 run out soon', { type: 'table', tool: 'stock_cover', has: ['Item=0603103KB500'] }],
  ['which items will run out in the next 30 days', { type: 'table', tool: 'stock_cover' }],
  ['what did pranav approve yesterday', { type: 'table', tool: 'pending_requests', has: ['Person=pranav', 'Period=Yesterday (5 Oct 2026)'] }],
  ['show me the notes on Rotomotive', { type: 'table', tool: 'client_notes', has: ['Client=Rotomotive Powerdrives India LTD'] }],
  ['how much are the confirmed POs worth', { type: 'table', tool: 'purchase_orders', says: /worth/ }],
  ['how much revenue did we make from Gelco shipments', { type: 'text', says: /don't carry prices/ }],
  ['who inwarded REEL-15665', { type: 'text', says: /doesn't record which staff/ }],
  ['what should I order next month', { type: 'text', says: /can't give recommendations/ }],
  ['low stock and pending approvals', { type: 'table', tool: 'low_stock', second: 'pending_requests' }],
];

// Actions (a card only; nothing is saved: dry mode, and a card needs Save). Named after the DEMO's sample data, so they run
// with EVAL_SET=demo against a local scratch copy of the demo golden DB:
//   DEMO_MODE=1 EVAL_SET=demo TURSO_URL=http://127.0.0.1:8089 node scripts/assistant-eval.js
const act = (action) => ({ type: 'draft', action });
const DEMO_CASES = [
  ['received 4 reels of SS34 at the main store', act('inward_stock')],
  ['6 reels of BC857B came in today, packed in 2 boxes', act('inward_stock')],
  ['ship REEL-10031 and REEL-10032 to Voltix, invoice INV-9001', act('ship_reels')],
  ['outward BOX-1004 to Brightline against invoice INV-778', act('ship_reels')],
  ['move REEL-10060 to the Partner Store', act('transfer_stock')],
  ['send BOX-1004 back to the main store', act('transfer_stock')],
  ['undo the transfer of REEL-10060', act('undo_transfer')],
  ['reverse the shipment of REEL-10031, it was entered by mistake', act('undo_outward')],
  ['approve request 4', act('approve_request')],
  ["approve store's LM358DR inward request", act('approve_request')],
  ['reject request 6, the partner store has enough', act('reject_request')],
  ['reserve stock for the SS34 line on SYS-2', act('reserve_stock')],
  ['set aside the BC857B for SYS-4', act('reserve_stock')],
  ['release the reservation on the SS34 line of SYS-2', act('release_reservation')],
  ['add item BC817-40 NPN transistor SOT-23, 3000 per reel', act('add_item')],
  ['new part TPS5430 buck converter, 2500 pcs per reel', act('add_item')],
  ['change the SPQ of SS34 to 2000', act('edit_item')],
  ['set the rate of LM358DR to 4.9', act('set_item_price')],
  ['HSN code for SS34 is 85411000', act('set_item_price')],
  ['archive the item MOV-14D471', act('archive_item')],
  ['add a new client Ravi Menon from Apex Drives, 98250 12345', act('add_client')],
  ['new lead: Kavita Shah at Lumen Controls', act('add_client')],
  ['log a call with Neha Kapoor: wants 15k BC857B next month', act('log_client_note')],
  ['spoke to Rahul Bansal, Voltix will send the next PO in December', act('log_client_note')],
  ['Pooja Iyer is now qualified', act('set_client_stage')],
  ['we lost Arvind Rao', act('set_client_stage')],
  ['put Imran Shaikh on the watch list', act('set_client_watch')],
  ["Neha Kapoor's new number is 98250 99999", act('edit_client')],
  ['delete the client Arvind Rao', act('delete_client')],
  ['add a task to call Neha Kapoor about the call-off on Friday', act('add_task')],
  ['remind me to chase Orbit about the overdue payment tomorrow', act('add_task')],
  ['the cycle count task is done', act('complete_task')],
  ['reopen the SYS-1 post-dispatch follow up task', act('reopen_task')],
  ['move the cycle count task to Monday', act('reschedule_task')],
  ['give the freight invoice task to store', act('assign_task')],
  ['delete the freight invoice review task', act('delete_task')],
  ['Voltix sent a new PO VM/889 for 5000 SS34 at 1.9', act('create_po')],
  ['new purchase order from Northwind for 2000 LM358DR', act('create_po')],
  ['add 3000 BC847C at 0.4 to SYS-5', act('add_po_line')],
  ['confirm SYS-5', act('confirm_po')],
  ['SYS-2 has been dispatched', act('dispatch_po')],
  ['move the SYS-3 dispatch date to the 28th', act('set_po_dispatch_date')],
  ['plan a dispatch lot of 5000 BC857B on SYS-4 for the 20th', act('add_dispatch_lot')],
  ['cancel SYS-5, Northwind dropped it', act('cancel_po')],
  ['order 10000 LM358DR from Lotus Semicon at 3.1', act('create_procurement')],
  ['the LM358DR from the supplier is in transit now', act('set_procurement_stage')],
  ['cancel procurement order PRC-1', act('cancel_procurement')],
  ['approve the bill of entry BE-2291', act('approve_document')],
  ['reject bill BE-2291, the GSTIN is wrong', act('reject_document')],
  // a request we can't do is a plain no, not neighbouring data
  ['change my password', { type: 'text', says: /can't do that one|Settings/i }],
];
// The US demo (MARKET=NA) has the same sample records under American names.
const US_NAMES = [['Neha Kapoor', 'Emily Carter'], ['Rahul Bansal', 'Jason Miller'], ['Imran Shaikh', 'Marcus Reed'], ['Pooja Iyer', 'Laura Chen'], ['Arvind Rao', 'Daniel Ortiz'], ['Neha', 'Emily']];
const market = (s) => (process.env.MARKET === 'NA' ? US_NAMES.reduce((t, [a, b]) => t.split(a).join(b), s) : s);
if (process.env.EVAL_SET === 'demo') CASES.splice(0, CASES.length, ...DEMO_CASES.map(([q, e]) => [market(q), e]));

(async () => {
  // Every Cue Card (utils/cueCards.js) is a promise that the prompt works: ask each one too, filled from this database.
  for (const c of await require('../utils/cueCards').fillCards()) {
    if (!CASES.some(([q]) => q.toLowerCase() === c.q.toLowerCase())) CASES.push([c.q, c.expect.type === 'draft' ? act(c.expect.action) : c.expect]);
  }
  // EVAL_ONLY=<regex>: run just the matching questions.
  const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY, 'i') : null;
  if (only) CASES.splice(0, CASES.length, ...CASES.filter(([q]) => only.test(q)));
  let pass = 0, fail = 0, cost = 0, ms = 0; const bad = [];
  try {
    for (const [q, exp, prevQ] of CASES) {
      let msgs = [{ role: 'user', content: q }], context;
      if (prevQ) {
        const p = await turn({ user: 'eval', messages: [{ role: 'user', content: prevQ }], path: '/', dry: true }); cost += p.body.meta?.cost || 0;
        context = p.body.reply?.context;
        msgs = [{ role: 'user', content: prevQ }, { role: 'assistant', content: 'ok' }, { role: 'user', content: q }];
      }
      const r = await turn({ user: 'eval', messages: msgs, path: '/', dry: true, context });
      const rep = r.body.reply || {}; cost += r.body.meta?.cost || 0; ms += r.body.meta?.ms || 0;
      const params = (rep.params || []).map((p) => `${p.label}=${p.value}`);
      const errs = [];
      if (rep.type !== exp.type) errs.push(`type ${rep.type} != ${exp.type}`);
      if (exp.tool && rep.tool !== exp.tool) errs.push(`tool ${rep.tool} != ${exp.tool}`);
      if (exp.action && rep.draft?.action !== exp.action) errs.push(`action ${rep.draft?.action} != ${exp.action}`);
      for (const h of exp.has || []) if (!params.includes(h)) errs.push(`missing ${h} (have ${params.join(', ') || 'none'})`);
      if (exp.title && !(rep.title || '').includes(exp.title)) errs.push(`title "${rep.title}" lacks "${exp.title}"`);
      if (exp.second && !(rep.cards || []).some((c) => c.tool === exp.second)) errs.push(`no second card ${exp.second}`);
      if (exp.says && exp.type === 'table' && !exp.says.test(`${rep.title} ${rep.summary} ${rep.note || ''}`)) errs.push(`summary "${(rep.summary || '').slice(0, 60)}" doesn't match ${exp.says}`);
      else if (exp.says && exp.type !== 'table' && !exp.says.test(rep.text || '')) errs.push(`text "${(rep.text || '').slice(0, 60)}" doesn't match ${exp.says}`);
      if (errs.length) { fail++; bad.push(`  ✗ ${q}\n      ${errs.join('; ')}\n      trace: ${(r.body.meta?.trace || []).join(' | ')}`); } else pass++;
    }
  } finally {
    await S.execute("DELETE FROM assistant_log WHERE asked_by = 'eval'");
  }
  if (bad.length) console.log(bad.join('\n'));
  console.log(`\n${pass}/${pass + fail} as expected · Jev cost $${cost.toFixed(4)} · avg ${Math.round(ms / CASES.length)} ms per question`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
