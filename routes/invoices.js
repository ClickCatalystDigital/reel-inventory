// routes/invoices.js — the three invoice endpoints the Home task sheet needs (view / approve / reject),
// ported from ls_crm. The rest of the invoice pipeline (upload, AI reading, Tally push, Docs page) is a later phase.
const express = require('express');
const router = express.Router();
const { queryOne, batch, nowIST } = require('../db/schema');
const ah = require('../utils/asyncHandler');

router.get('/:id', ah(async (req, res) => {
  const inv = await queryOne('SELECT * FROM crm_invoices WHERE id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const out = { ...inv };
  if (typeof out.line_items === 'string') {
    try { out.line_items = JSON.parse(out.line_items); } catch { out.line_items = []; }
  }
  res.json(out);
}));

// Approving sends the invoice to Tally (the office agent picks it up) and rejecting discards it, so both are
// admin/manager only and only valid while the invoice is still pending (a stale view or double click can't
// flip an already-pushed invoice). The linked review task is closed in the same batch.
async function review(req, res, status, message) {
  if (!['admin', 'manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Not authorized' });
  const inv = await queryOne('SELECT status, task_id FROM crm_invoices WHERE id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (inv.status !== 'pending') return res.status(409).json({ error: `Invoice is already ${inv.status}` });

  const now = nowIST();
  const approvedAt = status === 'approved' ? now : null;
  const statements = [[
    status === 'approved'
      ? "UPDATE crm_invoices SET status = 'approved', review_notes = ?, approved_at = ? WHERE id = ? AND status = 'pending'"
      : "UPDATE crm_invoices SET status = 'rejected', review_notes = ? WHERE id = ? AND status = 'pending'",
    status === 'approved' ? [req.body.notes || '', approvedAt, req.params.id] : [req.body.notes || '', req.params.id],
  ]];
  if (inv.task_id) statements.push(["UPDATE crm_tasks SET status = 'done', completed_at = ? WHERE id = ?", [now, inv.task_id]]);
  await batch(statements);
  res.json({ success: true, message });
}

router.post('/:id/approve', ah((req, res) => review(req, res, 'approved', 'Invoice approved. Local agent will push to Tally.')));
router.post('/:id/reject', ah((req, res) => review(req, res, 'rejected', 'Invoice rejected.')));

module.exports = router;
