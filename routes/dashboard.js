// routes/dashboard.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute } = require('../db/schema');
const ah = require('../utils/asyncHandler');

// Gelco roles are scoped to Gelco-only data; dashboard aggregates span all stores, so block outright.
router.use((req, res, next) => {
  if (['gelco_manager', 'gelco_worker'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
});

router.get('/search', ah(async (req, res) => {
  const { q, reel_number, item_code, customer, invoice, status, box_number, date_from, date_to, store } = req.query;
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  let where = ' WHERE 1=1';
  const params = [];

  if (q) {
    where += ` AND (
      r.reel_number LIKE ? OR r.item_code LIKE ? OR r.box_number LIKE ?
      OR r.reel_number IN (SELECT reel_number FROM outwards WHERE customer_name LIKE ? OR invoice_number LIKE ?)
    )`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (reel_number) { where += ' AND r.reel_number LIKE ?'; params.push(`%${reel_number}%`); }
  if (item_code) { where += ' AND r.item_code LIKE ?'; params.push(`%${item_code}%`); }
  if (box_number) { where += ' AND r.box_number LIKE ?'; params.push(`%${box_number}%`); }
  if (customer) { where += ' AND r.reel_number IN (SELECT reel_number FROM outwards WHERE customer_name LIKE ?)'; params.push(`%${customer}%`); }
  if (invoice) { where += ' AND r.reel_number IN (SELECT reel_number FROM outwards WHERE invoice_number LIKE ?)'; params.push(`%${invoice}%`); }
  if (status) { where += ' AND r.status = ?'; params.push(status); }
  if (date_from) { where += ' AND r.inward_date >= ?'; params.push(date_from); }
  if (date_to) { where += ' AND r.inward_date <= ?'; params.push(date_to + ' 23:59:59'); }
  if (store && store !== 'all') { where += ' AND r.store_code = ?'; params.push(store); }

  const countRow = await queryOne(`
    SELECT COUNT(*) as total
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    ${where}
  `, params);

  const rows = await queryAll(`
    SELECT r.*, i.description,
      (SELECT GROUP_CONCAT(
        o.customer_name || '|' || o.invoice_number || '|' || o.quantity_shipped || '|' || o.outward_type || '|' || o.outward_date, ';;'
      ) FROM outwards o WHERE o.reel_number = r.reel_number) as outward_history
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    ${where}
    ORDER BY r.inward_date DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const parsed = rows.map(r => {
    const history = r.outward_history
      ? r.outward_history.split(';;').map(entry => {
          const [customer_name, invoice_number, quantity_shipped, outward_type, outward_date] = entry.split('|');
          return { customer_name, invoice_number, quantity_shipped: parseInt(quantity_shipped), outward_type, outward_date };
        })
      : [];
    return { ...r, outward_history: history };
  });

  res.json({ rows: parsed, total: countRow.total });
}));

router.get('/stock-summary', ah(async (req, res) => {
  const as_on_date = req.query.as_on_date;
  const { store } = req.query;
  const storeFilter = store && store !== 'all';
  let query;
  let params = [];

  if (as_on_date) {
    query = `
      SELECT i.item_code, i.description, i.default_spq,
        COUNT(CASE WHEN r.status != 'Deleted' THEN r.id END) as total_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
      FROM items i
      LEFT JOIN reels r ON i.item_code = r.item_code AND r.inward_date <= ?${storeFilter ? ' AND r.store_code = ?' : ''}
      GROUP BY i.item_code ORDER BY i.item_code
    `;
    params.push(as_on_date + ' 23:59:59');
    if (storeFilter) params.push(store);
  } else {
    query = `
      SELECT i.item_code, i.description, i.default_spq,
        COUNT(CASE WHEN r.status != 'Deleted' THEN r.id END) as total_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
      FROM items i
      LEFT JOIN reels r ON i.item_code = r.item_code${storeFilter ? ' AND r.store_code = ?' : ''}
      GROUP BY i.item_code ORDER BY i.item_code
    `;
    if (storeFilter) params.push(store);
  }

  res.json(await queryAll(query, params));
}));

router.get('/export', ah(async (req, res) => {
  const { status, as_on_date, store } = req.query;
  let query = `
    SELECT r.reel_number, r.item_code, i.description, r.quantity, r.status, r.inward_date, r.store_code,
      o.customer_name, o.invoice_number, o.quantity_shipped, o.outward_type, o.outward_date
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    LEFT JOIN outwards o ON r.reel_number = o.reel_number
    WHERE r.status != 'Deleted'
  `;
  const params = [];

  if (status) { query += ' AND r.status = ?'; params.push(status); }
  if (as_on_date) { query += ' AND r.inward_date <= ?'; params.push(as_on_date + ' 23:59:59'); }
  if (store && store !== 'all') { query += ' AND r.store_code = ?'; params.push(store); }
  query += ' ORDER BY r.reel_number';

  const rows = await queryAll(query, params);
  const headers = 'Reel Number,Item Code,Description,Quantity,Status,Inward Date,Store,Customer,Invoice,Qty Shipped,Outward Type,Outward Date';
  const csvRows = rows.map(r =>
    [r.reel_number, r.item_code, `"${r.description}"`, r.quantity, r.status, r.inward_date, r.store_code,
     r.customer_name || '', r.invoice_number || '', r.quantity_shipped || '', r.outward_type || '', r.outward_date || ''
    ].join(',')
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=inventory_${new Date().toISOString().split('T')[0]}.csv`);
  res.send([headers, ...csvRows].join('\n'));
}));

// POST soft delete reels
router.post('/delete', ah(async (req, res) => {
  const { reel_numbers, box_numbers, password } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  let reelsToDelete = [];

  // Collect reels from box numbers
  if (box_numbers && box_numbers.length) {
    for (const bn of box_numbers) {
      const boxReels = await queryAll('SELECT reel_number FROM reels WHERE box_number = ?', [bn]);
      reelsToDelete.push(...boxReels.map(r => r.reel_number));
    }
  }

  // Add individual reel numbers
  if (reel_numbers && reel_numbers.length) {
    reelsToDelete.push(...reel_numbers);
  }

  // Deduplicate
  reelsToDelete = [...new Set(reelsToDelete)];

  if (!reelsToDelete.length) {
    return res.status(400).json({ error: 'No reels or boxes specified' });
  }

  // Get stats before deleting
  const stats = { in_stock: 0, outwarded: 0, already_deleted: 0 };
  for (const rn of reelsToDelete) {
    const reel = await queryOne('SELECT status FROM reels WHERE reel_number = ?', [rn]);
    if (!reel) continue;
    if (reel.status === 'Deleted') stats.already_deleted++;
    else if (reel.status === 'Outwarded') stats.outwarded++;
    else stats.in_stock++;
  }

  // Soft delete
  let deleted = 0;
  for (const rn of reelsToDelete) {
    const result = await execute("UPDATE reels SET status = 'Deleted', quantity = 0 WHERE reel_number = ? AND status != 'Deleted'", [rn]);
    deleted += result.changes;
  }

  res.json({
    success: true,
    message: `${deleted} reel(s) marked as deleted`,
    stats
  });
}));

// POST get delete preview (stats before confirming)
router.post('/delete-preview', ah(async (req, res) => {
  const { reel_numbers, box_numbers } = req.body;

  let reelsToCheck = [];

  if (box_numbers && box_numbers.length) {
    for (const bn of box_numbers) {
      const boxReels = await queryAll('SELECT reel_number, status, quantity, item_code FROM reels WHERE box_number = ?', [bn]);
      reelsToCheck.push(...boxReels);
    }
  }

  if (reel_numbers && reel_numbers.length) {
    for (const rn of reel_numbers) {
      const reel = await queryOne('SELECT reel_number, status, quantity, item_code, box_number FROM reels WHERE reel_number = ?', [rn]);
      if (reel && !reelsToCheck.find(r => r.reel_number === reel.reel_number)) {
        reelsToCheck.push(reel);
      }
    }
  }

  const stats = {
    total: reelsToCheck.length,
    in_stock: reelsToCheck.filter(r => r.status === 'In Stock').length,
    outwarded: reelsToCheck.filter(r => r.status === 'Outwarded').length,
    already_deleted: reelsToCheck.filter(r => r.status === 'Deleted').length,
    total_quantity: reelsToCheck.filter(r => r.status !== 'Deleted').reduce((s, r) => s + (r.quantity || 0), 0),
    reels: reelsToCheck
  };

  res.json(stats);
}));

// GET analytics data
router.get('/analytics', ah(async (req, res) => {
  const { store } = req.query;
  const storeFilter = store && store !== 'all';
  const sp = storeFilter ? [store] : [];
  const sp2 = storeFilter ? [store, store] : [];

  // 1. Monthly inward vs outward trends (last 12 months)
  const monthlyTrends = await queryAll(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(inward_count) as inwarded,
      SUM(outward_count) as outwarded
    FROM (
      SELECT inward_date as date, 1 as inward_count, 0 as outward_count FROM reels WHERE status != 'Deleted'${storeFilter ? ' AND store_code = ?' : ''}
      UNION ALL
      SELECT outward_date as date, 0 as inward_count, 1 as outward_count FROM outwards${storeFilter ? ' WHERE store_code = ?' : ''}
    )
    WHERE date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `, sp2);

  // 2. Stock aging (average days in stock for outwarded reels + current age for in-stock)
  const agingOutwarded = await queryAll(`
    SELECT r.item_code,
      ROUND(AVG(julianday(o.outward_date) - julianday(r.inward_date)), 1) as avg_days_to_ship
    FROM reels r
    JOIN outwards o ON r.reel_number = o.reel_number
    WHERE r.status = 'Outwarded'${storeFilter ? ' AND r.store_code = ?' : ''}
    GROUP BY r.item_code
    ORDER BY avg_days_to_ship DESC
  `, sp);

  const agingInStock = await queryAll(`
    SELECT reel_number, item_code,
      CAST(julianday('now') - julianday(inward_date) AS INTEGER) as days_in_stock
    FROM reels
    WHERE status = 'In Stock'${storeFilter ? ' AND store_code = ?' : ''}
    ORDER BY days_in_stock DESC
    LIMIT 20
  `, sp);

  // 3. Item velocity (outward count per item, last 90 days)
  const velocity = await queryAll(`
    SELECT r.item_code, i.description,
      COUNT(o.id) as outward_count,
      SUM(o.quantity_shipped) as total_shipped
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    JOIN items i ON r.item_code = i.item_code
    WHERE o.outward_date >= date('now', '-90 days')${storeFilter ? ' AND r.store_code = ?' : ''}
    GROUP BY r.item_code
    ORDER BY outward_count DESC
  `, sp);

  // 4. Top customers (by reel count and quantity)
  const topCustomers = await queryAll(`
    SELECT customer_name,
      COUNT(id) as reel_count,
      SUM(quantity_shipped) as total_quantity,
      COUNT(DISTINCT invoice_number) as invoice_count
    FROM outwards
    ${storeFilter ? 'WHERE store_code = ?' : ''}
    GROUP BY customer_name
    ORDER BY total_quantity DESC
    LIMIT 10
  `, sp);

  // 5. Inventory over time (monthly snapshot of in-stock quantity)
  const inventoryOverTime = await queryAll(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(change) as net_change
    FROM (
      SELECT inward_date as date, quantity as change FROM reels WHERE status != 'Deleted'${storeFilter ? ' AND store_code = ?' : ''}
      UNION ALL
      SELECT outward_date as date, -quantity_shipped as change FROM outwards${storeFilter ? ' WHERE store_code = ?' : ''}
    )
    WHERE date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `, sp2);

  // Calculate cumulative inventory
  let cumulative = 0;
  const inventoryTimeline = inventoryOverTime.map(m => {
    cumulative += m.net_change;
    return { month: m.month, quantity: cumulative };
  });

  // 6. Dead stock (items with zero outward in last 30 days but have stock)
  const deadStock = await queryAll(`
    SELECT i.item_code, i.description,
      COUNT(r.id) as in_stock_reels,
      SUM(r.quantity) as total_quantity,
      MAX(o.outward_date) as last_outward_date,
      CAST(julianday('now') - julianday(MAX(o.outward_date)) AS INTEGER) as days_since_last_outward
    FROM items i
    JOIN reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${storeFilter ? ' AND r.store_code = ?' : ''}
    LEFT JOIN outwards o ON r.reel_number = o.reel_number
    GROUP BY i.item_code
    HAVING MAX(o.outward_date) IS NULL OR julianday('now') - julianday(MAX(o.outward_date)) > 30
    ORDER BY days_since_last_outward DESC
  `, sp);

  // 7. Low stock (items with fewer than 5 reels in stock)
  const lowStock = await queryAll(`
    SELECT i.item_code, i.description, i.default_spq,
      COUNT(r.id) as in_stock_reels,
      SUM(r.quantity) as total_quantity
    FROM items i
    LEFT JOIN reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${storeFilter ? ' AND r.store_code = ?' : ''}
    GROUP BY i.item_code
    HAVING in_stock_reels < 5
    ORDER BY in_stock_reels ASC
  `, sp);

  res.json({
    monthlyTrends,
    agingOutwarded,
    agingInStock,
    velocity,
    topCustomers,
    inventoryTimeline,
    deadStock,
    lowStock
  });
}));

// GET item-specific trend
router.get('/item-trend', ah(async (req, res) => {
  const { item_code, store } = req.query;
  if (!item_code) return res.status(400).json({ error: 'item_code required' });
  const storeFilter = store && store !== 'all';

  const params = [item_code];
  if (storeFilter) params.push(store);
  params.push(item_code);
  if (storeFilter) params.push(store);

  const trend = await queryAll(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(inward_count) as inwarded,
      SUM(outward_count) as outwarded
    FROM (
      SELECT inward_date as date, 1 as inward_count, 0 as outward_count FROM reels WHERE item_code = ? AND status != 'Deleted'${storeFilter ? ' AND store_code = ?' : ''}
      UNION ALL
      SELECT o.outward_date as date, 0 as inward_count, 1 as outward_count FROM outwards o JOIN reels r ON o.reel_number = r.reel_number WHERE r.item_code = ?${storeFilter ? ' AND r.store_code = ?' : ''}
    )
    WHERE date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `, params);

  res.json(trend);
}));

// GET export current stock as Excel-compatible CSV
router.get('/export-stock', ah(async (req, res) => {
  const as_on_date = req.query.as_on_date || new Date().toISOString().split('T')[0];
  const { store } = req.query;
  const storeFilter = store && store !== 'all';
  const params = storeFilter ? [store] : [];

  const rows = await queryAll(`
    SELECT i.item_code, i.description, i.default_spq,
      COUNT(CASE WHEN r.status = 'In Stock' THEN r.id END) as in_stock_reels,
      SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
    FROM items i
    LEFT JOIN reels r ON i.item_code = r.item_code${storeFilter ? ' AND r.store_code = ?' : ''}
    GROUP BY i.item_code
    ORDER BY i.item_code
  `, params);

  const headers = 'Item Code,Description,SPQ,In Stock Reels,Total Quantity';
  const csvRows = rows.map(r =>
    [r.item_code, `"${r.description}"`, r.default_spq, r.in_stock_reels || 0, r.total_quantity || 0].join(',')
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=current_stock_${as_on_date}.csv`);
  res.send([headers, ...csvRows].join('\n'));
}));

module.exports = router;
