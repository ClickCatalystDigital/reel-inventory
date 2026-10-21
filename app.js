// Express API. Runs inside the Cloudflare Worker (see worker.mjs); pages are static assets.
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { queryOne, queryAll, onGolden } = require('./db/schema');
const { sign, userFromHeaders, CLIENT_API_ALLOWLIST, STAFF_ROLES } = require('./utils/auth');

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

// Public demo only: lead form, role picker, and the guard below. utils/demo.js.
const demo = require('./utils/demo');
// The owner-pass browser works on the golden copy, so its changes survive the nightly reset (db/schema.js). After the
// body parsers: they read the request stream, which would drop the scope.
if (demo.DEMO && process.env.GOLDEN_TURSO_URL) app.use((req, res, next) => (demo.isOwnerPass(req) ? onGolden(next) : next()));
if (demo.DEMO) app.use('/api/demo', demo.router);

app.get('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  res.redirect('/login');
});

// Telegram → Docs: Telegram can't log in, so this one route sits before the login check and is gated by the
// webhook secret instead (routes/invoices.js).
app.post('/api/invoices/telegram-webhook', (req, res, next) => require('./routes/invoices').telegramWebhook(req, res).catch(next));

// All routes below require login
app.use((req, res, next) => {
  req.user = userFromHeaders((h) => req.headers[h]);
  if (req.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
});

if (demo.DEMO) app.use(demo.guard);

app.use((req, res, next) => {
  if (req.user.role === 'client' && !CLIENT_API_ALLOWLIST.includes(req.path)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
});

// CRM APIs are for LS Tech employees only (Gelco roles aren't covered by the client guard above).
app.use(['/api/clients', '/api/tasks', '/api/products', '/api/invoices', '/api/orders', '/api/finance', '/api/procurement'], (req, res, next) => {
  if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });
  next();
});

// LS AI: the chat (+ briefing, starters, thumbs) is open to LS Tech staff — admin, manager, user — and closed to Gelco roles and clients.
// Everything that touches the OpenRouter key, credit, models, consent, cap or the misses list stays admin-only.
const ASSISTANT_STAFF_PATHS = new Set(['/chat', '/briefing', '/starters', '/feedback']);
app.use('/api/assistant', (req, res, next) => {
  const ok = req.user.role === 'admin' || (STAFF_ROLES.includes(req.user.role) && ASSISTANT_STAFF_PATHS.has(req.path));
  if (!ok) return res.status(403).json({ error: 'Not authorized' });
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
app.use('/api/clients', require('./routes/clients'));
app.use('/api/tasks', require('./routes/crm-tasks'));
app.use('/api/products', require('./routes/crm-products'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/sales-invoices', require('./routes/sales-invoices'));
app.use('/api/procurement', require('./routes/procurement'));
const orders = require('./routes/orders');
app.use('/api/orders', orders.staff);
// Any login: scoped to the caller's own companies (user_companies), so staff simply see none.
app.use('/api/portal', orders.portal);
app.use('/api/assistant', require('./routes/assistant'));

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
