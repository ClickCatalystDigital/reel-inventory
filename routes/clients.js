// routes/clients.js — CRM contacts ("clients"), ported from ls_crm. Tables are owned by ls_crm.
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, batch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');

const CONTACT_SELECT = `
  SELECT c.*, co.name AS company_name, co.website, co.industry, p.name AS product_name
  FROM crm_contacts c
  LEFT JOIN crm_companies co ON c.company_id = co.id
  LEFT JOIN crm_products p ON c.product_id = p.id`;

// LIST — contacts joined to company + product, with search/filter
router.get('/', ah(async (req, res) => {
  const { q, status, product_id, company_id, severity } = req.query;
  let sql = CONTACT_SELECT + ' WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (c.poc_name LIKE ? OR co.name LIKE ? OR c.email LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  if (product_id) { sql += ' AND c.product_id = ?'; params.push(product_id); }
  if (company_id) { sql += ' AND c.company_id = ?'; params.push(company_id); }
  if (severity) { sql += ' AND c.severity = ?'; params.push(severity); }
  sql += ' ORDER BY c.updated_at DESC LIMIT 500';
  res.json(await queryAll(sql, params));
}));

// METRICS — pipeline counts (declared before /:id)
router.get('/meta/metrics', ah(async (req, res) => {
  const byStatus = await queryAll('SELECT status, COUNT(*) AS n FROM crm_contacts GROUP BY status');
  const counts = {};
  let total = 0;
  byStatus.forEach((r) => { counts[r.status] = r.n; total += r.n; });
  const customers = counts.customer || 0;
  const denom = total - (counts.lost || 0);
  res.json({
    total,
    qualified: counts.qualified || 0,
    customers,
    conversion: denom > 0 ? Math.round((customers / (total || 1)) * 100) : 0,
    byStatus: counts,
  });
}));

// WATCH LIST — severity 3 contacts for Home
router.get('/meta/severity-alerts', ah(async (req, res) => {
  res.json(await queryAll(`
    SELECT c.id, c.poc_name, c.status, co.name AS company_name
    FROM crm_contacts c
    LEFT JOIN crm_companies co ON c.company_id = co.id
    WHERE c.severity = 3
    ORDER BY c.poc_name ASC
    LIMIT 10
  `));
}));

// BULK DELETE — one batch instead of one request per row. Same cascade as DELETE /:id.
router.post('/bulk-delete', ah(async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const ph = ids.map(() => '?').join(',');
  const results = await batch([
    [`DELETE FROM crm_notes WHERE contact_id IN (${ph})`, ids],
    [`DELETE FROM crm_tasks WHERE contact_id IN (${ph})`, ids],
    [`DELETE FROM crm_contacts WHERE id IN (${ph})`, ids],
  ]);
  res.json({ success: true, deleted: results[2].rowsAffected, message: 'Client records completely removed' });
}));

// SINGLE — contact + its notes thread + its open tasks (one round trip)
router.get('/:id', ah(async (req, res) => {
  const [contact, notes, tasks] = await batch([
    [CONTACT_SELECT + ' WHERE c.id = ?', [req.params.id]],
    ['SELECT * FROM crm_notes WHERE contact_id = ? ORDER BY created_at DESC', [req.params.id]],
    ["SELECT * FROM crm_tasks WHERE contact_id = ? AND status = 'open' ORDER BY due_date", [req.params.id]],
  ]);
  if (!contact.rows.length) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ...contact.rows[0], notes: notes.rows, tasks: tasks.rows });
}));

// CREATE — finds-or-creates company, then contact, optional first note + next-touchpoint task
router.post('/', ah(async (req, res) => {
  const { poc_name, company_name, designation, email, phone, status, product_id, website, industry, note, next_touchpoint, next_touchpoint_title, next_touchpoint_assignee, severity } = req.body;
  if (!poc_name) return res.status(400).json({ error: 'poc_name is required' });

  let companyId = null;
  if (company_name?.trim()) {
    const existing = await queryOne('SELECT id FROM crm_companies WHERE name = ?', [company_name.trim()]);
    if (existing) {
      companyId = existing.id;
    } else {
      const r = await execute('INSERT INTO crm_companies (name, website, industry) VALUES (?, ?, ?)',
        [company_name.trim(), website || null, industry || null]);
      companyId = r.lastId;
    }
  }

  const r = await execute(
    `INSERT INTO crm_contacts (company_id, poc_name, designation, email, phone, status, product_id, severity, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, poc_name.trim(), designation || null, email || null, phone || null,
     status || 'new', product_id || null, severity || 1, req.user.username, nowIST(), nowIST()]
  );
  const contactId = r.lastId;

  const followUps = [];
  if (note?.trim()) {
    followUps.push(['INSERT INTO crm_notes (contact_id, body, created_by, created_at) VALUES (?, ?, ?, ?)',
      [contactId, note.trim(), req.user.username, nowIST()]]);
  }
  if (next_touchpoint) {
    followUps.push(['INSERT INTO crm_tasks (contact_id, title, due_date, assigned_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [contactId, next_touchpoint_title || 'Follow up', next_touchpoint, next_touchpoint_assignee || req.user.username, req.user.username, nowIST()]]);
  }
  await batch(followUps);

  res.json({ success: true, id: contactId, message: `${poc_name} added` });
}));

// UPDATE contact fields
router.put('/:id', ah(async (req, res) => {
  const { poc_name, designation, email, phone, status, product_id, severity } = req.body;
  if (!poc_name?.trim() || !status) return res.status(400).json({ error: 'poc_name and status are required' });
  const result = await execute(
    `UPDATE crm_contacts SET poc_name = ?, designation = ?, email = ?, phone = ?, status = ?, product_id = ?, severity = ?, updated_at = ?
     WHERE id = ?`,
    [poc_name.trim(), designation || null, email || null, phone || null, status, product_id || null, severity || 1, nowIST(), req.params.id]
  );
  if (!result.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json({ success: true, message: 'Contact updated' });
}));

// ADD a note (timestamped) — also bumps contact's updated_at
router.post('/:id/notes', ah(async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'note body required' });
  await batch([
    ['INSERT INTO crm_notes (contact_id, body, created_by, created_at) VALUES (?, ?, ?, ?)', [req.params.id, body.trim(), req.user.username, nowIST()]],
    ['UPDATE crm_contacts SET updated_at = ? WHERE id = ?', [nowIST(), req.params.id]],
  ]);
  res.json({ success: true, message: 'Note added' });
}));

// DELETE PERMANENTLY — cascade over notes and tasks (company is kept)
router.delete('/:id', ah(async (req, res) => {
  const results = await batch([
    ['DELETE FROM crm_notes WHERE contact_id = ?', [req.params.id]],
    ['DELETE FROM crm_tasks WHERE contact_id = ?', [req.params.id]],
    ['DELETE FROM crm_contacts WHERE id = ?', [req.params.id]],
  ]);
  if (!results[2].rowsAffected) return res.status(404).json({ error: 'Client profile not found' });
  res.json({ success: true, message: 'Client records completely removed' });
}));

module.exports = router;
