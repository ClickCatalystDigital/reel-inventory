// routes/items.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, batch } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const { hadStockAtStore } = require('../utils/storeMembership');
const { ITEM_CATEGORIES, parseCompanyIds } = require('../utils/visibility');

// Category and "visible to" are set by admin/manager only; anyone else's values are ignored.
const CATALOG_ADMINS = ['admin', 'manager'];

function parseCategory(v) {
  if (v === undefined) return undefined; // not sent: leave as is
  if (v === null || v === '') return null;
  if (!ITEM_CATEGORIES.includes(v)) throw Object.assign(new Error(`Invalid category "${v}"`), { status: 400 });
  return v;
}

// Statements replacing an item's company list (one batch with the item write).
const visibilityStatements = (code, ids) => [
  ['DELETE FROM item_visibility WHERE item_code = ?', [code]],
  ...ids.map((id) => ['INSERT INTO item_visibility (item_code, company_id) VALUES (?, ?)', [code, id]]),
];

router.get('/', ah(async (req, res) => {
  const { store } = req.query;
  // company_ids (comma-separated) only for those who manage visibility.
  const cols = CATALOG_ADMINS.includes(req.user.role)
    ? "*, (SELECT group_concat(company_id) FROM item_visibility v WHERE v.item_code = items.item_code) AS company_ids"
    : '*';
  let sql = `SELECT ${cols} FROM items WHERE status != 'Deleted'`;
  const params = [];
  if (store && store !== 'all') {
    // Catalog membership for a store is derived at query time, not stored (items stays
    // store-agnostic). "Ever had stock there" so an item at 0 Qty keeps showing.
    sql += ` AND ${hadStockAtStore('items.item_code')}`;
    params.push(store, store);
  }
  sql += " ORDER BY created_at DESC";
  const items = await queryAll(sql, params);
  res.json(items);
}));

router.get('/:itemCode', ah(async (req, res) => {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [req.params.itemCode]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
}));

router.post('/', ah(async (req, res) => {
  const { item_code, description, default_spq } = req.body;
  if (!item_code || !description || !default_spq) {
    return res.status(400).json({ error: 'item_code, description, and default_spq are required' });
  }
  const normalized = item_code.trim().toUpperCase();
  const isAdmin = CATALOG_ADMINS.includes(req.user.role);
  let category;
  try { category = isAdmin ? parseCategory(req.body.category) ?? null : null; } catch (e) { return res.status(400).json({ error: e.message }); }
  const companyIds = (isAdmin && parseCompanyIds(req.body.company_ids)) || [];
  try {
    // Check if a deleted item with this code already exists — restore it instead
    const existing = await queryOne('SELECT * FROM items WHERE item_code = ?', [normalized]);
    if (existing) {
      if (existing.status !== 'Deleted') {
        return res.status(409).json({ error: `Item code "${normalized}" already exists` });
      }
      // Restore the archived item with new details
      await batch([
        ["UPDATE items SET description = ?, default_spq = ?, category = ?, status = 'active' WHERE item_code = ?",
          [description.trim(), parseInt(default_spq), category, normalized]],
        ...visibilityStatements(normalized, companyIds),
      ]);
      return res.json({ success: true, message: `Item ${normalized} restored from archive` });
    }

    await batch([
      ['INSERT INTO items (item_code, description, default_spq, category) VALUES (?, ?, ?, ?)',
        [normalized, description.trim(), parseInt(default_spq), category]],
      ...visibilityStatements(normalized, companyIds),
    ]);
    res.json({ success: true, message: `Item ${normalized} added` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

router.put('/:itemCode', ah(async (req, res) => {
  const { item_code, description, default_spq } = req.body;
  const newCode = item_code ? item_code.trim().toUpperCase() : req.params.itemCode;

  // If renaming, check the new code isn't already taken by another item
  if (newCode !== req.params.itemCode) {
    const conflict = await queryOne('SELECT * FROM items WHERE item_code = ?', [newCode]);
    if (conflict) return res.status(409).json({ error: `Item code "${newCode}" already exists` });
  }

  const isAdmin = CATALOG_ADMINS.includes(req.user.role);
  let category;
  try { category = isAdmin ? parseCategory(req.body.category) : undefined; } catch (e) { return res.status(400).json({ error: e.message }); }
  const companyIds = isAdmin ? parseCompanyIds(req.body.company_ids) : null;

  const exists = await queryOne('SELECT 1 FROM items WHERE item_code = ?', [req.params.itemCode]);
  if (!exists) return res.status(404).json({ error: 'Item not found' });
  await batch([
    [`UPDATE items SET item_code = ?, description = ?, default_spq = ?${category !== undefined ? ', category = ?' : ''} WHERE item_code = ?`,
      [newCode, description.trim(), parseInt(default_spq), ...(category !== undefined ? [category] : []), req.params.itemCode]],
    // A rename carries the item's visibility along; a sent list replaces it.
    ['UPDATE item_visibility SET item_code = ? WHERE item_code = ?', [newCode, req.params.itemCode]],
    ...(companyIds ? visibilityStatements(newCode, companyIds) : []),
  ]);
  res.json({ success: true, message: 'Item updated' });
}));

router.delete('/:itemCode', ah(async (req, res) => {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [req.params.itemCode]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.status === 'Deleted') return res.status(400).json({ error: 'Item already archived' });

  const result = await execute("UPDATE items SET status = 'Deleted' WHERE item_code = ?", [req.params.itemCode]);
  if (result.changes === 0) return res.status(404).json({ error: 'Item not found' });
  res.json({ success: true, message: `Item ${req.params.itemCode} archived` });
}));

module.exports = router;
