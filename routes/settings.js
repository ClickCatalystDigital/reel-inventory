// routes/settings.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, execute } = require('../db/schema');
const ah = require('../utils/asyncHandler');
const r2 = require('../utils/r2');

const ALLOWED_ROLES = ['admin', 'manager'];

function requireAdmin(req, res, next) {
  if (!ALLOWED_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

router.use(requireAdmin);

// GET all users (no passwords)
router.get('/users', ah(async (req, res) => {
  const users = await queryAll(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(users);
}));

// POST add user
router.post('/users', ah(async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required' });
  }
  const validRoles = ['user', 'client', 'manager', 'admin', 'gelco_manager', 'gelco_worker'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await execute(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username.trim().toLowerCase(), hash, role]
    );
    res.json({ success: true, message: `User "${username}" created` });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Username "${username}" already exists` });
    }
    res.status(500).json({ error: err.message });
  }
}));

// PUT update role and/or password
router.put('/users/:id', ah(async (req, res) => {
  const { role, password } = req.body;
  const { id } = req.params;
  const validRoles = ['user', 'client', 'manager', 'admin', 'gelco_manager', 'gelco_worker'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  const user = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newRole = role || user.role;

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await execute('UPDATE users SET role = ?, password = ? WHERE id = ?', [newRole, hash, id]);
  } else {
    await execute('UPDATE users SET role = ? WHERE id = ?', [newRole, id]);
  }

  res.json({ success: true, message: 'User updated' });
}));

// DELETE user
router.delete('/users/:id', ah(async (req, res) => {
  const { id } = req.params;
  // Prevent deleting yourself
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const result = await execute('DELETE FROM users WHERE id = ?', [id]);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, message: 'User deleted' });
}));

// GET storage usage (read-only) — Turso per-table sizes via dbstat + Cloudflare R2 bucket size by prefix.
function tableCategory(name) {
  if (name.startsWith('crm_')) return 'CRM (shared)';
  if (name === 'reels') return 'Reels';
  if (name === 'outwards') return 'Outwards';
  if (name === 'stock_transfers') return 'Transfers';
  if (name === 'items' || name === 'boxes') return 'Items & boxes';
  return 'Other';
}

async function tursoUsage() {
  try {
    // Indexes are folded into their table via sqlite_master.tbl_name.
    const sizes = await queryAll(
      'SELECT m.tbl_name AS name, SUM(d.pgsize) AS bytes FROM dbstat d JOIN sqlite_master m ON m.name = d.name GROUP BY m.tbl_name'
    );
    const total = (await queryOne('SELECT SUM(pgsize) AS bytes FROM dbstat')).bytes || 0;
    const items = await Promise.all(sizes.map(async (t) => ({
      name: t.name,
      category: tableCategory(t.name),
      bytes: t.bytes,
      rows: (await queryOne(`SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g, '""')}"`)).c,
    })));
    const rest = total - items.reduce((s, t) => s + t.bytes, 0);
    if (rest > 0) items.push({ name: 'sqlite_schema', category: 'Other', bytes: rest, rows: null });
    items.sort((a, b) => b.bytes - a.bytes);
    return { available: true, total_bytes: total, items };
  } catch (e) {
    // dbstat can be missing on a local SQLite build — show "unavailable", not an error.
    return { available: false, error: e.message };
  }
}

async function r2Usage() {
  if (!globalThis.R2_BUCKET) return { configured: false };
  try {
    // Bucket is shared with the ls_crm app; this app's own files live under inventory-docs/.
    const groups = {
      'inventory-docs/': { name: 'Inventory docs (this app)', category: 'Inventory docs', objects: 0, bytes: 0 },
      other: { name: 'CRM files (ls_crm)', category: 'CRM files', objects: 0, bytes: 0 },
    };
    let cursor;
    do {
      const out = await r2().list({ cursor });
      for (const o of out.objects) {
        const g = o.key.startsWith('inventory-docs/') ? groups['inventory-docs/'] : groups.other;
        g.objects += 1;
        g.bytes += o.size || 0;
      }
      cursor = out.truncated ? out.cursor : undefined;
    } while (cursor);
    const items = Object.values(groups);
    return { configured: true, total_bytes: items.reduce((s, g) => s + g.bytes, 0), items };
  } catch (e) {
    return { configured: true, error: e.message };
  }
}

router.get('/storage', ah(async (req, res) => {
  const [turso, r2] = await Promise.all([tursoUsage(), r2Usage()]);
  res.json({ turso, r2 });
}));

module.exports = router;
