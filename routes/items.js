// routes/items.js

const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute } = require('../db/schema');

router.get('/', async (req, res) => {
  const { store } = req.query;
  let sql = "SELECT * FROM items WHERE status != 'Deleted'";
  const params = [];
  if (store && store !== 'all') {
    // Catalog membership for a store is derived from live reel stock, not stored —
    // items stays store-agnostic (a shared SKU list can exist in multiple stores at
    // once, so a static store_code on items would be wrong data modeling).
    sql += " AND EXISTS (SELECT 1 FROM reels r WHERE r.item_code = items.item_code AND r.store_code = ? AND r.status = 'In Stock')";
    params.push(store);
  }
  sql += " ORDER BY created_at DESC";
  const items = await queryAll(sql, params);
  res.json(items);
});

router.get('/:itemCode', async (req, res) => {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [req.params.itemCode]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.post('/', async (req, res) => {
  const { item_code, description, default_spq } = req.body;
  if (!item_code || !description || !default_spq) {
    return res.status(400).json({ error: 'item_code, description, and default_spq are required' });
  }
  const normalized = item_code.trim().toUpperCase();
  try {
    // Check if a deleted item with this code already exists — restore it instead
    const existing = await queryOne('SELECT * FROM items WHERE item_code = ?', [normalized]);
    if (existing) {
      if (existing.status !== 'Deleted') {
        return res.status(409).json({ error: `Item code "${normalized}" already exists` });
      }
      // Restore the archived item with new details
      await execute(
        "UPDATE items SET description = ?, default_spq = ?, status = 'active' WHERE item_code = ?",
        [description.trim(), parseInt(default_spq), normalized]
      );
      return res.json({ success: true, message: `Item ${normalized} restored from archive` });
    }

    await execute('INSERT INTO items (item_code, description, default_spq) VALUES (?, ?, ?)',
      [normalized, description.trim(), parseInt(default_spq)]);
    res.json({ success: true, message: `Item ${normalized} added` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:itemCode', async (req, res) => {
  const { item_code, description, default_spq } = req.body;
  const newCode = item_code ? item_code.trim().toUpperCase() : req.params.itemCode;

  // If renaming, check the new code isn't already taken by another item
  if (newCode !== req.params.itemCode) {
    const conflict = await queryOne('SELECT * FROM items WHERE item_code = ?', [newCode]);
    if (conflict) return res.status(409).json({ error: `Item code "${newCode}" already exists` });
  }

  const result = await execute(
    'UPDATE items SET item_code = ?, description = ?, default_spq = ? WHERE item_code = ?',
    [newCode, description.trim(), parseInt(default_spq), req.params.itemCode]
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Item not found' });
  res.json({ success: true, message: 'Item updated' });
});

router.delete('/:itemCode', async (req, res) => {
  const item = await queryOne('SELECT * FROM items WHERE item_code = ?', [req.params.itemCode]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.status === 'Deleted') return res.status(400).json({ error: 'Item already archived' });

  const result = await execute("UPDATE items SET status = 'Deleted' WHERE item_code = ?", [req.params.itemCode]);
  if (result.changes === 0) return res.status(404).json({ error: 'Item not found' });
  res.json({ success: true, message: `Item ${req.params.itemCode} archived` });
});

module.exports = router;