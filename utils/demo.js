// Public demo (DEMO_MODE=1, electronics-erp.ahromlabs.com; never set on lstechnologies.in): a visitor
// leaves their details on /demo, then signs in as one of the sample logins below without a password.
// Same flow as SB Ops' demo (shanti-ops: app/demo, server/api/demo, middleware.js demoGuard).
const express = require('express');
const { createClient } = require('@libsql/client/web');
const { queryOne } = require('../db/schema');
const { sign } = require('./auth');

const DEMO = process.env.DEMO_MODE === '1';

// Created by scripts/demo/seed.mjs. Order = order on the /demo page.
const DEMO_ROLES = [
  { username: 'owner', label: 'Owner', blurb: 'Everything: stock, customers, POs, approvals, users' },
  { username: 'manager', label: 'Manager', blurb: 'Inward, outward, transfers, approves staff requests' },
  { username: 'store', label: 'Store staff', blurb: 'Scans reels in and out; changes go for approval' },
  { username: 'partner_manager', label: 'Partner store manager', blurb: "Partner store only; approves yesterday's outward" },
  { username: 'partner_worker', label: 'Partner store worker', blurb: 'Ships from the partner store once the day is approved' },
  { username: 'customer', label: 'Customer portal', blurb: 'Read-only view of the stock kept for them' },
];

// Visitors' details live in their own database (LEADS_TURSO_URL) so the nightly reset never touches them.
let leadsDb = null;
function leads() {
  if (!process.env.LEADS_TURSO_URL) throw new Error('LEADS_TURSO_URL is not set');
  leadsDb ||= createClient({ url: process.env.LEADS_TURSO_URL, authToken: process.env.LEADS_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
  return leadsDb;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const COOKIE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
const hasLead = (req) => req.cookies?.demo_lead === '1';

const router = express.Router();

router.get('/roles', (req, res) => res.json({ roles: DEMO_ROLES, hasLead: hasLead(req) }));

router.post('/lead', async (req, res, next) => {
  try {
    const b = req.body || {};
    const lead = { name: clip(b.name, 120), company: clip(b.company, 160), email: clip(b.email, 160).toLowerCase(), phone: clip(b.phone, 40), business: clip(b.business, 200) };
    if (!lead.name || !lead.company) return res.status(400).json({ error: 'Name and company are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return res.status(400).json({ error: 'Enter a valid email' });
    const db = leads();
    await db.execute(`CREATE TABLE IF NOT EXISTS demo_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT, business TEXT, ip TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.execute({
      sql: 'INSERT INTO demo_leads (name, company, email, phone, business, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [lead.name, lead.company, lead.email, lead.phone || null, lead.business || null, req.headers['cf-connecting-ip'] || null, clip(req.headers['user-agent'], 300) || null],
    });
    res.cookie('demo_lead', '1', { ...COOKIE, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/enter', async (req, res, next) => {
  try {
    if (!hasLead(req)) return res.status(403).json({ error: 'Fill in the form first' });
    const role = DEMO_ROLES.find((r) => r.username === req.body?.username);
    if (!role) return res.status(400).json({ error: 'Unknown role' });
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [role.username]);
    if (!user) return res.status(503).json({ error: 'Demo data is being reset, try again in a minute' });
    res.cookie('token', sign(user), { ...COOKIE, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, home: user.role === 'client' ? '/stock' : user.role.startsWith('gelco_') ? '/outward' : '/' });
  } catch (err) { next(err); }
});

// After login: refuse anything that changes logins or settings, uploads files, or calls the paid AI.
const BLOCKED = ['/api/settings', '/api/assistant', '/api/gelco-docs/upload'];
function guard(req, res, next) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const path = req.originalUrl.split('?')[0];
  const hit = BLOCKED.some((p) => path === p || path.startsWith(p + '/'));
  if (hit && (write || path.startsWith('/api/assistant'))) return res.status(403).json({ error: 'Not available in the demo' });
  if (write && /^\/api\/gelco-docs\/\d+$/.test(path)) return res.status(403).json({ error: 'Not available in the demo' });
  next();
}

module.exports = { DEMO, DEMO_ROLES, router, guard };
