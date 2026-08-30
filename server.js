require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const os = require('os');
const morgan = require('morgan'); // for logs
const { initDB, queryOne, queryAll } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';

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

  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));

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

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'items.html')));
  app.get('/inward', (req, res) => res.sendFile(path.join(__dirname, 'views', 'inward.html')));
  app.get('/outward', (req, res) => res.sendFile(path.join(__dirname, 'views', 'outward.html')));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
  app.get('/requests', (req, res) => res.sendFile(path.join(__dirname, 'views', 'requests.html')));
  app.get('/stock', (req, res) => res.sendFile(path.join(__dirname, 'views', 'stock.html')));

  app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'views', 'settings.html')));
  app.get('/transfer', (req, res) => res.sendFile(path.join(__dirname, 'views', 'transfer.html')));
  app.get('/notifications', (req, res) => res.sendFile(path.join(__dirname, 'views', 'notifications.html')));
  app.get('/gelco-docs', (req, res) => res.sendFile(path.join(__dirname, 'views', 'gelco-docs.html')));

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

  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🔧 Reel Inventory running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`   Network: http://${ip}:${PORT}`));
    console.log('');
  });
})();

// Keep-alive ping (free tier only)
if (process.env.RENDER_SERVICE_URL) {
  setInterval(() => {
    fetch(process.env.RENDER_SERVICE_URL).catch(() => {});
  }, 14 * 60 * 1000);
}