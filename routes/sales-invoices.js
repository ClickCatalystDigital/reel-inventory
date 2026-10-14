// routes/sales-invoices.js — Gelco tax invoices. One per Gelco shipment (same number as its packing list,
// counters.invoice). Created when the shipment's packing list is made (or on first open for older ones);
// quantities always come from the shipment's outwards, so an undone reel drops off the invoice. Description,
// HSN, rate and GST % are per invoice, defaulted from the item and editable by admin/manager.
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, readBatch, batch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const brand = require('../utils/brand');
const { STAFF_ROLES } = require('../utils/auth');
const buildInvoicePdf = require('../utils/invoicePdf');

const GELCO_ROLES = ['gelco_manager', 'gelco_worker'];
const DEFAULT_GST = 18;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

router.use((req, res, next) => {
  if (![...STAFF_ROLES, ...GELCO_ROLES].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });
  next();
});
const editors = (req, res, next) => (['admin', 'manager'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Not authorized' }));

// Shipped quantity per item for one Gelco shipment.
const SHIPPED = `SELECT r.item_code, SUM(o.quantity_shipped) AS qty, COUNT(*) AS reels, MIN(o.outward_date) AS first_at,
         MAX(r.inv_desc) AS snap_desc, MAX(r.inv_hsn) AS snap_hsn, MAX(r.inv_rate) AS snap_rate, MIN(r.inv_rate) AS snap_rate_min, MAX(r.inv_gst) AS snap_gst
  FROM outwards o JOIN reels r ON r.reel_number = o.reel_number
  WHERE o.invoice_number = ? AND o.customer_name = ? GROUP BY r.item_code ORDER BY r.item_code`;

// Header + one row per shipped item, adding rows for items not on it yet. Idempotent. Defaults come from the
// reels' transfer-time snapshot, else the item's current invoice details.
// ponytail: reels of one item moved at different rates share one line at the highest rate; split lines if that happens.
async function ensure(no, user) {
  const [shipped, head] = await readBatch([[SHIPPED, [no, brand.partnerStore]], ['SELECT invoice_no FROM sales_invoices WHERE invoice_no = ?', [no]]]);
  if (!shipped.rows.length) return null;
  const codes = shipped.rows.map((s) => s.item_code);
  const items = await queryAll(`SELECT item_code, description, invoice_name, hsn_code, sale_rate, gst_rate FROM items WHERE item_code IN (${codes.map(() => '?').join(',')})`, codes);
  const byCode = Object.fromEntries(items.map((i) => [i.item_code, i]));
  const snap = Object.fromEntries(shipped.rows.map((r) => [r.item_code, r]));
  const date = shipped.rows.map((s) => s.first_at).sort()[0].slice(0, 10);
  await batch([
    ...(head.rows.length ? [] : [['INSERT OR IGNORE INTO sales_invoices (invoice_no, invoice_date, customer_name, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [no, date, brand.partnerStore, user, nowIST()]]]),
    ...codes.map((c) => {
      const it = byCode[c] || {};
      return ['INSERT OR IGNORE INTO sales_invoice_items (invoice_no, item_code, description, hsn_code, rate, gst_rate) VALUES (?, ?, ?, ?, ?, ?)',
        [no, c, snap[c].snap_desc || it.invoice_name || it.description || c, snap[c].snap_hsn || it.hsn_code || null,
         snap[c].snap_rate ?? it.sale_rate ?? null, snap[c].snap_gst ?? it.gst_rate ?? DEFAULT_GST]];
    }),
  ]);
  return load(no);
}

// Amounts for one invoice from its saved rows and its shipped quantities. Rows whose reels were all undone
// (qty 0) are left out; shipped items with no saved row yet count as "no rate".
function compute(head, rows, shipped) {
  const saved = Object.fromEntries(rows.map((l) => [l.item_code, l]));
  const lines = shipped.map((s) => {
    const l = saved[s.item_code] || { item_code: s.item_code, description: s.item_code, hsn_code: null, rate: null, gst_rate: DEFAULT_GST };
    const amount = r2(s.qty * (l.rate || 0));
    const half = r2((amount * (l.gst_rate ?? DEFAULT_GST)) / 200);
    return { ...l, qty: s.qty, reels: s.reels, amount, cgst: half, sgst: half, total: r2(amount + 2 * half) };
  });
  const taxable = r2(lines.reduce((s, l) => s + l.amount, 0));
  const cgst = r2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst = r2(lines.reduce((s, l) => s + l.sgst, 0));
  const total = Math.round(taxable + cgst + sgst);
  return {
    ...head, lines,
    missing_rates: lines.filter((l) => !l.rate).length,
    taxable, cgst, sgst, round_off: r2(total - (taxable + cgst + sgst)), total,
    qty: lines.reduce((s, l) => s + l.qty, 0),
  };
}

async function load(no) {
  const [head, rows, shipped] = await readBatch([
    ['SELECT * FROM sales_invoices WHERE invoice_no = ?', [no]],
    ['SELECT * FROM sales_invoice_items WHERE invoice_no = ?', [no]],
    [SHIPPED, [no, brand.partnerStore]],
  ]);
  if (!head.rows.length) return null;
  return compute(head.rows[0], rows.rows, shipped.rows);
}

// Every partner-store shipment, newest first — including ones from before invoices existed (they get their
// record the first time they're opened). Three queries in all.
router.get('/', ah(async (req, res) => {
  const [shipped, heads, rows] = await readBatch([
    [`SELECT o.invoice_number AS invoice_no, r.item_code, SUM(o.quantity_shipped) AS qty, COUNT(*) AS reels, MIN(o.outward_date) AS first_at
        FROM outwards o JOIN reels r ON r.reel_number = o.reel_number
       WHERE o.customer_name = ? GROUP BY o.invoice_number, r.item_code ORDER BY r.item_code`, [brand.partnerStore]],
    ['SELECT * FROM sales_invoices', []],
    ['SELECT * FROM sales_invoice_items', []],
  ]);
  const group = (list, key) => list.reduce((g, x) => ((g[x[key]] ||= []).push(x), g), {});
  const byShip = group(shipped.rows, 'invoice_no'), byRow = group(rows.rows, 'invoice_no');
  const headOf = Object.fromEntries(heads.rows.map((h) => [h.invoice_no, h]));
  const out = Object.entries(byShip).map(([no, ship]) => {
    const head = headOf[no] || { invoice_no: no, invoice_date: ship.map((x) => x.first_at).sort()[0].slice(0, 10), customer_name: brand.partnerStore };
    const { lines, ...rest } = compute(head, byRow[no] || [], ship);
    return { ...rest, items: lines.length };
  });
  out.sort((a, b) => (Number(b.invoice_no) || 0) - (Number(a.invoice_no) || 0) || String(b.invoice_no).localeCompare(String(a.invoice_no)));
  res.json(out);
}));

// Ensure + return. Called right after a Gelco shipment, and by any screen opening an older one.
router.post('/:no', ah(async (req, res) => {
  const inv = await ensure(String(req.params.no), req.user.username);
  if (!inv) return res.status(404).json({ error: `No ${brand.partnerStore} shipment with invoice ${req.params.no}` });
  res.json(inv);
}));

router.get('/:no', ah(async (req, res) => {
  const inv = await load(String(req.params.no));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json(inv);
}));

// { lines: [{ item_code, description, hsn_code, rate, gst_rate }], remember } — remember also saves them as
// the item's defaults for future invoices.
router.put('/:no', editors, ah(async (req, res) => {
  const no = String(req.params.no);
  if (!(await queryOne('SELECT invoice_no FROM sales_invoices WHERE invoice_no = ?', [no]))) return res.status(404).json({ error: 'Invoice not found' });
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const num = (v) => (v === '' || v == null ? null : Number(v));
  for (const l of lines) {
    if ([num(l.rate), num(l.gst_rate)].some((v) => v != null && (!Number.isFinite(v) || v < 0))) return res.status(400).json({ error: `Invalid rate for ${l.item_code}` });
  }
  const stmts = lines.map((l) => ['UPDATE sales_invoice_items SET description = ?, hsn_code = ?, rate = ?, gst_rate = ? WHERE invoice_no = ? AND item_code = ?',
    [String(l.description || '').trim() || l.item_code, String(l.hsn_code || '').trim() || null, num(l.rate), num(l.gst_rate) ?? DEFAULT_GST, no, l.item_code]]);
  if (req.body.remember) {
    for (const l of lines) stmts.push(['UPDATE items SET invoice_name = ?, hsn_code = ?, sale_rate = ?, gst_rate = ? WHERE item_code = ?',
      [String(l.description || '').trim() || null, String(l.hsn_code || '').trim() || null, num(l.rate), num(l.gst_rate) ?? DEFAULT_GST, l.item_code]]);
  }
  stmts.push(['UPDATE sales_invoices SET updated_by = ?, updated_at = ? WHERE invoice_no = ?', [req.user.username, nowIST(), no]]);
  await batch(stmts);
  res.json(await load(no));
}));

router.get('/:no/pdf', ah(async (req, res) => {
  const inv = (await load(String(req.params.no))) || (await ensure(String(req.params.no), req.user.username));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice_${inv.invoice_no}.pdf`);
  buildInvoicePdf(inv, res);
}));

module.exports = router;
module.exports.load = load;
