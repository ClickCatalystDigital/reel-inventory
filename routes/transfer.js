// routes/transfer.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
const { executeStockTransfer } = require('../utils/inventory');
const { isGateApprovedToday } = require('../utils/dailyGate');
const ah = require('../utils/asyncHandler');

const APPROVER_ROLES = ['admin', 'manager', 'gelco_manager'];
const GELCO_ROLES = ['gelco_manager', 'gelco_worker'];

router.get('/reel/:reelNumber', ah(async (req, res) => {
  const reel = await queryOne(`
    SELECT r.*, i.description
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    WHERE r.reel_number = ?
  `, [req.params.reelNumber]);

  if (!reel) return res.status(404).json({ error: 'Reel not found' });
  if (reel.status === 'Outwarded') return res.status(400).json({ error: 'Reel already fully outwarded', reel });
  if (reel.status === 'Deleted') return res.status(400).json({ error: 'Reel has been deleted', reel });
  res.json(reel);
}));

router.get('/box/:boxNumber', ah(async (req, res) => {
  const box = await queryOne('SELECT * FROM boxes WHERE box_number = ?', [req.params.boxNumber]);
  if (!box) return res.status(404).json({ error: 'Box not found' });

  const reels = await queryAll(`
    SELECT r.*, i.description
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    WHERE r.box_number = ?
    ORDER BY r.reel_number
  `, [req.params.boxNumber]);

  res.json({ box, reels });
}));

router.post('/', ah(async (req, res) => {
  if (req.user?.role === 'client') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { kind, number, to_store, notes } = req.body;
  if (!kind || !number || !to_store) {
    return res.status(400).json({ error: 'kind, number, and to_store are required' });
  }
  if (kind !== 'reel' && kind !== 'box') {
    return res.status(400).json({ error: 'kind must be "reel" or "box"' });
  }

  const userRole = req.user?.role;
  const username = req.user?.username;

  // boxes.store_code is no longer authoritative once reels can scatter via
  // individual transfers (see executeStockTransfer) — this is only a coarse
  // role-eligibility gate below, not the real eligibility check, so for a box
  // derive it from whether any of its current in-stock reels are at secondary
  // rather than trusting the box's own possibly-stale store_code. executeStockTransfer
  // independently re-derives the real, authoritative eligibility from scratch.
  let fromStore;
  if (kind === 'box') {
    const box = await queryOne('SELECT box_number FROM boxes WHERE box_number = ?', [number]);
    if (!box) return res.status(404).json({ error: `Box ${number} not found` });
    const secondaryReel = await queryOne(
      "SELECT 1 as found FROM reels WHERE box_number = ? AND status = 'In Stock' AND store_code = 'secondary' LIMIT 1",
      [number]
    );
    fromStore = secondaryReel ? 'secondary' : 'primary';
  } else {
    const reel = await queryOne('SELECT store_code FROM reels WHERE reel_number = ?', [number]);
    if (!reel) return res.status(404).json({ error: `Reel ${number} not found` });
    fromStore = reel.store_code;
  }

  if (GELCO_ROLES.includes(userRole)) {
    if (to_store !== 'secondary' && fromStore !== 'secondary') {
      return res.status(403).json({ error: 'Transfer must involve Gelco Stores' });
    }
    if (!(await isGateApprovedToday('secondary'))) {
      return res.status(403).json({ error: "Today's Gelco outward summary must be approved before making changes" });
    }
  }

  if (APPROVER_ROLES.includes(userRole)) {
    try {
      const result = await executeStockTransfer(kind, number, to_store, notes, username);
      return res.json({
        success: true,
        approved: true,
        message: `${result.quantity} unit(s) transferred from ${result.from_store} to ${result.to_store}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // Staff: save as pending request
  try {
    const payload = JSON.stringify({ kind, number, to_store, notes: notes || null, from_store: fromStore });
    await execute(
      'INSERT INTO requests (type, status, created_by, created_at, payload) VALUES (?, ?, ?, ?, ?)',
      ['transfer', 'pending', username, nowIST(), payload]
    );
    return res.json({
      success: true,
      approved: false,
      pending: true,
      message: 'Transfer request submitted for approval'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}));

router.get('/recent', ah(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const store = GELCO_ROLES.includes(req.user?.role) ? 'secondary' : req.query.store;
  const { date_from, date_to } = req.query;
  const params = [];
  const conditions = [];
  if (store && store !== 'all') {
    conditions.push('(from_store = ? OR to_store = ?)');
    params.push(store, store);
  }
  if (date_from) { conditions.push('transferred_at >= ?'); params.push(date_from + ' 00:00:00'); }
  if (date_to) { conditions.push('transferred_at <= ?'); params.push(date_to + ' 23:59:59'); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = await queryOne(`SELECT COUNT(*) as total FROM stock_transfers ${where}`, params);

  params.push(limit, offset);
  const rows = await queryAll(`
    SELECT * FROM stock_transfers
    ${where}
    ORDER BY transferred_at DESC
    LIMIT ? OFFSET ?
  `, params);
  res.json({ rows, total: countRow.total });
}));

router.post('/undo', ah(async (req, res) => {
  // Role check is the only gate now — the shared hardcoded password other
  // undo/delete endpoints (inward.js/outward.js/dashboard.js) still carry was
  // deliberately dropped here per request; admin/manager-only is the boundary.
  if (!['admin', 'manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { transfer_id } = req.body;
  if (!transfer_id) {
    return res.status(400).json({ error: 'transfer_id is required' });
  }

  const transfer = await queryOne('SELECT * FROM stock_transfers WHERE id = ?', [transfer_id]);
  if (!transfer) return res.status(404).json({ error: 'Transfer record not found' });

  try {
    if (transfer.reel_number) {
      // Every row logged since utils/inventory.js started giving each moved reel
      // its own stock_transfers row (including box-batch moves) carries a
      // reel_number — undo always targets that exact reel, never "whatever's in
      // the box now". This is what makes undo correct once boxed reels can move
      // individually: a later, unrelated transfer of a different reel from the
      // same box can no longer get dragged back by undoing this one.
      await execute('UPDATE reels SET store_code = ? WHERE reel_number = ?', [transfer.from_store, transfer.reel_number]);
    } else if (transfer.box_number) {
      // Legacy fallback only — rows logged before that change summed an entire
      // box into one row with no reel_number. Best-effort revert of every reel
      // currently in the box, same imprecision that shape always had. No new
      // rows are ever created this way, so this only matters for old history.
      await execute('UPDATE boxes SET store_code = ? WHERE box_number = ?', [transfer.from_store, transfer.box_number]);
      await execute('UPDATE reels SET store_code = ? WHERE box_number = ?', [transfer.from_store, transfer.box_number]);
    }
    await execute('DELETE FROM stock_transfers WHERE id = ?', [transfer_id]);

    res.json({
      success: true,
      message: `Transfer undone — ${transfer.reel_number || transfer.box_number} restored to ${transfer.from_store}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

module.exports = router;
