// routes/transfer.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
const { executeStockTransfer } = require('../utils/inventory');

const APPROVER_ROLES = ['admin', 'manager'];

router.get('/reel/:reelNumber', async (req, res) => {
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
});

router.get('/box/:boxNumber', async (req, res) => {
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
});

router.post('/', async (req, res) => {
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
    const payload = JSON.stringify({ kind, number, to_store, notes: notes || null });
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
});

router.get('/recent', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const { store } = req.query;
  const params = [];
  let where = '';
  if (store && store !== 'all') {
    where = 'WHERE from_store = ? OR to_store = ?';
    params.push(store, store);
  }

  const countRow = await queryOne(`SELECT COUNT(*) as total FROM stock_transfers ${where}`, params);

  params.push(limit, offset);
  const rows = await queryAll(`
    SELECT * FROM stock_transfers
    ${where}
    ORDER BY transferred_at DESC
    LIMIT ? OFFSET ?
  `, params);
  res.json({ rows, total: countRow.total });
});

router.post('/undo', async (req, res) => {
  if (req.user?.role === 'client') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { transfer_id, password } = req.body;
  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Incorrect password' });
  }
  if (!transfer_id) {
    return res.status(400).json({ error: 'transfer_id is required' });
  }

  const transfer = await queryOne('SELECT * FROM stock_transfers WHERE id = ?', [transfer_id]);
  if (!transfer) return res.status(404).json({ error: 'Transfer record not found' });

  try {
    if (transfer.reel_number) {
      await execute('UPDATE reels SET store_code = ? WHERE reel_number = ?', [transfer.from_store, transfer.reel_number]);
    } else if (transfer.box_number) {
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
});

module.exports = router;
