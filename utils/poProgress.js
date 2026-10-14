// Where each customer PO line stands: ordered, dispatched (real outwards on that PO), reserved (whole reels
// set aside at LS Tech Stores), in procurement (allocated on China orders not yet received), still needed —
// and a status derived from those. PO status = its least advanced line. Used by Orders, the PO overlay and
// the customer portal, so they always agree.
const { readBatch } = require('../db/schema');
const { LINE_STATUSES } = require('./poStages');

const ins = (n) => Array(n).fill('?').join(',');
const rank = (s) => LINE_STATUSES.indexOf(s);

// → { lines: [...], byPo: { [poId]: { status, lines } } } for the given PO ids. Four queries, two round trips.
// Allocations only ever hold what is still to arrive: receiving moves qty from the allocation onto reserved reels.
async function progress(poIds) {
  if (!poIds.length) return { lines: [], byPo: {} };
  const [lines, shipped, procs] = await readBatch([
    [`SELECT pi.id, pi.po_id, pi.item_code, pi.quantity_ordered, pi.unit_price, pi.notes, i.description
        FROM crm_po_items pi LEFT JOIN items i ON i.item_code = pi.item_code
       WHERE pi.po_id IN (${ins(poIds.length)}) ORDER BY pi.id`, poIds],
    [`SELECT o.po_id, r.item_code, SUM(o.quantity_shipped) AS qty FROM outwards o JOIN reels r ON r.reel_number = o.reel_number
       WHERE o.po_id IN (${ins(poIds.length)}) GROUP BY o.po_id, r.item_code`, poIds],
    [`SELECT pi.po_id, a.po_item_id, a.qty, it.stage, it.id AS proc_item_id, po.id AS proc_id, po.number, po.expected_date
        FROM procurement_allocations a
        JOIN procurement_items it ON it.id = a.proc_item_id
        JOIN procurement_orders po ON po.id = it.proc_id AND po.status != 'cancelled'
        JOIN crm_po_items pi ON pi.id = a.po_item_id
       WHERE pi.po_id IN (${ins(poIds.length)})`, poIds],
  ]);
  const lineIds = lines.rows.map((l) => l.id);
  const [reserved] = lineIds.length
    ? await readBatch([[`SELECT reserved_po_item_id AS id, SUM(quantity) AS qty, COUNT(*) AS reels FROM reels
        WHERE reserved_po_item_id IN (${ins(lineIds.length)}) AND status = 'In Stock' GROUP BY reserved_po_item_id`, lineIds]])
    : [{ rows: [] }];
  const resBy = Object.fromEntries(reserved.rows.map((r) => [r.id, r]));
  // Outwards record the PO, not the line: hand each item's shipped qty to that item's lines in order.
  const left = {};
  for (const s of shipped.rows) left[`${s.po_id}|${s.item_code}`] = s.qty;
  const procBy = {};
  for (const p of procs.rows) (procBy[p.po_item_id] ||= []).push(p);

  const out = lines.rows.map((l) => {
    const key = `${l.po_id}|${l.item_code}`;
    const dispatched = Math.min(left[key] || 0, l.quantity_ordered);
    left[key] = (left[key] || 0) - dispatched;
    const res = resBy[l.id] || { qty: 0, reels: 0 };
    const procurement = (procBy[l.id] || []).map((p) => ({ proc_id: p.proc_id, proc_item_id: p.proc_item_id, number: p.number, stage: p.stage, qty: p.qty, expected_date: p.expected_date }));
    const open = procurement.filter((p) => p.stage !== 'Received');
    const in_procurement = open.reduce((s, p) => s + p.qty, 0);
    const remaining = l.quantity_ordered - dispatched;
    const needed = Math.max(0, remaining - res.qty - in_procurement);
    let status;
    if (remaining <= 0) status = 'Completed';
    else if (res.qty >= remaining) status = dispatched > 0 ? 'Dispatch' : 'Ready';
    else if (open.length) status = open.reduce((a, p) => (rank(p.stage) < rank(a) ? p.stage : a), open[0].stage);
    else status = 'Not planned';
    return { ...l, ordered: l.quantity_ordered, dispatched, reserved: res.qty, reserved_reels: res.reels, in_procurement, needed, status, procurement };
  });
  const byPo = {};
  for (const l of out) (byPo[l.po_id] ||= { lines: [] }).lines.push(l);
  for (const v of Object.values(byPo)) v.status = v.lines.reduce((a, l) => (rank(l.status) < rank(a) ? l.status : a), 'Completed');
  return { lines: out, byPo };
}

module.exports = { progress };
