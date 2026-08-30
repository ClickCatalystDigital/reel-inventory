require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const os = require('os');
const morgan = require('morgan'); // for logs
const { createProxyMiddleware } = require('http-proxy-middleware');
const { initDB, queryOne, queryAll } = require('./db/schema');

// Pages migrated to the Next.js/shadcn frontend (see frontend/) are proxied
// here instead of served via res.sendFile(). Next.js runs as its own process
// (frontend/, port 3001 by default) — this stays the ONLY public entry point,
// so auth/role gating below still applies before a request ever reaches it.
const NEXT_ORIGIN = process.env.NEXT_ORIGIN || 'http://localhost:3001';

// Add a page's exact path here once it's migrated. Deliberately EXACT-match
// only (never a prefix) — mounting this via app.use('/transfer', proxy)
// instead would make Express strip the mount path before the middleware
// sees it, forwarding to Next's '/' instead of '/transfer' (this bit us
// during the pilot). Using pathFilter with exact equality, mounted globally,
// also means the root path ('/', items.html, once migrated) is naturally
// exact-match too — no special-casing needed to avoid the root-proxy
// prefix-swallows-everything risk.
// '/favicon.ico' is included so Next's own auto-generated favicon (from
// frontend/app/favicon.ico) is reachable — without it, the browser's
// implicit favicon request 404s for any role not already redirected
// elsewhere by the allowlist middleware above.
const MIGRATED_PAGE_PATHS = ['/transfer', '/settings', '/notifications', '/gelco-docs', '/stock', '/', '/requests', '/inward', '/login', '/outward', '/dashboard', '/favicon.ico'];

const nextProxy = createProxyMiddleware({
  target: NEXT_ORIGIN,
  changeOrigin: true,
  ws: true,
  pathFilter: (path) => path === '/_next' || path.startsWith('/_next/') || MIGRATED_PAGE_PATHS.includes(path),
});

// Pre-auth mount (below) only needs to let '/login', '/favicon.ico' (the
// browser's automatic, unauthenticated request for it — same reasoning as
// MIGRATED_PAGE_PATHS' own comment on why it's included there), and Next's
// own static assets through before requireLogin runs — every other migrated
// page must pass through requireLogin + ROLE_PAGE_ALLOWLIST first. A
// narrower pathFilter here (not nextProxy's, which matches every migrated
// path) is what makes that true: reusing nextProxy's filter on the pre-auth
// mount previously intercepted and answered every page request right here,
// before requireLogin/the allowlist ever ran — silently turning both into
// dead code for every migrated path, not just '/login'.
// Deliberately no `ws: true` here — http-proxy-middleware auto-subscribes
// each `ws: true` instance to the shared httpServer's 'upgrade' event
// independently, so having it on both this and nextProxy double-proxies
// every WebSocket upgrade (e.g. Next's HMR client), corrupting the frames.
// nextProxy already owns WS upgrades exclusively (its pathFilter matches
// '/_next/*' too, and httpServer.on('upgrade', nextProxy.upgrade) below
// wires it) — this mount only ever needs to proxy plain HTTP requests.
const preAuthNextProxy = createProxyMiddleware({
  target: NEXT_ORIGIN,
  changeOrigin: true,
  pathFilter: (path) => path === '/_next' || path.startsWith('/_next/') || path === '/login' || path === '/favicon.ico',
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';

// Last-resort backstop: an unguarded async rejection anywhere (a route we
// haven't wrapped like routes/po.js's `ah` helper, a timer, anything outside
// a request handler) would otherwise crash the whole process per Node's
// default unhandledRejection behavior, taking the app down for every user.
// This can't turn it into a proper HTTP response — that requires catching it
// at the source — it only keeps the server itself alive.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// 2. Add Morgan logging middleware
// 'dev' prints concise, color-coded logs for development and debugging
app.use(morgan('dev'));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

function requireLogin(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '')
    || req.cookies?.token;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return next();
    } catch (e) {}
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
}

(async () => {
  await initDB();

  // '/login' is unauthenticated by nature, so its proxy entry must run before
  // requireLogin below. Deliberately the narrower preAuthNextProxy, not
  // nextProxy — see its definition above for why.
  app.use(preAuthNextProxy);

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ success: true, username: user.username, role: user.role, token });
  });

  app.get('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
  });

  // All routes below require login
  app.use(requireLogin);

  // Restrict certain roles to an allowlist of pages — anything else redirects.
  const ROLE_PAGE_ALLOWLIST = {
    client: { pages: ['/stock'], redirectTo: '/stock' },
    gelco_worker: { pages: ['/inward', '/outward'], redirectTo: '/inward' },
    gelco_manager: { pages: ['/', '/inward', '/outward', '/transfer', '/requests', '/gelco-docs'], redirectTo: '/inward' },
  };
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/public/')) return next();
    const rule = ROLE_PAGE_ALLOWLIST[req.user?.role];
    if (rule && !rule.pages.includes(req.path)) {
      return res.redirect(rule.redirectTo);
    }
    next();
  });

  // Handles /_next/* (Next.js static assets/RSC payloads) plus every path in
  // MIGRATED_PAGE_PATHS. Mounted globally (not app.use('/transfer', ...)) so
  // Express never strips the path before the proxy sees it — pathFilter does
  // the routing instead, exact-match only.
  app.use(nextProxy);

  // Every page is now served via the nextProxy mounted above
  // (MIGRATED_PAGE_PATHS) — no res.sendFile() routes needed here, the old
  // views/*.html files stay on disk for rollback (delete them in a single
  // cleanup commit once the migration has been stable in production for a
  // while, per the plan — not yet).

  app.use('/api/items', require('./routes/items'));
  app.use('/api/inward', require('./routes/inward'));
  app.use('/api/outward', require('./routes/outward'));
  app.use('/api/requests', require('./routes/requests'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/po', require('./routes/po'));
  app.use('/api/labels', require('./utils/pdf'));
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

  // Backstop for any route that forwards an error via next(err) (see utils/asyncHandler.js,
  // used by routes/po.js, routes/dashboard.js, routes/daily-gate.js, utils/pdf.js) instead
  // of crashing the whole process on an unhandled rejection.
  app.use((err, req, res, next) => {
    console.error(err);
    // Some of those routes (utils/pdf.js) stream a response — if headers/bytes are
    // already out, we can't send a JSON error on top; delegate to Express's default
    // handler, which just terminates the connection instead of throwing again.
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🔧 Reel Inventory running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`   Network: http://${ip}:${PORT}`));
    console.log('');
  });

  // http-proxy-middleware's automatic WS-upgrade detection only fires after
  // an initial plain HTTP request on the same path — a fresh WebSocket
  // handshake (e.g. Next's HMR client hitting /_next/hmr with no prior GET)
  // never gets one, so it silently never upgrades without this manual hook.
  httpServer.on('upgrade', nextProxy.upgrade);
})();

// Keep-alive ping (free tier only)
if (process.env.RENDER_SERVICE_URL) {
  setInterval(() => {
    fetch(process.env.RENDER_SERVICE_URL).catch(() => {});
  }, 14 * 60 * 1000);
}