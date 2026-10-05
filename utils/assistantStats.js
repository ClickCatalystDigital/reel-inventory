// LS AI — small, explainable statistics (no models): days of stock cover, customer reorder rhythm, weekday anomaly.
// Everything is plain arithmetic over our own tables so every number can be explained in one sentence. Shipments here only go
// back to April 2026, so each helper reports how much history it used and refuses to over-claim on thin data.
const { readBatch, istDateString } = require('../db/schema');
const E = require('./assistantEntities');

const dayNum = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const addDays = (s, k) => E.add(String(s).slice(0, 10), k);
const storeArg = (store, col) => (store && store !== 'all' ? { sql: ` AND ${col} = ?`, args: [store] } : { sql: '', args: [] });

// Days of cover per item = quantity in stock / average shipped per day over the last WINDOW days (or the whole history if shorter).
// Shipments are lumpy (a few big orders), so `orders` is returned too: under 3 orders in the window means low confidence.
async function stockCover({ store = 'all', itemCode = null, today = istDateString(), window = 90 } = {}) {
  const st = storeArg(store, 'o.store_code'), stR = storeArg(store, 'r.store_code');
  const [first, shipped, stock] = await readBatch([
    ['SELECT MIN(outward_date) AS d FROM outwards', []],
    [`SELECT r.item_code, SUM(o.quantity_shipped) AS qty, COUNT(DISTINCT o.invoice_number) AS orders FROM outwards o JOIN reels r ON r.reel_number = o.reel_number
      WHERE o.outward_date >= ?${st.sql}${itemCode ? ' AND r.item_code = ?' : ''} GROUP BY r.item_code`, [`${addDays(today, -window)} 00:00:00`, ...st.args, ...(itemCode ? [itemCode] : [])]],
    [`SELECT r.item_code, COUNT(*) AS reels, SUM(r.quantity) AS qty FROM reels r WHERE r.status = 'In Stock'${stR.sql}${itemCode ? ' AND r.item_code = ?' : ''} GROUP BY r.item_code`, [...stR.args, ...(itemCode ? [itemCode] : [])]],
  ]);
  const history = first.rows[0]?.d ? Math.max(1, daysBetween(String(first.rows[0].d).slice(0, 10), today) + 1) : 0;
  const days = Math.max(1, Math.min(window, history));
  const ship = new Map(shipped.rows.map((r) => [r.item_code, { qty: Number(r.qty), orders: Number(r.orders) }]));
  const rows = [];
  const seen = new Set();
  for (const s of stock.rows) {
    seen.add(s.item_code);
    const sh = ship.get(s.item_code) || { qty: 0, orders: 0 };
    const perDay = sh.qty / days, qty = Number(s.qty);
    const cover = perDay > 0 ? qty / perDay : null;
    rows.push({ item_code: s.item_code, reels: Number(s.reels), stock: qty, shipped: sh.qty, orders: sh.orders, per_day: perDay, cover_days: cover, runout: cover === null ? null : addDays(today, Math.floor(cover)) });
  }
  // an item that shipped but now has no stock at all is already out
  for (const [code, sh] of ship) if (!seen.has(code)) rows.push({ item_code: code, reels: 0, stock: 0, shipped: sh.qty, orders: sh.orders, per_day: sh.qty / days, cover_days: 0, runout: today });
  return { days, history, rows };
}

// Reorder rhythm per customer (merged spellings, internal Gelco Stores excluded): order days, usual gap (median), days since the
// last order. "Quiet" = no order for more than twice their usual gap (and at least 21 days). With fewer than 3 orders there is no
// usual gap, so only a long silence (45+ days) is flagged and the row says it is a thin history.
async function customerRhythm({ today = istDateString() } = {}) {
  const [rows] = await readBatch([["SELECT customer_name, substr(outward_date, 1, 10) AS d FROM outwards WHERE customer_name IS NOT NULL AND customer_name != '' GROUP BY customer_name, invoice_number, substr(outward_date, 1, 10)", []]]);
  const keyOf = await E.customerKeyMap();
  const by = new Map();
  for (const r of rows.rows) {
    const g = keyOf.get(r.customer_name); const key = g ? g.key : E.normalizeCustomer(r.customer_name);
    if (g?.internal || key === 'gelco stores') continue;
    let c = by.get(key); if (!c) by.set(key, (c = { key, customer: g ? g.label : r.customer_name, dates: new Set() }));
    c.dates.add(r.d);
  }
  const out = [];
  for (const c of by.values()) {
    const ds = [...c.dates].sort(); const gaps = []; for (let i = 1; i < ds.length; i++) gaps.push(daysBetween(ds[i - 1], ds[i]));
    const last = ds[ds.length - 1], since = daysBetween(last, today), usual = gaps.length >= 2 ? median(gaps) : null; // 3+ order days -> 2+ gaps
    let status, ratio = null;
    if (usual !== null) { ratio = since / Math.max(usual, 1); status = since > Math.max(2 * usual, 21) ? 'quiet' : 'on pattern'; }
    else status = since > 45 ? 'quiet (thin history)' : 'too few orders';
    out.push({ key: c.key, customer: c.customer, orders: ds.length, last_order: last, days_since: since, usual_gap: usual, ratio, status });
  }
  out.sort((a, b) => (b.status.startsWith('quiet') - a.status.startsWith('quiet')) || (b.ratio ?? 0) - (a.ratio ?? 0) || b.days_since - a.days_since);
  return out;
}

// Is a day's shipping unusual for that weekday? Compares the day's pieces shipped with the median of the same weekday over the
// previous 8 weeks (zero-shipment days count as 0). Needs at least 5 of the 8 comparison days to exist in our history.
async function weekdayAnomaly(day) {
  const from = addDays(day, -56);
  const [r] = await readBatch([['SELECT substr(outward_date, 1, 10) AS d, SUM(quantity_shipped) AS qty FROM outwards WHERE outward_date >= ? AND outward_date < ? GROUP BY d', [`${from} 00:00:00`, `${addDays(day, 1)} 00:00:00`]]]);
  const byDay = new Map(r.rows.map((x) => [x.d, Number(x.qty)]));
  const [f] = (await readBatch([['SELECT MIN(outward_date) AS d FROM outwards', []]]));
  const first = f.rows[0]?.d ? String(f.rows[0].d).slice(0, 10) : day;
  const same = [];
  for (let k = 1; k <= 8; k++) { const d = addDays(day, -7 * k); if (d >= first) same.push(byDay.get(d) || 0); }
  const today = byDay.get(day) || 0;
  if (same.length < 5) return null;
  const usual = median(same);
  if (usual <= 0) return null; // a weekday that normally ships nothing has no "usual" to compare with
  const ratio = today / usual;
  if (ratio >= 2) return { today, usual, kind: 'high', ratio };
  if (ratio <= 0.4) return { today, usual, kind: 'low', ratio };
  return null;
}

module.exports = { stockCover, customerRhythm, weekdayAnomaly, daysBetween, median, dayNum };
