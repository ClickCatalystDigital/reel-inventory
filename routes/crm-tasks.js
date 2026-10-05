// routes/crm-tasks.js — CRM follow-up tasks, ported from ls_crm. Tables are owned by ls_crm.
// Mounted at /api/tasks. Static paths (/today, /range, /assignable) come before /:id.
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');

const isApprover = (req) => ['admin', 'manager'].includes(req.user?.role);

// Today's + overdue open tasks, with contact/company context
router.get('/today', ah(async (req, res) => {
  const today = nowIST().substring(0, 10);
  // Staff can never see 'all' — force 'mine' regardless of query
  const scope = isApprover(req) ? (req.query.scope || 'mine') : 'mine';

  let sql = `
    SELECT t.*, c.poc_name, co.name AS company_name
    FROM crm_tasks t
    LEFT JOIN crm_contacts c ON t.contact_id = c.id
    LEFT JOIN crm_companies co ON c.company_id = co.id
    WHERE t.status = 'open' AND t.due_date <= ?`;
  const params = [today];
  if (scope === 'mine') {
    sql += ' AND t.assigned_to = ?';
    params.push(req.user.username);
  }
  sql += ' ORDER BY t.due_date';
  res.json(await queryAll(sql, params));
}));

// Tasks within a date range (for the calendar), grouped client-side. Unscoped, like the CRM.
// invoice_id / contact_id are included so the UI can colour doc/client tasks.
router.get('/range', ah(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  res.json(await queryAll(`
    SELECT t.id, t.title, t.due_date, t.status, t.assigned_to, t.invoice_id, t.contact_id,
           c.poc_name, co.name AS company_name
    FROM crm_tasks t
    LEFT JOIN crm_contacts c ON t.contact_id = c.id
    LEFT JOIN crm_companies co ON c.company_id = co.id
    WHERE t.status = 'open' AND t.due_date >= ? AND t.due_date <= ?
    ORDER BY t.due_date
  `, [from, to]));
}));

// Users that tasks can be assigned to — LS Tech staff only (not admins, not Gelco/client accounts)
router.get('/assignable', ah(async (req, res) => {
  if (!isApprover(req)) return res.status(403).json({ error: 'Not authorized' });
  res.json(await queryAll("SELECT username, role FROM users WHERE role IN ('manager', 'user') ORDER BY username"));
}));

router.post('/', ah(async (req, res) => {
  const { contact_id, title, due_date, assigned_to } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: 'title and due_date required' });
  await execute('INSERT INTO crm_tasks (contact_id, title, due_date, assigned_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [contact_id || null, title.trim(), due_date, assigned_to || req.user.username, req.user.username, nowIST()]);
  res.json({ success: true, message: 'Task created' });
}));

// Single task detail — with contact, company, and last note
router.get('/:id', ah(async (req, res) => {
  const task = await queryOne(`
    SELECT t.*,
           c.poc_name, c.designation, c.email, c.phone,
           c.status AS contact_status, c.id AS crm_contact_id,
           co.name AS company_name
    FROM crm_tasks t
    LEFT JOIN crm_contacts c ON t.contact_id = c.id
    LEFT JOIN crm_companies co ON c.company_id = co.id
    WHERE t.id = ?
  `, [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const note = task.contact_id ? await queryOne(
    `SELECT body, created_by, created_at FROM crm_notes
     WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1`,
    [task.contact_id]
  ) : null;

  res.json({ ...task, last_note: note || null });
}));

// Update task title and/or due_date
router.patch('/:id', ah(async (req, res) => {
  const { title, due_date } = req.body;
  const sets = [], params = [];
  if (title)    { sets.push('title = ?');    params.push(title.trim()); }
  if (due_date) { sets.push('due_date = ?'); params.push(due_date); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  const r = await execute(`UPDATE crm_tasks SET ${sets.join(', ')} WHERE id = ?`, params);
  if (!r.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
}));

router.post('/:id/done', ah(async (req, res) => {
  const r = await execute("UPDATE crm_tasks SET status = 'done', completed_at = ? WHERE id = ?", [nowIST(), req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true, message: 'Task completed' });
}));

// Reopen a completed task (undo)
router.post('/:id/reopen', ah(async (req, res) => {
  const r = await execute("UPDATE crm_tasks SET status = 'open', completed_at = NULL WHERE id = ?", [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true, message: 'Task reopened' });
}));

// Reassign a task (approvers only)
router.post('/:id/assign', ah(async (req, res) => {
  if (!isApprover(req)) return res.status(403).json({ error: 'Not authorized' });
  const { assigned_to } = req.body; // username, or null to unassign
  const r = await execute('UPDATE crm_tasks SET assigned_to = ? WHERE id = ?', [assigned_to || null, req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true, message: assigned_to ? `Assigned to ${assigned_to}` : 'Unassigned' });
}));

// DELETE PERMANENTLY
router.delete('/:id', ah(async (req, res) => {
  const r = await execute('DELETE FROM crm_tasks WHERE id = ?', [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Task already deleted or not found' });
  res.json({ success: true, message: 'Task permanently removed' });
}));

module.exports = router;
