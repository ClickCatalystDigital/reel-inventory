// Public demo (DEMO_MODE=1, electronics-erp.ahromlabs.com; never set on lstechnologies.in): a visitor
// leaves their details on /demo, then signs in as one of the sample logins below without a password.
// Same flow as SB Ops' demo (shanti-ops: app/demo, server/api/demo, middleware.js demoGuard).
const express = require('express');
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
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
  { username: 'customer', label: 'Customer portal', blurb: 'Read-only view of their stock and order progress' },
];

// Visitors' details live in their own database (LEADS_TURSO_URL) so the nightly reset never touches them.
let leadsDb = null;
let leadsReady = null;
function leads() {
  if (!process.env.LEADS_TURSO_URL) throw new Error('LEADS_TURSO_URL is not set');
  leadsDb ||= createClient({ url: process.env.LEADS_TURSO_URL, authToken: process.env.LEADS_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
  return leadsDb;
}
// The table and its AI columns, once per Worker start (cleared on failure so the next request retries).
function readyLeads() {
  leadsReady ||= leadsTable(leads()).then(() => leads(), (e) => { leadsReady = null; throw e; });
  return leadsReady;
}

// The AI assistant in the demo: each visitor (one lead form) gets this many questions, counted in the
// leads DB so the nightly reset doesn't refill them. Then the widget locks and points them to us.
const AI_QUESTIONS = 2;
const aiKey = () => process.env.OPEN_ROUTER_KEY || null; // the demo's own capped key (wrangler secret)

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const COOKIE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
// demo_lead holds the visitor's lead token (older visitors have '1': they can enter, but get no AI questions).
const leadToken = (req) => req.cookies?.demo_lead || null;
const hasLead = (req) => !!leadToken(req);

// Owner pass: a short PIN (the Worker secret DEMO_PASS, 4+ characters), typed under "Have a demo pass?" on /demo or
// opened as /demo#pass=<PIN>. POST /api/demo/pass trades it for a demo_lead cookie holding an HMAC of the PIN (never the
// PIN itself): that browser skips the form, is never saved as a lead, and asks the assistant without a limit. A short PIN
// is guessable, so wrong tries are capped: 5 per visitor IP and 200 in all per day. No DEMO_PASS, no pass.
// Same as savistar-ops and shanti-ops.
const passKey = () => (process.env.DEMO_PASS && process.env.DEMO_PASS.length >= 4 ? process.env.DEMO_PASS : null);
const PASS_TRIES_PER_IP = 5, PASS_TRIES_PER_DAY = 200;
const utcDay = () => new Date().toISOString().slice(0, 10);
async function passLocked(ip) {
  const r = await (await readyLeads()).execute({ sql: 'SELECT COALESCE(SUM(n), 0) AS total, COALESCE(SUM(CASE WHEN ip = ? THEN n END), 0) AS mine FROM demo_pass_tries WHERE day = ?', args: [ip, utcDay()] });
  return Number(r.rows[0].mine) >= PASS_TRIES_PER_IP || Number(r.rows[0].total) >= PASS_TRIES_PER_DAY;
}
async function passFailed(ip) {
  await (await readyLeads()).execute({ sql: 'INSERT INTO demo_pass_tries (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1', args: [ip, utcDay()] });
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const ownerPassToken = () => (passKey() ? `pass.${createHmac('sha256', passKey()).update('demo-owner-pass').digest('base64url')}` : null);
const isOwnerPass = (req) => !!ownerPassToken() && !!leadToken(req) && same(leadToken(req), ownerPassToken());

async function leadsTable(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS demo_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, business TEXT, ip TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  for (const col of ['token TEXT', 'ai_used INTEGER NOT NULL DEFAULT 0']) {
    await db.execute(`ALTER TABLE demo_leads ADD COLUMN ${col}`).catch(() => {}); // already there
  }
  // wrong owner-pass tries, per visitor IP per day (passLocked below)
  await db.execute('CREATE TABLE IF NOT EXISTS demo_pass_tries (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip, day))');
}

// Questions this visitor has left (0 when unknown).
async function aiLeft(req) {
  if (isOwnerPass(req)) return AI_QUESTIONS; // shown as "no limit"
  const token = leadToken(req);
  if (!token || token === '1') return 0;
  const r = await (await readyLeads()).execute({ sql: 'SELECT ai_used FROM demo_leads WHERE token = ?', args: [token] });
  return r.rows.length ? Math.max(0, AI_QUESTIONS - Number(r.rows[0].ai_used)) : 0;
}
// Takes one question atomically; false when none are left.
async function takeAiQuestion(req) {
  if (isOwnerPass(req)) return true;
  const token = leadToken(req);
  if (!token || token === '1') return false;
  const r = await (await readyLeads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used + 1 WHERE token = ? AND ai_used < ?', args: [token, AI_QUESTIONS] });
  return r.rowsAffected === 1;
}
// Gives it back when the answer failed (OpenRouter down, etc.), so a visitor never loses one to an error.
async function returnAiQuestion(req) {
  if (isOwnerPass(req)) return;
  const token = leadToken(req);
  if (token && token !== '1') await (await readyLeads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used - 1 WHERE token = ? AND ai_used > 0', args: [token] });
}

// Emails the lead to us through ahromlabs.com (its /api/demo-lead, shared DEMO_LEAD_KEY). Never blocks or
// fails the visitor's entry: the lead is already saved, so a mail problem is only logged.
async function emailLead(lead) {
  if (!process.env.DEMO_LEAD_KEY) return;
  try {
    const res = await fetch('https://ahromlabs.com/api/demo-lead', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', 'x-demo-key': process.env.DEMO_LEAD_KEY },
      body: JSON.stringify({ demo: 'electronics', name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, about: lead.business }),
    });
    if (!res.ok) console.error('demo lead email failed', res.status);
  } catch (e) { console.error('demo lead email failed', e.message); }
}

const router = express.Router();

router.get('/roles', (req, res) => res.json({ roles: DEMO_ROLES, hasLead: hasLead(req) }));

// The widget asks this on load: hidden when the demo has no AI key, locked when left is 0.
router.get('/ai', async (req, res, next) => {
  try { res.json({ enabled: !!aiKey(), pass: isOwnerPass(req), left: aiKey() ? await aiLeft(req) : 0, limit: AI_QUESTIONS }); } catch (err) { next(err); }
});

// The owner pass (above). The PIN arrives in a POST body (typed, or from the page's #pass=…), never in a URL.
// Wrong tries are counted and capped.
router.post('/pass', async (req, res, next) => {
  try {
    const ip = req.headers['cf-connecting-ip'] || 'unknown';
    if (await passLocked(ip)) return res.status(429).json({ error: 'Too many tries. Try again tomorrow.' });
    const given = req.body?.pass;
    if (!passKey() || typeof given !== 'string' || !same(given, passKey())) { await passFailed(ip); return res.status(403).json({ error: 'That pass is not valid.' }); }
    res.cookie('demo_lead', ownerPassToken(), { ...COOKIE, maxAge: 365 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/lead', async (req, res, next) => {
  try {
    const b = req.body || {};
    const lead = { name: clip(b.name, 120), company: clip(b.company, 160), email: clip(b.email, 160).toLowerCase(), phone: clip(b.phone, 40), business: clip(b.business, 200) };
    if (!lead.name || !lead.company) return res.status(400).json({ error: 'Name and company are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return res.status(400).json({ error: 'Enter a valid email' });
    const db = await readyLeads();
    const token = randomBytes(18).toString('base64url');
    await db.execute({
      sql: 'INSERT INTO demo_leads (name, company, email, phone, business, ip, user_agent, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [lead.name, lead.company, lead.email, lead.phone || null, lead.business || null, req.headers['cf-connecting-ip'] || null, clip(req.headers['user-agent'], 300) || null, token],
    });
    await emailLead(lead);
    res.cookie('demo_lead', token, { ...COOKIE, maxAge: 30 * 24 * 60 * 60 * 1000 });
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

// After login: refuse anything that changes logins or settings, or uploads files. Of the AI, only the chat
// (two questions per visitor, routes/assistant.js) and its read-only starters/briefing are open.
const BLOCKED = ['/api/settings', '/api/gelco-docs/upload', '/api/invoices/upload', '/api/invoices/attachment'];
const AI_OPEN = ['/api/assistant/chat', '/api/assistant/starters', '/api/assistant/briefing'];
function guard(req, res, next) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/api/assistant') && !AI_OPEN.includes(path)) return res.status(403).json({ error: 'Not available in the demo' });
  const hit = BLOCKED.some((p) => path === p || path.startsWith(p + '/'));
  if (hit && write) return res.status(403).json({ error: 'Not available in the demo' });
  if (write && /^\/api\/gelco-docs\/\d+$/.test(path)) return res.status(403).json({ error: 'Not available in the demo' });
  // No R2 bucket in the demo: PO document upload/delete.
  if (write && /^\/api\/orders\/(\d+|docs)\/(docs|\d+)$/.test(path)) return res.status(403).json({ error: 'Not available in the demo' });
  next();
}

module.exports = { DEMO, DEMO_ROLES, AI_QUESTIONS, router, guard, takeAiQuestion, returnAiQuestion, isOwnerPass };
