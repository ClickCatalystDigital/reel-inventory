// routes/outward.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
const { executeOutwardReel } = require('../utils/inventory');

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

// Extracted so both direct-approve and request-approve paths use same logic
// async function executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes) {
//   const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
//   if (!reel) throw new Error(`Reel ${reel_number} not found`);
//   if (reel.status === 'Outwarded') throw new Error(`Reel ${reel_number} already outwarded`);

//   const type = outward_type || 'Full';
//   let qtyShipped;

//   if (type === 'Partial') {
//     qtyShipped = parseInt(quantity_shipped);
//     if (!qtyShipped || qtyShipped <= 0 || qtyShipped >= reel.quantity) {
//       throw new Error(`Partial quantity must be between 1 and ${reel.quantity - 1}`);
//     }
//   } else {
//     qtyShipped = reel.quantity;
//   }

//   await execute(
//     `INSERT INTO outwards (reel_number, customer_name, invoice_number, quantity_shipped, outward_type, notes, outward_date)
//      VALUES (?, ?, ?, ?, ?, ?, ?)`,
//     [reel_number, customer_name.trim(), invoice_number.trim(), qtyShipped, type, notes || null, nowIST()]
//   );

//   if (type === 'Full') {
//     await execute('UPDATE reels SET quantity = 0, status = ? WHERE reel_number = ?', ['Outwarded', reel_number]);
//   } else {
//     await execute('UPDATE reels SET quantity = ? WHERE reel_number = ?', [reel.quantity - qtyShipped, reel_number]);
//   }

//   return { qtyShipped, remaining: type === 'Full' ? 0 : reel.quantity - qtyShipped };
// }

router.post('/', async (req, res) => {
  const { reel_number, customer_name, invoice_number, quantity_shipped, outward_type, notes, store_code } = req.body;
  if (!reel_number || !customer_name || !invoice_number) {
    return res.status(400).json({ error: 'reel_number, customer_name, and invoice_number are required' });
  }

  const userRole = req.user?.role;
  const username = req.user?.username;

  if (APPROVER_ROLES.includes(userRole)) {
    try {
      const result = await executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, null, null, store_code);
      return res.json({
        success: true,
        approved: true,
        message: `Outward recorded: ${result.qtyShipped} units from ${reel_number}`,
        remaining: result.remaining
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // Staff: check reel exists and is in stock first, then save as pending
  const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
  if (!reel) return res.status(404).json({ error: 'Reel not found' });
  if (reel.status === 'Outwarded') return res.status(400).json({ error: 'Reel already fully outwarded' });

  try {
    const payload = JSON.stringify({
      reel_number, customer_name, invoice_number,
      outward_type: outward_type || 'Full',
      quantity_shipped: quantity_shipped || null,
      notes: notes || null,
      store_code: store_code || null
    });
    await execute(
      'INSERT INTO requests (type, status, created_by, created_at, payload) VALUES (?, ?, ?, ?, ?)',
      ['outward', 'pending', username, nowIST(), payload]
    );
    return res.json({
      success: true,
      approved: false,
      pending: true,
      message: `Outward request submitted for approval`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/box', async (req, res) => {
  const { box_number, customer_name, invoice_number, notes, store_code } = req.body;
  if (!box_number || !customer_name || !invoice_number) {
    return res.status(400).json({ error: 'box_number, customer_name, and invoice_number are required' });
  }

  const box = await queryOne('SELECT * FROM boxes WHERE box_number = ?', [box_number]);
  if (!box) return res.status(404).json({ error: 'Box not found' });

  const reels = await queryAll('SELECT * FROM reels WHERE box_number = ?', [box_number]);
  const inStock = reels.filter(r => r.status === 'In Stock');
  const alreadyOutwarded = reels.filter(r => r.status === 'Outwarded');

  if (inStock.length === 0) {
    return res.status(400).json({
      error: 'All reels in this box are already outwarded',
      outwarded_reels: alreadyOutwarded.map(r => r.reel_number)
    });
  }

  const userRole = req.user?.role;
  const username = req.user?.username;

  if (APPROVER_ROLES.includes(userRole)) {
    const results = { success: [], skipped: [] };
    try {
      for (const reel of reels) {
        if (reel.status === 'Outwarded') {
          results.skipped.push({ reel_number: reel.reel_number, reason: 'Already outwarded' });
          continue;
        }
        await execute(
          `INSERT INTO outwards (reel_number, customer_name, invoice_number, quantity_shipped, outward_type, notes, outward_date, store_code)
           VALUES (?, ?, ?, ?, 'Full', ?, ?, ?)`,
          [reel.reel_number, customer_name.trim(), invoice_number.trim(), reel.quantity, notes || null, nowIST(), store_code || reel.store_code]
        );
        await execute('UPDATE reels SET quantity = 0, status = ? WHERE reel_number = ?', ['Outwarded', reel.reel_number]);
        results.success.push(reel.reel_number);
      }
      let message = `${results.success.length} reel(s) outwarded from ${box_number}`;
      if (results.skipped.length > 0) {
        message += `. ${results.skipped.length} skipped (already outwarded)`;
      }
      return res.json({ success: true, approved: true, message, results });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Staff: save entire box outward as single pending request
  try {
    const payload = JSON.stringify({
      box_number,
      customer_name,
      invoice_number,
      notes: notes || null,
      reel_numbers: inStock.map(r => r.reel_number),
      store_code: store_code || null
    });
    await execute(
      'INSERT INTO requests (type, status, created_by, created_at, payload) VALUES (?, ?, ?, ?, ?)',
      ['outward', 'pending', username, nowIST(), payload]
    );
    return res.json({
      success: true,
      approved: false,
      pending: true,
      message: `Box outward request submitted for approval (${inStock.length} reels)`
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
    where = 'WHERE r.store_code = ?';
    params.push(store);
  }

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

  // Validate all reels exist and are in stock
  for (const reel_number of reel_numbers) {
    const reel = await queryOne('SELECT * FROM reels WHERE reel_number = ?', [reel_number]);
    if (!reel) return res.status(404).json({ error: `Reel ${reel_number} not found` });
    if (reel.status === 'Outwarded') return res.status(400).json({ error: `Reel ${reel_number} already outwarded` });
  }

  if (APPROVER_ROLES.includes(userRole)) {
    const errors = [];
    for (const reel_number of reel_numbers) {
      try {
        await executeOutwardReel(reel_number, customer_name, invoice_number, outward_type || 'Full', null, notes, company_id, po_id, store_code);
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
      store_code: store_code || null
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