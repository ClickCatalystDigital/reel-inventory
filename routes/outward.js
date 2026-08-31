// routes/outward.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
const { executeOutwardReel } = require('../utils/inventory');
const { isGateApprovedToday } = require('../utils/dailyGate');

// gelco_worker included deliberately (unlike inward.js/transfer.js/requests.js's own
// separate APPROVER_ROLES, which stay admin/manager/gelco_manager only) — their Outward
// submissions execute immediately rather than queuing as a pending request, per the
// daily-gate ritual (isGateApprovedToday, checked independently below) being the
// intended after-the-fact review mechanism for this role, not per-request approval.
const APPROVER_ROLES = ['admin', 'manager', 'gelco_manager', 'gelco_worker'];
const GELCO_ROLES = ['gelco_manager', 'gelco_worker'];

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

  const inStock = reels.filter(r => r.status === 'In Stock');
  const outwarded = reels.filter(r => r.status === 'Outwarded');

  res.json({
    box,
    reels,
    summary: {
      total: reels.length,
      in_stock: inStock.length,
      outwarded: outwarded.length,
      outwarded_reels: outwarded.map(r => r.reel_number)
    }
  });
});

router.get('/recent', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const store = GELCO_ROLES.includes(req.user?.role) ? 'secondary' : req.query.store;
  const { q, date_from, date_to } = req.query;
  const params = [];
  const conditions = [];
  if (store && store !== 'all') {
    conditions.push('r.store_code = ?');
    params.push(store);
  }
  if (q) {
    conditions.push(`(
      o.reel_number LIKE ? OR r.item_code LIKE ? OR r.box_number LIKE ?
      OR o.customer_name LIKE ? OR o.invoice_number LIKE ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (date_from) { conditions.push('o.outward_date >= ?'); params.push(date_from + ' 00:00:00'); }
  if (date_to) { conditions.push('o.outward_date <= ?'); params.push(date_to + ' 23:59:59'); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = await queryOne(`
    SELECT COUNT(*) as total
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    ${where}
  `, params);

  params.push(limit, offset);
  const rows = await queryAll(`
    SELECT o.id, o.reel_number, o.customer_name, o.invoice_number,
           o.quantity_shipped, o.outward_type, o.outward_date, o.notes,
           r.item_code, r.box_number, i.description
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    JOIN items i ON r.item_code = i.item_code
    ${where}
    ORDER BY o.outward_date DESC
    LIMIT ? OFFSET ?
  `, params);
  res.json({ rows, total: countRow.total });
});

router.get('/for-reprint', async (req, res) => {
  const { customer_name, invoice_number } = req.query;
  if (!customer_name && !invoice_number) {
    return res.status(400).json({ error: 'customer_name or invoice_number is required' });
  }
  const conditions = [];
  const params = [];
  if (customer_name) { conditions.push('o.customer_name = ?'); params.push(customer_name); }
  if (invoice_number) { conditions.push('o.invoice_number = ?'); params.push(invoice_number); }
  const rows = await queryAll(`
    SELECT o.id, o.reel_number, o.customer_name, o.invoice_number,
           o.quantity_shipped, o.outward_type, o.outward_date, o.notes,
           r.item_code, r.box_number, i.description
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    JOIN items i ON r.item_code = i.item_code
    WHERE ${conditions.join(' AND ')}
    ORDER BY o.outward_date DESC
  `, params);
  res.json(rows);
});

router.post('/undo', async (req, res) => {
  // Role check added alongside the hardcoded password below — this hardens the gate,
  // it doesn't replace it. The password itself stays a single shared string, not
  // user-specific or rotatable without a deploy; that's a separate, deferred item.
  if (!['admin', 'manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { outward_id, password } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  if (!outward_id) {
    return res.status(400).json({ error: 'outward_id is required' });
  }

  // Get the outward record
  const outward = await queryOne('SELECT * FROM outwards WHERE id = ?', [outward_id]);
  if (!outward) return res.status(404).json({ error: 'Outward record not found' });

  // Get the reel
  const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [outward.reel_number]);
  if (!reel) return res.status(404).json({ error: 'Reel not found' });

  try {
    // Restore reel quantity and status
    const restoredQty = reel.quantity + outward.quantity_shipped;
    await execute(
      'UPDATE reels SET quantity = ?, status = ? WHERE reel_number = ?',
      [restoredQty, 'In Stock', outward.reel_number]
    );

    // Delete the outward record
    await execute('DELETE FROM outwards WHERE id = ?', [outward_id]);

    res.json({
      success: true,
      message: `Outward undone — ${outward.reel_number} restored to In Stock with qty ${restoredQty}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/grouped', async (req, res) => {
  const { item_code, reel_numbers, customer_name, invoice_number, outward_type, notes, company_id, po_id, store_code } = req.body;

  if (!item_code || !reel_numbers?.length || !customer_name || !invoice_number) {
    return res.status(400).json({ error: 'item_code, reel_numbers, customer_name, and invoice_number are required' });
  }

  if (req.user?.role === 'client') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const userRole = req.user?.role;
  const username = req.user?.username;
  let storeCode = store_code;
  const isGelco = GELCO_ROLES.includes(userRole);
  if (isGelco) storeCode = 'secondary';

  if (isGelco && !(await isGateApprovedToday('secondary'))) {
    return res.status(403).json({ error: "Today's Gelco outward summary must be approved before making changes" });
  }

  // Validate all reels exist and are in stock
  for (const reel_number of reel_numbers) {
    const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
    if (!reel) return res.status(404).json({ error: `Reel ${reel_number} not found` });
    if (reel.status === 'Outwarded') return res.status(400).json({ error: `Reel ${reel_number} already outwarded` });
    if (isGelco && reel.store_code !== 'secondary') {
      return res.status(403).json({ error: `Reel ${reel_number} belongs to a different store` });
    }
  }

  if (APPROVER_ROLES.includes(userRole)) {
    const errors = [];
    for (const reel_number of reel_numbers) {
      try {
        await executeOutwardReel(reel_number, customer_name, invoice_number, outward_type || 'Full', null, notes, company_id, po_id, storeCode);
      } catch (err) {
        errors.push(`${reel_number}: ${err.message}`);
      }
    }
    if (errors.length > 0 && errors.length === reel_numbers.length) {
      return res.status(400).json({ error: 'All reels failed', details: errors });
    }
    return res.json({
      success: true,
      approved: true,
      message: `${reel_numbers.length - errors.length} reel(s) outwarded for ${item_code}`
    });
  }

  // Staff: save as single grouped pending request
  try {
    const payload = JSON.stringify({
      item_code,
      reel_numbers,
      customer_name,
      invoice_number,
      outward_type: outward_type || 'Full',
      notes: notes || null,
      company_id: company_id || null,
      po_id: po_id || null,
      store_code: storeCode || null
    });
    await execute(
      'INSERT INTO requests (type, status, created_by, created_at, payload) VALUES (?, ?, ?, ?, ?)',
      ['outward', 'pending', username, nowIST(), payload]
    );
    return res.json({
      success: true,
      approved: false,
      pending: true,
      message: `Outward request submitted for ${item_code} (${reel_numbers.length} reels)`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;