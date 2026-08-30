// routes/daily-gate.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, istDateString, istDayBounds } = require('../db/schema');
const { isGateApprovedToday } = require('../utils/dailyGate');

router.get('/status', async (req, res) => {
  const store = req.query.store || 'secondary';

  if (['admin', 'manager'].includes(req.user?.role)) {
    return res.json({ date: null, approved: true, summary: [] });
  }

  const yesterday = istDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const { start, end } = istDayBounds(yesterday);

  const summary = await queryAll(`
    SELECT r.item_code,
      COUNT(DISTINCT o.reel_number) as reel_count,
      SUM(o.quantity_shipped) as total_qty
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    WHERE o.store_code = ? AND o.outward_date BETWEEN ? AND ?
    GROUP BY r.item_code
    ORDER BY total_qty DESC
  `, [store, start, end]);

  const approved = await isGateApprovedToday(store);
  res.json({ date: yesterday, approved, summary });
});

router.post('/approve', async (req, res) => {
  const { store } = req.body;
  const storeCode = store || 'secondary';

  if (['admin', 'manager'].includes(req.user?.role)) {
    return res.json({ success: true, message: 'Exempt from gate' });
  }
  if (req.user?.role !== 'gelco_manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const today = istDateString();
  const existing = await queryOne(
    'SELECT id FROM daily_gate_approvals WHERE store_code = ? AND gate_date = ?',
    [storeCode, today]
  );
  if (!existing) {
    await execute(
      'INSERT INTO daily_gate_approvals (store_code, gate_date, approved_by) VALUES (?, ?, ?)',
      [storeCode, today, req.user.username]
    );
  }
  res.json({ success: true, message: `Gate approved for ${today}` });
});

module.exports = router;
