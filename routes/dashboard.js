// routes/dashboard.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, batch } = require('../db/schema');

// IN (...) lists in slices, so a big box/cart is a few queries instead of one per item.
const slices = (arr, n = 400) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const qs = (n) => Array(n).fill('?').join(',');
const ah = require('../utils/asyncHandler');
const { getDailyReportData } = require('../utils/dailyReport');
const { hadStockAtStore } = require('../utils/storeMembership');
const { needsVisibilityFilter, visibleToUser } = require('../utils/visibility');

// Gelco roles are scoped to Gelco-only data; dashboard aggregates span all stores, so block
// outright — except gelco_manager reading /stock-summary, which backs their "Stocks" tab
// (they pick LS Stores vs. Gelco Stores there via a store dropdown to decide what to order).
router.use((req, res, next) => {
  if (req.user?.role === 'gelco_manager' && req.method === 'GET' && req.path === '/stock-summary') {
    return next();
  }
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

  // When a specific store is selected, an item only belongs to that store's Stock
  // Summary if it has ever had stock there (utils/storeMembership.js) — same rule as
  // Catalog (routes/items.js): a zero-stock item keeps showing with 0 Qty, but items
  // never stocked there don't appear as rows of zeros. The LEFT JOIN below stays a LEFT JOIN (not
  // switched to inner) so the aggregate counts (total/outwarded) stay accurate
  // for items that do qualify; this WHERE EXISTS only controls which items appear.
  // Client/Gelco logins also only see items assigned to their company (utils/visibility.js).
  const visFilter = needsVisibilityFilter(req.user, store);
  const conds = [];
  if (storeFilter) conds.push(hadStockAtStore('i.item_code'));
  if (visFilter) conds.push(visibleToUser('i.item_code'));
  const membershipFilter = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  if (as_on_date) {
    query = `
      SELECT i.item_code, i.description, i.default_spq,
        COUNT(CASE WHEN r.status != 'Deleted' THEN r.id END) as total_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
      FROM items i
      LEFT JOIN reels r ON i.item_code = r.item_code AND r.inward_date <= ?${storeFilter ? ' AND r.store_code = ?' : ''}
      ${membershipFilter}
      GROUP BY i.item_code ORDER BY i.item_code
    `;
    params.push(as_on_date + ' 23:59:59');
    if (storeFilter) params.push(store, store, store);
    if (visFilter) params.push(req.user.id);
  } else {
    query = `
      SELECT i.item_code, i.description, i.default_spq,
        COUNT(CASE WHEN r.status != 'Deleted' THEN r.id END) as total_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN 1 ELSE 0 END) as in_stock_reels,
        SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
      FROM items i
      LEFT JOIN reels r ON i.item_code = r.item_code${storeFilter ? ' AND r.store_code = ?' : ''}
      ${membershipFilter}
      GROUP BY i.item_code ORDER BY i.item_code
    `;
    if (storeFilter) params.push(store, store, store);
    if (visFilter) params.push(req.user.id);
  }

  res.json(await queryAll(query, params));
}));

router.get('/export', ah(async (req, res) => {
  // Mirrors GET /search's filter shape (q/status/date_from/date_to/store) so the
  // dashboard's export icon can download exactly what's currently on screen —
  // as_on_date stays supported too for any other caller relying on the old shape.
  const { q, status, date_from, date_to, as_on_date, store } = req.query;
  let query = `
    SELECT r.reel_number, r.item_code, i.description, r.quantity, r.status, r.inward_date, r.store_code,
      o.customer_name, o.invoice_number, o.quantity_shipped, o.outward_type, o.outward_date
    FROM reels r
    JOIN items i ON r.item_code = i.item_code
    LEFT JOIN outwards o ON r.reel_number = o.reel_number
    WHERE r.status != 'Deleted'
  `;
  const params = [];

  if (q) {
    query += ` AND (
      r.reel_number LIKE ? OR r.item_code LIKE ? OR r.box_number LIKE ?
      OR r.reel_number IN (SELECT reel_number FROM outwards WHERE customer_name LIKE ? OR invoice_number LIKE ?)
    )`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) { query += ' AND r.status = ?'; params.push(status); }
  if (date_from) { query += ' AND r.inward_date >= ?'; params.push(date_from); }
  if (date_to) { query += ' AND r.inward_date <= ?'; params.push(date_to + ' 23:59:59'); }
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
  // Role check added alongside the hardcoded password below — this hardens the gate,
  // it doesn't replace it. The password itself stays a single shared string, not
  // user-specific or rotatable without a deploy; that's a separate, deferred item.
  if (!['admin', 'manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { reel_numbers, box_numbers, password } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  let reelsToDelete = [];

  // Collect reels from box numbers
  if (box_numbers && box_numbers.length) {
    const byBox = new Map();
    for (const part of slices(box_numbers)) {
      const rows = await queryAll(`SELECT reel_number, box_number FROM reels WHERE box_number IN (${qs(part.length)})`, part);
      rows.forEach((r) => byBox.set(r.box_number, [...(byBox.get(r.box_number) || []), r.reel_number]));
    }
    for (const bn of box_numbers) reelsToDelete.push(...(byBox.get(bn) || []));
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
  for (const part of slices(reelsToDelete)) {
    const rows = await queryAll(`SELECT status FROM reels WHERE reel_number IN (${qs(part.length)})`, part);
    for (const reel of rows) {
      if (reel.status === 'Deleted') stats.already_deleted++;
      else if (reel.status === 'Outwarded') stats.outwarded++;
      else stats.in_stock++;
    }
  }

  // Soft delete (one atomic batch)
  const results = await batch(slices(reelsToDelete).map((part) => [
    `UPDATE reels SET status = 'Deleted', quantity = 0 WHERE reel_number IN (${qs(part.length)}) AND status != 'Deleted'`, part,
  ]));
  const deleted = results.reduce((n, r) => n + r.rowsAffected, 0);

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
    const byBox = new Map();
    for (const part of slices(box_numbers)) {
      const rows = await queryAll(`SELECT reel_number, status, quantity, item_code, box_number FROM reels WHERE box_number IN (${qs(part.length)})`, part);
      rows.forEach((r) => byBox.set(r.box_number, [...(byBox.get(r.box_number) || []), r]));
    }
    // Response rows keep their original shape (no box_number column on box-sourced rows).
    for (const bn of box_numbers) {
      reelsToCheck.push(...(byBox.get(bn) || []).map(({ box_number, ...rest }) => rest));
    }
  }

  if (reel_numbers && reel_numbers.length) {
    const found = new Map();
    for (const part of slices(reel_numbers)) {
      const rows = await queryAll(`SELECT reel_number, status, quantity, item_code, box_number FROM reels WHERE reel_number IN (${qs(part.length)})`, part);
      rows.forEach((r) => found.set(r.reel_number, r));
    }
    for (const rn of reel_numbers) {
      const reel = found.get(rn);
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

  // 7. Low stock (items with fewer than 5 reels in stock). Inner JOIN, not LEFT,
  // when a store is selected — same reasoning as deadStock just above: an item
  // with zero In Stock reels at that store isn't a "low stock" item there, it's
  // simply not stocked there at all (matches Catalog's EXISTS membership rule).
  // LEFT JOIN stays for the all-stores case, where "0 reels anywhere" is a
  // legitimate global low-stock signal.
  const lowStockJoin = storeFilter ? 'JOIN' : 'LEFT JOIN';
  const lowStock = await queryAll(`
    SELECT i.item_code, i.description, i.default_spq,
      COUNT(r.id) as in_stock_reels,
      SUM(r.quantity) as total_quantity
    FROM items i
    ${lowStockJoin} reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${storeFilter ? ' AND r.store_code = ?' : ''}
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
  const params = storeFilter ? [store, store, store] : [];

  // Same membership rule as /stock-summary above and Catalog (routes/items.js).
  const membershipFilter = storeFilter
    ? `WHERE ${hadStockAtStore('i.item_code')}`
    : '';

  const rows = await queryAll(`
    SELECT i.item_code, i.description, i.default_spq,
      COUNT(CASE WHEN r.status = 'In Stock' THEN r.id END) as in_stock_reels,
      SUM(CASE WHEN r.status = 'In Stock' THEN r.quantity ELSE 0 END) as total_quantity
    FROM items i
    LEFT JOIN reels r ON i.item_code = r.item_code${storeFilter ? ' AND r.store_code = ?' : ''}
    ${membershipFilter}
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

// GET today's (IST) inward/outward summary + dead/low stock + pending approvals — Reports > Daily Report
router.get('/daily-report', ah(async (req, res) => {
  res.json(await getDailyReportData(req.query.store, req.query.date));
}));

module.exports = router;
