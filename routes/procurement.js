// routes/procurement.js — procurement (China) orders. LS Tech staff read; admin/manager write.
// An order has items, each with its own stage (EQ → … → In Transit; Received is set by inwarding against it,
// utils/procurement.js). Allocations tie an item's qty to the customer PO lines waiting for it; any qty
// beyond them is bought for LS stock. Customer PO lines take their status from these (utils/poProgress.js).
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, batch, readBatch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const { progress } = require('../utils/poProgress');
const { PROC_STAGES } = require('../utils/poStages');

const editors = (req, res, next) => (['admin', 'manager'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Not authorized' }));
const ins = (n) => Array(n).fill('?').join(',');
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Open customer POs' lines that still need stock nobody has planned for, pooled by item.
router.get('/shortfall', ah(async (req, res) => {
  const pos = await queryAll(`SELECT p.id, p.po_number, p.expected_dispatch_date, co.name AS company_name
    FROM crm_purchase_orders p LEFT JOIN crm_companies co ON co.id = p.company_id WHERE p.status != 'cancelled'`);
  const poBy = Object.fromEntries(pos.map((p) => [p.id, p]));
  const { lines } = await progress(pos.map((p) => p.id));
  const short = lines.filter((l) => l.needed > 0 && l.item_code);
  const codes = [...new Set(short.map((l) => l.item_code))];
  const free = codes.length ? await queryAll(`SELECT item_code, SUM(quantity) AS qty FROM reels WHERE store_code = 'primary' AND status = 'In Stock'
    AND reserved_po_item_id IS NULL AND item_code IN (${ins(codes.length)}) GROUP BY item_code`, codes) : [];
  const freeBy = Object.fromEntries(free.map((f) => [f.item_code, f.qty]));
  const meta = codes.length ? await queryAll(`SELECT item_code, description, supplier FROM items WHERE item_code IN (${ins(codes.length)})`, codes) : [];
  const metaBy = Object.fromEntries(meta.map((m) => [m.item_code, m]));
  const byItem = {};
  for (const l of short) {
    const g = (byItem[l.item_code] ||= { item_code: l.item_code, description: metaBy[l.item_code]?.description || null, supplier: metaBy[l.item_code]?.supplier || null, free_stock: freeBy[l.item_code] || 0, needed: 0, lines: [] });
    const p = poBy[l.po_id];
    g.needed += l.needed;
    g.lines.push({ po_item_id: l.id, po_id: l.po_id, po_number: p.po_number, company_name: p.company_name, expected_dispatch_date: p.expected_dispatch_date, needed: l.needed });
  }
  for (const g of Object.values(byItem)) g.lines.sort((a, b) => String(a.expected_dispatch_date || '9').localeCompare(String(b.expected_dispatch_date || '9')));
  res.json(Object.values(byItem).sort((a, b) => a.item_code.localeCompare(b.item_code)));
}));

// Open (not received, not cancelled/closed) items for one item code — the Inward page's "against order" picker.
router.get('/open-items', ah(async (req, res) => {
  res.json(await queryAll(`SELECT it.id, it.item_code, it.qty_ordered, it.qty_received, it.stage, po.id AS proc_id, po.number, po.supplier, po.expected_date
    FROM procurement_items it JOIN procurement_orders po ON po.id = it.proc_id
    WHERE it.item_code = ? AND it.stage != 'Received' AND po.status NOT IN ('cancelled', 'closed') ORDER BY po.id`, [String(req.query.item_code || '')]));
}));

router.get('/', ah(async (req, res) => {
  const [orders, items] = await readBatch([
    ['SELECT * FROM procurement_orders ORDER BY id DESC LIMIT 500', []],
    ['SELECT proc_id, item_code, qty_ordered, qty_received, stage FROM procurement_items', []],
  ]);
  const by = items.rows.reduce((g, i) => ((g[i.proc_id] ||= []).push(i), g), {});
  res.json(orders.rows.map((o) => {
    const its = by[o.id] || [];
    const stage = its.reduce((a, i) => (PROC_STAGES.indexOf(i.stage) < PROC_STAGES.indexOf(a) ? i.stage : a), 'Received');
    return { ...o, items: its.length, item_codes: its.map((i) => i.item_code), qty_ordered: its.reduce((s, i) => s + i.qty_ordered, 0), qty_received: its.reduce((s, i) => s + i.qty_received, 0), stage: its.length ? stage : null };
  }));
}));

router.get('/:id', ah(async (req, res) => {
  const [order, items, allocs] = await readBatch([
    ['SELECT * FROM procurement_orders WHERE id = ?', [req.params.id]],
    [`SELECT it.*, i.description FROM procurement_items it LEFT JOIN items i ON i.item_code = it.item_code WHERE it.proc_id = ? ORDER BY it.id`, [req.params.id]],
    [`SELECT a.*, pi.po_id, p.po_number, p.expected_dispatch_date, co.name AS company_name
        FROM procurement_allocations a JOIN procurement_items it ON it.id = a.proc_item_id
        LEFT JOIN crm_po_items pi ON pi.id = a.po_item_id LEFT JOIN crm_purchase_orders p ON p.id = pi.po_id
        LEFT JOIN crm_companies co ON co.id = p.company_id
       WHERE it.proc_id = ? ORDER BY p.expected_dispatch_date IS NULL, p.expected_dispatch_date, a.id`, [req.params.id]],
  ]);
  if (!order.rows.length) return res.status(404).json({ error: 'Procurement order not found' });
  res.json({
    ...order.rows[0],
    items: items.rows.map((it) => {
      const al = allocs.rows.filter((a) => a.proc_item_id === it.id && a.po_item_id);
      const forCustomers = al.reduce((s, a) => s + a.qty, 0);
      return { ...it, allocations: al, for_ls_stock: Math.max(0, it.qty_ordered - it.qty_received - forCustomers) };
    }),
  });
}));

// { supplier, expected_date, notes, items: [{ item_code, qty, unit_cost?, currency?, allocations: [{ po_item_id, qty }] }] }
router.post('/', editors, ah(async (req, res) => {
  const supplier = String(req.body.supplier || '').trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!supplier) return res.status(400).json({ error: 'Supplier is required' });
  if (!items.length) return res.status(400).json({ error: 'Add at least one item' });
  // Each allocation may only take what that PO line still needs right now.
  const lineIds = items.flatMap((i) => (i.allocations || []).map((a) => Number(a.po_item_id)));
  const lines = lineIds.length ? await queryAll(`SELECT id, po_id, item_code FROM crm_po_items WHERE id IN (${ins(lineIds.length)})`, lineIds) : [];
  const lineBy = Object.fromEntries(lines.map((l) => [l.id, l]));
  const { lines: prog } = await progress([...new Set(lines.map((l) => l.po_id))]);
  const neededBy = Object.fromEntries(prog.map((l) => [l.id, l.needed]));
  const codes = items.map((i) => String(i.item_code || '').trim());
  const known = new Set((await queryAll(`SELECT item_code FROM items WHERE item_code IN (${ins(codes.length)})`, codes)).map((r) => r.item_code));
  for (const [n, it] of items.entries()) {
    const code = codes[n];
    const qty = int(it.qty);
    if (!known.has(code)) return res.status(400).json({ error: `Unknown item ${code}` });
    if (!(qty > 0)) return res.status(400).json({ error: `Quantity for ${code} must be a whole number above 0` });
    let sum = 0;
    for (const a of it.allocations || []) {
      const l = lineBy[a.po_item_id];
      const q = int(a.qty);
      if (!l || l.item_code !== code) return res.status(400).json({ error: `PO line ${a.po_item_id} is not for ${code}` });
      if (!(q > 0) || q > (neededBy[l.id] || 0)) return res.status(400).json({ error: `Allocation for ${code} exceeds what that PO still needs` });
      sum += q;
    }
    if (sum > qty) return res.status(400).json({ error: `${code}: allocations exceed the quantity ordered` });
  }
  await execute("UPDATE counters SET value = value + 1 WHERE name = 'proc'");
  const number = `PRC-${(await queryOne("SELECT value FROM counters WHERE name = 'proc'")).value}`;
  const now = nowIST();
  const order = await execute(`INSERT INTO procurement_orders (number, supplier, status, expected_date, notes, created_by, created_at, updated_by, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`, [number, supplier, date(req.body.expected_date), String(req.body.notes || '').trim() || null, req.user.username, now, req.user.username, now]);
  const procId = order.lastId;
  // ponytail: one insert per item for its id (orders have a handful of items); allocations go in one batch.
  const stmts = [];
  for (const [n, it] of items.entries()) {
    const r = await execute(`INSERT INTO procurement_items (proc_id, item_code, qty_ordered, stage, stage_updated_by, stage_updated_at, unit_cost, currency)
      VALUES (?, ?, ?, 'EQ', ?, ?, ?, ?)`, [procId, codes[n], int(it.qty), req.user.username, now, it.unit_cost === '' || it.unit_cost == null ? null : Number(it.unit_cost), String(it.currency || '').trim() || null]);
    for (const a of it.allocations || []) stmts.push(['INSERT INTO procurement_allocations (proc_item_id, po_item_id, qty) VALUES (?, ?, ?)', [r.lastId, Number(a.po_item_id), int(a.qty)]]);
    stmts.push(['UPDATE items SET supplier = ? WHERE item_code = ?', [supplier, codes[n]]]);
  }
  await batch(stmts);
  res.json({ success: true, id: procId, number });
}));

// { supplier?, expected_date?, notes?, status?: 'draft'|'ordered', items?: [{ id, qty_ordered?, unit_cost?, currency? }] }
router.put('/:id', editors, ah(async (req, res) => {
  const o = await queryOne('SELECT * FROM procurement_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Procurement order not found' });
  if (['cancelled', 'closed'].includes(o.status)) return res.status(400).json({ error: `Order is ${o.status}` });
  const b = req.body;
  if (b.status && !['draft', 'ordered'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  const stmts = [[`UPDATE procurement_orders SET supplier = ?, expected_date = ?, notes = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    [b.supplier !== undefined ? String(b.supplier).trim() || o.supplier : o.supplier, b.expected_date !== undefined ? date(b.expected_date) : o.expected_date,
     b.notes !== undefined ? String(b.notes).trim() || null : o.notes, b.status || o.status, req.user.username, nowIST(), o.id]]];
  if (Array.isArray(b.items) && b.items.length) {
    const ids = b.items.map((i) => Number(i.id));
    const [its, al] = await readBatch([
      [`SELECT * FROM procurement_items WHERE proc_id = ? AND id IN (${ins(ids.length)})`, [o.id, ...ids]],
      [`SELECT proc_item_id, SUM(qty) AS qty FROM procurement_allocations WHERE po_item_id IS NOT NULL AND proc_item_id IN (${ins(ids.length)}) GROUP BY proc_item_id`, ids],
    ]);
    const itBy = Object.fromEntries(its.rows.map((i) => [i.id, i]));
    const alBy = Object.fromEntries(al.rows.map((a) => [a.proc_item_id, a.qty]));
    for (const u of b.items) {
      const it = itBy[u.id];
      if (!it) return res.status(400).json({ error: 'Item not on this order' });
      const qty = u.qty_ordered !== undefined ? int(u.qty_ordered) : it.qty_ordered;
      if (!(qty > 0) || qty < it.qty_received + (alBy[it.id] || 0)) return res.status(400).json({ error: `${it.item_code}: quantity can't go below what's received plus what customers are waiting for` });
      stmts.push(['UPDATE procurement_items SET qty_ordered = ?, unit_cost = ?, currency = ? WHERE id = ?',
        [qty, u.unit_cost !== undefined ? (u.unit_cost === '' || u.unit_cost == null ? null : Number(u.unit_cost)) : it.unit_cost, u.currency !== undefined ? String(u.currency || '').trim() || null : it.currency, it.id]]);
    }
  }
  await batch(stmts);
  res.json({ success: true });
}));

// Stage per item. 'Received' only comes from inwarding against the item, so it can't be picked here.
router.put('/:id/items/:itemId/stage', editors, ah(async (req, res) => {
  const { stage } = req.body;
  if (!PROC_STAGES.slice(0, -1).includes(stage)) return res.status(400).json({ error: 'Unknown stage' });
  const r = await execute(`UPDATE procurement_items SET stage = ?, stage_updated_by = ?, stage_updated_at = ?
    WHERE id = ? AND proc_id = ? AND stage != 'Received' AND proc_id IN (SELECT id FROM procurement_orders WHERE status NOT IN ('cancelled', 'closed'))`,
    [stage, req.user.username, nowIST(), req.params.itemId, req.params.id]);
  if (!r.changes) return res.status(400).json({ error: 'Item not found, already received, or the order is closed' });
  res.json({ success: true });
}));

// Cancelling frees the customer POs that were waiting on it (they go back to "Not planned").
router.post('/:id/cancel', editors, ah(async (req, res) => {
  const o = await queryOne('SELECT * FROM procurement_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Procurement order not found' });
  if (['cancelled', 'closed'].includes(o.status)) return res.status(400).json({ error: `Order is already ${o.status}` });
  if (await queryOne('SELECT 1 FROM procurement_items WHERE proc_id = ? AND qty_received > 0', [o.id])) return res.status(400).json({ error: 'Part of this order has been received — it can only be closed by receiving the rest' });
  await batch([
    ["UPDATE procurement_orders SET status = 'cancelled', updated_by = ?, updated_at = ? WHERE id = ?", [req.user.username, nowIST(), o.id]],
    ['DELETE FROM procurement_allocations WHERE proc_item_id IN (SELECT id FROM procurement_items WHERE proc_id = ?)', [o.id]],
  ]);
  res.json({ success: true });
}));

module.exports = router;
