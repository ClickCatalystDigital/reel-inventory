// Express API. Runs inside the Cloudflare Worker (see worker.mjs); pages are static assets.
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { queryOne, queryAll } = require('./db/schema');
const { sign, userFromHeaders, CLIENT_API_ALLOWLIST } = require('./utils/auth');

const app = express();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

  // HttpOnly: page scripts can't read the token (it used to be set from JS, so any XSS could steal it).
  res.cookie('token', sign(user), {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ success: true, username: user.username, role: user.role });
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  res.redirect('/login');
});

// All routes below require login
app.use((req, res, next) => {
  req.user = userFromHeaders((h) => req.headers[h]);
  if (req.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
});

app.use((req, res, next) => {
  if (req.user.role === 'client' && !CLIENT_API_ALLOWLIST.includes(req.path)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
});

app.use('/api/items', require('./routes/items'));
app.use('/api/inward', require('./routes/inward'));
app.use('/api/outward', require('./routes/outward'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/po', require('./routes/po'));
// Lazy: pdfkit is ~1.5 MB of the Worker; only load it when a PDF is actually requested (faster cold starts).
app.use('/api/labels', (req, res, next) => require('./utils/pdf')(req, res, next));
app.use('/api/transfer', require('./routes/transfer'));
app.use('/api/daily-gate', require('./routes/daily-gate'));
app.use('/api/gelco-docs', require('./routes/gelco-docs'));

// Lightweight auth info endpoint for frontend role-aware UI
app.get('/api/auth/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.get('/api/stores', async (req, res) => {
  res.json(await queryAll("SELECT code, name FROM stores WHERE active = 1 ORDER BY id"));
});

// Backstop for routes that forward errors via next(err) (utils/asyncHandler.js).
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
