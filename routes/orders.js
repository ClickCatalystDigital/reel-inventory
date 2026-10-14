// routes/orders.js — PO production stage, dispatch lots and per-PO documents.
// Mounted twice in app.js: `staff` at /api/orders (admin/manager/user; writes admin/manager only)
// and `portal` at /api/portal (customer logins, scoped to their user_companies).

const express = require('express');
const multer = require('multer');
const { queryAll, queryOne, execute, readBatch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const r2 = require('../utils/r2');
const { PO_DOC_TYPES } = require('../utils/poStages');
const { progress } = require('../utils/poProgress');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const KEY_PREFIX = 'inventory-docs/po/';
const canEdit = (req) => ['admin', 'manager'].includes(req.user.role);
function editorsOnly(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Not authorized' });
  next();
}

async function sendDoc(res, doc) {
  const obj = await r2().get(doc.r2_key);
  if (!obj) return res.status(404).json({ error: 'File not found' });
  res.set({
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${(doc.original_filename || 'document.pdf').replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(Buffer.from(await obj.arrayBuffer()));
}

// Free LS Tech Stores stock per item: in stock, not reserved. (Partner-store stock is never LS's to use.)
async function freeStock(itemCodes) {
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (!codes.length) return {};
  const rows = await queryAll(`SELECT item_code, SUM(quantity) AS qty, COUNT(*) AS reels FROM reels
    WHERE store_code = 'primary' AND status = 'In Stock' AND reserved_po_item_id IS NULL AND item_code IN (${codes.map(() => '?').join(',')})
    GROUP BY item_code`, codes);
  return Object.fromEntries(rows.map((r) => [r.item_code, r]));
}

// Lines (with progress), dispatch lots and docs for a set of POs.
async function poDetails(ids) {
  if (!ids.length) return { lines: [], lots: [], docs: [] };
  const q = ids.map(() => '?').join(',');
  const [{ lines }, [lots, docs]] = await Promise.all([progress(ids), readBatch([
    [`SELECT * FROM po_dispatches WHERE po_id IN (${q}) ORDER BY dispatch_date DESC, id DESC`, ids],
    [`SELECT id, po_id, doc_type, original_filename, uploaded_by, uploaded_at FROM po_docs
      WHERE po_id IN (${q}) ORDER BY uploaded_at DESC`, ids],
  ])]);
  const free = await freeStock(lines.map((l) => l.item_code));
  return { lines: lines.map((l) => ({ ...l, free_stock: free[l.item_code]?.qty || 0 })), lots: lots.rows, docs: docs.rows };
}
const attach = (pos, { lines, lots, docs }) => pos.map((p) => {
  const ls = lines.filter((l) => l.po_id === p.id);
  return {
    ...p,
    stage: ls.length ? ls.reduce((a, l) => (LINE_RANK(l.status) < LINE_RANK(a) ? l.status : a), 'Completed') : 'Not planned',
    lines: ls,
    dispatches: lots.filter((d) => d.po_id === p.id),
    docs: docs.filter((d) => d.po_id === p.id),
  };
});
const LINE_RANK = (s) => require('../utils/poStages').LINE_STATUSES.indexOf(s);

// ── Staff ────────────────────────────────────────────────────────────────────
const staff = express.Router();

staff.get('/', ah(async (req, res) => {
  const pos = await queryAll(`
    SELECT p.id, p.po_number, p.status, p.order_date, p.expected_dispatch_date, p.company_id, co.name AS company_name,
           (SELECT COUNT(*) FROM po_docs WHERE po_id = p.id) AS doc_count
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
     ORDER BY p.created_at DESC LIMIT 500`);
  const { byPo } = await progress(pos.map((p) => p.id));
  res.json(pos.map((p) => {
    const ls = byPo[p.id]?.lines || [];
    const sum = (k) => ls.reduce((s, l) => s + (l[k] || 0), 0);
    return { ...p, stage: byPo[p.id]?.status || 'Not planned', qty_ordered: sum('ordered'), qty_dispatched: sum('dispatched'), qty_reserved: sum('reserved'), qty_needed: sum('needed') };
  }));
}));

staff.get('/dispatches', ah(async (req, res) => {
  const rows = await queryAll(`
    SELECT d.*, p.po_number, co.name AS company_name, i.description
      FROM po_dispatches d
      JOIN crm_purchase_orders p ON p.id = d.po_id
      LEFT JOIN crm_companies co ON co.id = p.company_id
      LEFT JOIN items i ON i.item_code = d.item_code
     ORDER BY d.updated_at DESC, d.id DESC LIMIT 1000`);
  const { byPo } = await progress([...new Set(rows.map((r) => r.po_id))]);
  res.json(rows.map((r) => ({ ...r, stage: byPo[r.po_id]?.status || 'Not planned' })));
}));

staff.get('/:poId', ah(async (req, res) => {
  const po = await queryOne(`
    SELECT p.*, co.name AS company_name
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
     WHERE p.id = ?`, [req.params.poId]);
  if (!po) return res.status(404).json({ error: 'PO not found' });
  res.json(attach([po], await poDetails([po.id]))[0]);
}));

// Reserve free LS Tech Stores reels for one PO line, oldest stock first, until what's still to ship is
// covered (the last whole reel may overshoot). Single UPDATE guarded on "still free", so two people
// reserving at once can't both take a reel; whatever was taken by someone else is simply not counted.
staff.post('/:poId/lines/:lineId/reserve', editorsOnly, ah(async (req, res) => {
  const { byPo } = await progress([Number(req.params.poId)]);
  const line = byPo[req.params.poId]?.lines.find((l) => l.id === Number(req.params.lineId));
  if (!line) return res.status(404).json({ error: 'PO line not found' });
  if (!line.item_code) return res.status(400).json({ error: 'Assign an item to this line first' });
  const po = await queryOne('SELECT status FROM crm_purchase_orders WHERE id = ?', [req.params.poId]);
  if (po.status === 'cancelled') return res.status(400).json({ error: 'PO is cancelled' });
  const want = Math.min(Number(req.body.qty) || Infinity, line.ordered - line.dispatched - line.reserved);
  if (!(want > 0)) return res.status(400).json({ error: 'Nothing left to reserve on this line' });
  const free = await queryAll(`SELECT reel_number, quantity FROM reels WHERE item_code = ? AND store_code = 'primary'
    AND status = 'In Stock' AND reserved_po_item_id IS NULL ORDER BY inward_date, reel_number`, [line.item_code]);
  const pick = [];
  let got = 0;
  for (const r of free) { if (got >= want) break; pick.push(r.reel_number); got += r.quantity; }
  if (!pick.length) return res.status(400).json({ error: `No free ${line.item_code} stock at LS Tech Stores` });
  const r = await execute(`UPDATE reels SET reserved_po_item_id = ?, reserved_at = ?, reserved_by = ?
    WHERE reel_number IN (${pick.map(() => '?').join(',')}) AND reserved_po_item_id IS NULL AND status = 'In Stock' AND store_code = 'primary'`,
    [line.id, nowIST(), req.user.username, ...pick]);
  res.json({ success: true, reels: r.changes, message: `${r.changes} reel(s) reserved for ${line.item_code}` });
}));

staff.post('/:poId/lines/:lineId/release', editorsOnly, ah(async (req, res) => {
  const line = await queryOne('SELECT id FROM crm_po_items WHERE id = ? AND po_id = ?', [req.params.lineId, req.params.poId]);
  if (!line) return res.status(404).json({ error: 'PO line not found' });
  const r = await execute(`UPDATE reels SET reserved_po_item_id = NULL, reserved_at = NULL, reserved_by = NULL
    WHERE reserved_po_item_id = ? AND status = 'In Stock'`, [line.id]);
  res.json({ success: true, message: `${r.changes} reel(s) released` });
}));

// A lot's item must be a line on that PO; qty a positive whole number.
async function validLot(body) {
  const po_id = Number(body.po_id);
  const quantity = Number(body.quantity);
  const item_code = String(body.item_code || '').trim();
  if (!po_id || !item_code) return { error: 'PO and item are required' };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: 'Quantity must be a whole number above 0' };
  if (body.dispatch_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.dispatch_date)) return { error: 'Invalid dispatch date' };
  const line = await queryOne('SELECT 1 FROM crm_po_items WHERE po_id = ? AND item_code = ?', [po_id, item_code]);
  if (!line) return { error: `${item_code} is not on this PO` };
  return { po_id, item_code, quantity, dispatch_date: body.dispatch_date || null, notes: String(body.notes || '').trim() || null };
}

staff.post('/dispatches', editorsOnly, ah(async (req, res) => {
  const v = await validLot(req.body);
  if (v.error) return res.status(400).json(v);
  const r = await execute(
    `INSERT INTO po_dispatches (po_id, item_code, quantity, dispatch_date, notes, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [v.po_id, v.item_code, v.quantity, v.dispatch_date, v.notes, req.user.username, nowIST()]
  );
  res.json({ success: true, id: r.lastId });
}));

staff.put('/dispatches/:id', editorsOnly, ah(async (req, res) => {
  const v = await validLot(req.body);
  if (v.error) return res.status(400).json(v);
  const r = await execute(
    `UPDATE po_dispatches SET po_id = ?, item_code = ?, quantity = ?, dispatch_date = ?, notes = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [v.po_id, v.item_code, v.quantity, v.dispatch_date, v.notes, req.user.username, nowIST(), req.params.id]
  );
  if (!r.changes) return res.status(404).json({ error: 'Dispatch not found' });
  res.json({ success: true });
}));

staff.delete('/dispatches/:id', editorsOnly, ah(async (req, res) => {
  const r = await execute('DELETE FROM po_dispatches WHERE id = ?', [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Dispatch not found' });
  res.json({ success: true });
}));

staff.post('/:poId/docs', editorsOnly, upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files are allowed' });
  if (!PO_DOC_TYPES.includes(req.body.doc_type)) return res.status(400).json({ error: 'Pick a document type' });
  if (!(await queryOne('SELECT id FROM crm_purchase_orders WHERE id = ?', [req.params.poId])))
    return res.status(404).json({ error: 'PO not found' });
  const key = `${KEY_PREFIX}${req.params.poId}/${Date.now()}-${req.file.originalname.replace(/[^\w.-]+/g, '_')}`;
  await r2().put(key, req.file.buffer, { httpMetadata: { contentType: 'application/pdf' } });
  await execute(
    'INSERT INTO po_docs (po_id, doc_type, original_filename, r2_key, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.poId, req.body.doc_type, req.file.originalname, key, req.user.username, nowIST()]
  );
  res.json({ success: true });
}));

staff.get('/docs/:id/file', ah(async (req, res) => {
  const doc = await queryOne('SELECT * FROM po_docs WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await sendDoc(res, doc);
}));

staff.delete('/docs/:id', editorsOnly, ah(async (req, res) => {
  const doc = await queryOne('SELECT * FROM po_docs WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  try { await r2().delete(doc.r2_key); } catch (err) { console.error('Failed to purge PO doc from R2:', err.message); }
  await execute('DELETE FROM po_docs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ── Customer portal ──────────────────────────────────────────────────────────
// Only the caller's companies (user_companies). Draft and cancelled POs are internal, so hidden.
const portal = express.Router();
const MY_COMPANIES = 'SELECT company_id FROM user_companies WHERE user_id = ?';

portal.get('/orders', ah(async (req, res) => {
  const pos = await queryAll(`
    SELECT p.id, p.po_number, p.order_date, p.expected_dispatch_date, co.name AS company_name
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
     WHERE p.company_id IN (${MY_COMPANIES}) AND p.status NOT IN ('draft', 'cancelled')
     ORDER BY p.created_at DESC LIMIT 200`, [req.user.id]);
  const d = await poDetails(pos.map((p) => p.id));
  // Customers see their own progress only: no stock figures, procurement numbers or usernames.
  d.lines = d.lines.map(({ free_stock, procurement, unit_price, notes, ...l }) => ({ ...l, expected_date: procurement.filter((p) => p.stage !== 'Received').map((p) => p.expected_date).filter(Boolean).sort().pop() || null }));
  d.lots = d.lots.map(({ updated_by, ...l }) => l);
  d.docs = d.docs.map(({ uploaded_by, ...l }) => l);
  res.json(attach(pos, d));
}));

portal.get('/file', ah(async (req, res) => {
  const doc = await queryOne(`
    SELECT d.* FROM po_docs d JOIN crm_purchase_orders p ON p.id = d.po_id
     WHERE d.id = ? AND p.company_id IN (${MY_COMPANIES}) AND p.status NOT IN ('draft', 'cancelled')`,
    [req.query.id, req.user.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await sendDoc(res, doc);
}));

module.exports = { staff, portal };
