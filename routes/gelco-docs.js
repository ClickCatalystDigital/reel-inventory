// routes/gelco-docs.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { queryAll, execute, queryOne, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const r2 = require('../utils/r2');

function requireDocsAccess(req, res, next) {
  if (!['admin', 'manager', 'gelco_manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}
router.use(requireDocsAccess);

const VALID_DOC_TYPES = ['po', 'invoice'];

router.get('/', ah(async (req, res) => {
  const { doc_type, store } = req.query;
  let sql = 'SELECT * FROM gelco_docs';
  const conditions = [];
  const params = [];
  if (doc_type && VALID_DOC_TYPES.includes(doc_type)) {
    conditions.push('doc_type = ?');
    params.push(doc_type);
  }
  if (store && store !== 'all') {
    conditions.push('store_code = ?');
    params.push(store);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY uploaded_at DESC';
  res.json(await queryAll(sql, params));
}));

// Files live in a private bucket and are only reachable through here (login + role checked above).
const KEY_PREFIX = 'inventory-docs/';
const fileUrl = (key) => `/api/gelco-docs/file?key=${encodeURIComponent(key)}`;

router.get('/file', ah(async (req, res) => {
  const key = String(req.query.key || '');
  if (!key.startsWith(KEY_PREFIX)) return res.status(400).json({ error: 'Invalid key' });
  const obj = await r2().get(key);
  if (!obj) return res.status(404).json({ error: 'File not found' });
  // attachment + nosniff: stored files must never render as a page on this origin.
  res.set({
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${key.split('/').pop().replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(Buffer.from(await obj.arrayBuffer()));
}));

router.post('/upload', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files are allowed' });
  const doc_type = req.body.doc_type;
  if (!VALID_DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({ error: `doc_type must be one of: ${VALID_DOC_TYPES.join(', ')}` });
  }

  try {
    const key = `${KEY_PREFIX}${Date.now()}-${req.file.originalname.replace(/[^\w.-]+/g, '_')}`;

    await r2().put(key, req.file.buffer, {
      httpMetadata: { contentType: 'application/pdf' }
    });

    const file_url = fileUrl(key);

    await execute(
      `INSERT INTO gelco_docs (doc_type, original_filename, file_url, uploaded_by, uploaded_at, store_code) VALUES (?, ?, ?, ?, ?, ?)`,
      [doc_type, req.file.originalname, file_url, req.user.username, nowIST(), 'secondary']
    );

    res.json({ success: true, message: `${req.file.originalname} uploaded` });
  } catch (err) {
    console.error('Docs upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
}));

router.delete('/:id', ah(async (req, res) => {
  const doc = await queryOne('SELECT * FROM gelco_docs WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  try {
    const key = new URL(doc.file_url, 'http://x').searchParams.get('key');
    if (key?.startsWith(KEY_PREFIX)) await r2().delete(key);
  } catch (err) {
    console.error('Failed to purge doc from R2:', err.message);
  }

  await execute('DELETE FROM gelco_docs WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Document deleted' });
}));

module.exports = router;
