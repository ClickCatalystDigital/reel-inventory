// routes/gelco-docs.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { queryAll, execute, queryOne, nowIST } = require('../db/schema');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function requireDocsAccess(req, res, next) {
  if (!['admin', 'manager', 'gelco_manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}
router.use(requireDocsAccess);

const VALID_DOC_TYPES = ['po', 'invoice'];

router.get('/', async (req, res) => {
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
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const doc_type = req.body.doc_type;
  if (!VALID_DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({ error: `doc_type must be one of: ${VALID_DOC_TYPES.join(', ')}` });
  }

  try {
    const key = `inventory-docs/${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;

    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/pdf'
    }));

    const cleanDomain = (process.env.R2_PUBLIC_DOMAIN_URL || '').trim().replace(/^https?:\/\//i, '');
    const file_url = `https://${cleanDomain}/${key}`;

    await execute(
      `INSERT INTO gelco_docs (doc_type, original_filename, file_url, uploaded_by, uploaded_at, store_code) VALUES (?, ?, ?, ?, ?, ?)`,
      [doc_type, req.file.originalname, file_url, req.user.username, nowIST(), 'secondary']
    );

    res.json({ success: true, message: `${req.file.originalname} uploaded` });
  } catch (err) {
    console.error('Docs upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const doc = await queryOne('SELECT * FROM gelco_docs WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  try {
    const cleanDomain = (process.env.R2_PUBLIC_DOMAIN_URL || '').trim().replace(/^https?:\/\//i, '');
    const key = doc.file_url.replace(`https://${cleanDomain}/`, '');
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    }));
  } catch (err) {
    console.error('Failed to purge doc from R2:', err.message);
  }

  await execute('DELETE FROM gelco_docs WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Document deleted' });
});

module.exports = router;
