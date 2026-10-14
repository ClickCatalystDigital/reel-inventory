// Receiving a procurement (China) order item: called by executeInward when reels are inwarded against it.
// Adds the received qty, marks the item Received once complete (and the order closed once every item is),
// and reserves the new reels to the customer PO lines waiting on it — earliest expected delivery first —
// moving that qty off the allocation (allocations only ever hold what is still to arrive). Reels left over
// are free LS stock. Whole reels, so the last line served may get a little more than it was waiting for.
const { queryAll, queryOne, batch, nowIST } = require('../db/schema');

async function procItemFor(procItemId, itemCode) {
  const it = await queryOne(`SELECT it.*, po.status AS order_status, po.number FROM procurement_items it
    JOIN procurement_orders po ON po.id = it.proc_id WHERE it.id = ?`, [procItemId]);
  if (!it) throw new Error('Procurement item not found');
  if (it.item_code !== itemCode) throw new Error(`${it.number} line is for ${it.item_code}, not ${itemCode}`);
  if (['cancelled', 'closed'].includes(it.order_status) || it.stage === 'Received') throw new Error(`${it.number} ${it.item_code} is already received or closed`);
  return it;
}

async function allocateReceived(procItemId, reels, user) {
  const it = await queryOne('SELECT * FROM procurement_items WHERE id = ?', [procItemId]);
  const got = reels.reduce((s, r) => s + r.quantity, 0);
  const received = it.qty_received + got;
  const done = received >= it.qty_ordered;
  const waiting = await queryAll(`SELECT a.id, a.po_item_id, a.qty FROM procurement_allocations a
      JOIN crm_po_items pi ON pi.id = a.po_item_id JOIN crm_purchase_orders p ON p.id = pi.po_id
     WHERE a.proc_item_id = ? AND a.qty > 0 AND p.status != 'cancelled'
     ORDER BY p.expected_dispatch_date IS NULL, p.expected_dispatch_date, p.id, a.id`, [procItemId]);
  const stmts = [
    ['UPDATE procurement_items SET qty_received = ?, stage = ?, stage_updated_by = ?, stage_updated_at = ? WHERE id = ?',
      [received, done ? 'Received' : it.stage, user, nowIST(), procItemId]],
  ];
  const queue = [...reels];
  const now = nowIST();
  for (const a of waiting) {
    let covered = 0;
    const take = [];
    while (covered < a.qty && queue.length) { const r = queue.shift(); take.push(r.reel_number); covered += r.quantity; }
    if (!take.length) break;
    stmts.push([`UPDATE reels SET reserved_po_item_id = ?, reserved_at = ?, reserved_by = ? WHERE reel_number IN (${take.map(() => '?').join(',')})`, [a.po_item_id, now, user, ...take]]);
    stmts.push(['UPDATE procurement_allocations SET qty = ? WHERE id = ?', [Math.max(0, a.qty - covered), a.id]]);
  }
  if (done) {
    // A fully received item owes nothing more to anyone.
    stmts.push(['UPDATE procurement_allocations SET qty = 0 WHERE proc_item_id = ?', [procItemId]]);
    stmts.push([`UPDATE procurement_orders SET status = 'closed', updated_by = ?, updated_at = ?
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM procurement_items WHERE proc_id = ? AND id != ? AND stage != 'Received')`,
      [user, now, it.proc_id, it.proc_id, procItemId]]);
  }
  await batch(stmts);
}

module.exports = { procItemFor, allocateReceived };
