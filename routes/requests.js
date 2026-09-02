const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, nowIST } = require('../db/schema');
// const { executeInward } = require('./inward');
// const { executeOutwardReel } = require('./outward');
const { executeInward, executeOutwardReel, executeStockTransfer } = require('../utils/inventory');

const APPROVER_ROLES = ['admin', 'manager', 'gelco_manager'];

function requireApprover(req, res, next) {
  if (!APPROVER_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

// gelco_manager only sees/acts on requests that involve Gelco Stores
function isGelcoRelevant(type, payload) {
  if (type === 'transfer') {
    return payload.from_store === 'secondary' || payload.to_store === 'secondary';
  }
  return payload.store_code === 'secondary';
}

// GET all pending requests — for bell count and requests page
router.get('/', async (req, res) => {
  if (req.user?.role === 'gelco_worker') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { status } = req.query;
  const filter = status || 'pending';
  const requests = await queryAll(
    `SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC`,
    [filter]
  );
  // Parse payload JSON for each
  let parsed = requests.map(r => ({
    ...r,
    payload: JSON.parse(r.payload)
  }));
  if (req.user?.role === 'gelco_manager') {
    parsed = parsed.filter(r => isGelcoRelevant(r.type, r.payload));
  }
  res.json(parsed);
});

// GET pending count only — used by bell icon polling
router.get('/count', async (req, res) => {
  if (req.user?.role === 'gelco_worker') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (req.user?.role === 'gelco_manager') {
    const rows = await queryAll(`SELECT type, payload FROM requests WHERE status = 'pending'`, []);
    const count = rows.filter(r => isGelcoRelevant(r.type, JSON.parse(r.payload))).length;
    return res.json({ count });
  }
  const row = await queryOne(
    `SELECT COUNT(*) as count FROM requests WHERE status = 'pending'`,
    []
  );
  res.json({ count: row?.count || 0 });
});

// POST approve a request
router.post('/:id/approve', requireApprover, async (req, res) => {
  const { id } = req.params;
  const reviewer = req.user.username;

  const request = await queryOne('SELECT * FROM requests WHERE id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Request is already ${request.status}` });
  }

  let payload;
  try {
    payload = JSON.parse(request.payload);
  } catch (e) {
    return res.status(500).json({ error: 'Corrupt request payload' });
  }

  if (req.user.role === 'gelco_manager' && !isGelcoRelevant(request.type, payload)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    if (request.type === 'inward') {
      await executeInward(
        payload.item_code,
        payload.num_reels,
        payload.num_boxes,
        payload.notes,
        payload.store_code || 'primary'
      );
    } else if (request.type === 'outward') {
      // Payload can be single reel or box (array of reel_numbers)
      const reelNumbers = payload.reel_numbers || [payload.reel_number];
      const errors = [];

      for (const reel_number of reelNumbers) {
        try {
          await executeOutwardReel(
            reel_number,
            payload.customer_name,
            payload.invoice_number,
            payload.outward_type || 'Full',
            payload.quantity_shipped || null,
            payload.notes,
            payload.company_id || null,
            payload.po_id || null
          );
        } catch (err) {
          errors.push(`${reel_number}: ${err.message}`);
        }
      }

      if (errors.length > 0 && errors.length === reelNumbers.length) {
        return res.status(400).json({ error: 'All reels failed', details: errors });
      }
    } else if (request.type === 'transfer') {
      await executeStockTransfer(
        payload.kind,
        payload.number,
        payload.to_store,
        payload.notes,
        request.created_by
      );
    }

    await execute(
      `UPDATE requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
      [reviewer, nowIST(), id]
    );

    res.json({ success: true, message: `Request #${id} approved` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST reject a request
router.post('/:id/reject', requireApprover, async (req, res) => {
  const { id } = req.params;
  const { reject_reason } = req.body;
  const reviewer = req.user.username;

  const request = await queryOne('SELECT * FROM requests WHERE id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Request is already ${request.status}` });
  }

  if (req.user.role === 'gelco_manager' && !isGelcoRelevant(request.type, JSON.parse(request.payload))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  await execute(
    `UPDATE requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?`,
    [reviewer, nowIST(), reject_reason || null, id]
  );

  res.json({ success: true, message: `Request #${id} rejected` });
});

// POST edit payload and approve in one step (manager edits cart before approving)
router.post('/:id/edit-approve', requireApprover, async (req, res) => {
  const { id } = req.params;
  const { payload: newPayload } = req.body;
  const reviewer = req.user.username;

  if (!newPayload) return res.status(400).json({ error: 'payload is required' });

  const request = await queryOne('SELECT * FROM requests WHERE id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Request is already ${request.status}` });
  }

  if (req.user.role === 'gelco_manager' && !isGelcoRelevant(request.type, JSON.parse(request.payload))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    if (request.type === 'inward') {
      await executeInward(
        newPayload.item_code,
        newPayload.num_reels,
        newPayload.num_boxes,
        newPayload.notes,
        newPayload.store_code || 'primary'
      );
    } else if (request.type === 'outward') {
      const reelNumbers = newPayload.reel_numbers || [newPayload.reel_number];
      const errors = [];

      for (const reel_number of reelNumbers) {
        try {
          await executeOutwardReel(
            reel_number,
            newPayload.customer_name,
            newPayload.invoice_number,
            newPayload.outward_type || 'Full',
            newPayload.quantity_shipped || null,
            newPayload.notes,
            newPayload.company_id || null,
            newPayload.po_id || null
          );
        } catch (err) {
          errors.push(`${reel_number}: ${err.message}`);
        }
      }

      if (errors.length > 0 && errors.length === reelNumbers.length) {
        return res.status(400).json({ error: 'All reels failed', details: errors });
      }
    } else if (request.type === 'transfer') {
      await executeStockTransfer(
        newPayload.kind,
        newPayload.number,
        newPayload.to_store,
        newPayload.notes,
        request.created_by
      );
    }

    await execute(
      `UPDATE requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?, payload = ? WHERE id = ?`,
      [reviewer, nowIST(), JSON.stringify(newPayload), id]
    );

    res.json({ success: true, message: `Request #${id} edited and approved` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;