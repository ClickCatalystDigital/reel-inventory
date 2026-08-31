// utils/dailyReport.js
// Aggregates "today" (IST) numbers for the Reports > Daily Report section —
// shared by the JSON endpoint (routes/dashboard.js) and the PDF endpoint
// (utils/pdf.js) so both render from one set of queries.

const { queryAll, queryOne, istDateString, istDayBounds } = require('../db/schema');

async function getDailyReportData(storeCode) {
  const storeFilter = storeCode && storeCode !== 'all';
  const today = istDateString();
  const { start, end } = istDayBounds(today);

  const inward = await queryAll(`
    SELECT item_code,
      COUNT(*) as reel_count,
      SUM(quantity) as total_qty
    FROM reels
    WHERE status != 'Deleted' AND inward_date BETWEEN ? AND ?${storeFilter ? ' AND store_code = ?' : ''}
    GROUP BY item_code
    ORDER BY total_qty DESC
  `, storeFilter ? [start, end, storeCode] : [start, end]);

  const outward = await queryAll(`
    SELECT r.item_code,
      COUNT(DISTINCT o.reel_number) as reel_count,
      SUM(o.quantity_shipped) as total_qty
    FROM outwards o
    JOIN reels r ON o.reel_number = r.reel_number
    WHERE o.outward_date BETWEEN ? AND ?${storeFilter ? ' AND o.store_code = ?' : ''}
    GROUP BY r.item_code
    ORDER BY total_qty DESC
  `, storeFilter ? [start, end, storeCode] : [start, end]);

  // Same shape as routes/dashboard.js's /analytics deadStock/lowStock sub-queries.
  const deadStock = await queryAll(`
    SELECT i.item_code, i.description,
      COUNT(r.id) as in_stock_reels,
      SUM(r.quantity) as total_quantity,
      MAX(o.outward_date) as last_outward_date
    FROM items i
    JOIN reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${storeFilter ? ' AND r.store_code = ?' : ''}
    LEFT JOIN outwards o ON r.reel_number = o.reel_number
    GROUP BY i.item_code
    HAVING MAX(o.outward_date) IS NULL OR julianday('now') - julianday(MAX(o.outward_date)) > 30
    ORDER BY last_outward_date ASC
  `, storeFilter ? [storeCode] : []);

  // Inner JOIN, not LEFT, when a store is selected — same reasoning as deadStock
  // just above and routes/dashboard.js's /analytics lowStock: zero In Stock reels
  // at that store means "not stocked there," not "low stock there."
  const lowStockJoin = storeFilter ? 'JOIN' : 'LEFT JOIN';
  const lowStock = await queryAll(`
    SELECT i.item_code, i.description,
      COUNT(r.id) as in_stock_reels,
      SUM(r.quantity) as total_quantity
    FROM items i
    ${lowStockJoin} reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${storeFilter ? ' AND r.store_code = ?' : ''}
    GROUP BY i.item_code
    HAVING in_stock_reels < 5
    ORDER BY in_stock_reels ASC
  `, storeFilter ? [storeCode] : []);

  const pendingRow = await queryOne(`SELECT COUNT(*) as count FROM requests WHERE status = 'pending'`, []);

  // Genuinely missing before: stock_transfers has its own daily activity, distinct
  // from inward/outward, that Daily Report never surfaced at all.
  const transfers = await queryAll(`
    SELECT st.reel_number, st.box_number, st.from_store, st.to_store, st.quantity,
      st.transferred_by, st.transferred_at, fs.name as from_store_name, ts.name as to_store_name
    FROM stock_transfers st
    LEFT JOIN stores fs ON fs.code = st.from_store
    LEFT JOIN stores ts ON ts.code = st.to_store
    WHERE st.transferred_at BETWEEN ? AND ?${storeFilter ? ' AND (st.from_store = ? OR st.to_store = ?)' : ''}
    ORDER BY st.transferred_at DESC
  `, storeFilter ? [start, end, storeCode, storeCode] : [start, end]);

  return {
    date: today,
    inward,
    outward,
    transfers,
    deadStock,
    lowStock,
    pendingApprovals: pendingRow?.count || 0,
  };
}

module.exports = { getDailyReportData };
