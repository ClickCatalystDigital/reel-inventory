// routes/orders.js — PO production stage, dispatch lots and per-PO documents.
// Mounted twice in app.js: `staff` at /api/orders (admin/manager/user; writes admin/manager only)
// and `portal` at /api/portal (customer logins, scoped to their user_companies).

const express = require('express');
const multer = require('multer');
const { queryAll, queryOne, execute, readBatch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const r2 = require('../utils/r2');
const { PO_STAGES, PO_DOC_TYPES } = require('../utils/poStages');

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

// Lines, dispatch lots and docs for a set of POs, in one round trip.
async function poDetails(ids) {
  if (!ids.length) return { lines: [], lots: [], docs: [] };
  const q = ids.map(() => '?').join(',');
  const [lines, lots, docs] = await readBatch([
    [`SELECT pi.po_id, pi.id, pi.item_code, pi.quantity_ordered, i.description,
            (SELECT COALESCE(SUM(quantity), 0) FROM reels r
              WHERE r.item_code = pi.item_code AND r.status = 'In Stock' AND r.store_code = 'primary') AS in_stock
       FROM crm_po_items pi LEFT JOIN items i ON i.item_code = pi.item_code
      WHERE pi.po_id IN (${q}) ORDER BY pi.id`, ids],
    [`SELECT * FROM po_dispatches WHERE po_id IN (${q}) ORDER BY dispatch_date DESC, id DESC`, ids],
    [`SELECT id, po_id, doc_type, original_filename, uploaded_by, uploaded_at FROM po_docs
      WHERE po_id IN (${q}) ORDER BY uploaded_at DESC`, ids],
  ]);
  return { lines: lines.rows, lots: lots.rows, docs: docs.rows };
}
const attach = (pos, { lines, lots, docs }) => pos.map((p) => ({
  ...p,
  lines: lines.filter((l) => l.po_id === p.id),
  dispatches: lots.filter((d) => d.po_id === p.id),
  docs: docs.filter((d) => d.po_id === p.id),
}));

// ── Staff ────────────────────────────────────────────────────────────────────
const staff = express.Router();

staff.get('/', ah(async (req, res) => {
  res.json(await queryAll(`
    SELECT p.id, p.po_number, p.status, p.order_date, p.expected_dispatch_date, p.company_id,
           co.name AS company_name, s.stage, s.updated_at AS stage_updated_at, s.updated_by AS stage_updated_by,
           (SELECT COALESCE(SUM(quantity_ordered), 0) FROM crm_po_items WHERE po_id = p.id) AS qty_ordered,
           (SELECT COALESCE(SUM(quantity), 0) FROM po_dispatches WHERE po_id = p.id) AS qty_dispatched,
           (SELECT COUNT(*) FROM po_docs WHERE po_id = p.id) AS doc_count
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
      LEFT JOIN po_stages s ON s.po_id = p.id
     ORDER BY p.created_at DESC LIMIT 500`));
}));

staff.get('/dispatches', ah(async (req, res) => {
  res.json(await queryAll(`
    SELECT d.*, p.po_number, co.name AS company_name, s.stage, i.description
      FROM po_dispatches d
      JOIN crm_purchase_orders p ON p.id = d.po_id
      LEFT JOIN crm_companies co ON co.id = p.company_id
      LEFT JOIN po_stages s ON s.po_id = d.po_id
      LEFT JOIN items i ON i.item_code = d.item_code
     ORDER BY d.updated_at DESC, d.id DESC LIMIT 1000`));
}));

staff.get('/:poId', ah(async (req, res) => {
  const po = await queryOne(`
    SELECT p.*, co.name AS company_name, s.stage, s.updated_at AS stage_updated_at, s.updated_by AS stage_updated_by
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
      LEFT JOIN po_stages s ON s.po_id = p.id
     WHERE p.id = ?`, [req.params.poId]);
  if (!po) return res.status(404).json({ error: 'PO not found' });
  res.json(attach([po], await poDetails([po.id]))[0]);
}));

staff.put('/:poId/stage', editorsOnly, ah(async (req, res) => {
  const { stage } = req.body;
  if (!PO_STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage' });
  if (!(await queryOne('SELECT id FROM crm_purchase_orders WHERE id = ?', [req.params.poId])))
    return res.status(404).json({ error: 'PO not found' });
  await execute(
    `INSERT INTO po_stages (po_id, stage, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(po_id) DO UPDATE SET stage = excluded.stage, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [req.params.poId, stage, req.user.username, nowIST()]
  );
  res.json({ success: true });
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
    SELECT p.id, p.po_number, p.order_date, p.expected_dispatch_date, co.name AS company_name, s.stage, s.updated_at AS stage_updated_at
      FROM crm_purchase_orders p
      LEFT JOIN crm_companies co ON co.id = p.company_id
      LEFT JOIN po_stages s ON s.po_id = p.id
     WHERE p.company_id IN (${MY_COMPANIES}) AND p.status NOT IN ('draft', 'cancelled')
     ORDER BY p.created_at DESC LIMIT 200`, [req.user.id]);
  const d = await poDetails(pos.map((p) => p.id));
  // Customers don't see our stock figures.
  d.lines = d.lines.map(({ in_stock, ...l }) => l);
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
