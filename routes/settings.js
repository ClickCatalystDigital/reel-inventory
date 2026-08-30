// routes/settings.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { queryAll, queryOne, execute } = require('../db/schema');

const ALLOWED_ROLES = ['admin', 'manager'];

function requireAdmin(req, res, next) {
  if (!ALLOWED_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

router.use(requireAdmin);

// GET all users (no passwords)
router.get('/users', async (req, res) => {
  const users = await queryAll(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(users);
});

// POST add user
router.post('/users', async (req, res) => {
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
});

// PUT update role and/or password
router.put('/users/:id', async (req, res) => {
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
});

// DELETE user
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  // Prevent deleting yourself
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const result = await execute('DELETE FROM users WHERE id = ?', [id]);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, message: 'User deleted' });
});

module.exports = router;