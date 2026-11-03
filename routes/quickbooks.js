// routes/quickbooks.js → /api/quickbooks (North American public demo only; utils/quickbooks.js). Eight endpoints:
//   GET  status | accounts      — card state / the QuickBooks company's active accounts (admin/manager)
//   GET  connect | callback     — Intuit's OAuth 2.0 authorization-code round trip (owner pass only)
//   POST disconnect, PUT account-map {map: {code: qboAccountId|''}} (owner pass only)
//   GET  sync / POST send {kind: 'invoice'|'receipt', id} — send state for the screens / send or retry one record
//        (anyone who can see sales invoices, visitors included: the target is the Intuit sandbox; utils/quickbooks-sync.js)
// Register this exact redirect URI in the Intuit app: https://electronics-erp-us.ahromlabs.com/api/quickbooks/callback
const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { isOwnerPass } = require('../utils/demo');
const { qboConfig, redirectUri, completeConnection, connectionStatus, qboAccounts, saveAccountMap, disconnect } = require('../utils/quickbooks');
const { send, syncState } = require('../utils/quickbooks-sync');
const { STAFF_ROLES } = require('../utils/auth');
const { authorizeUrl, checkState, normalizeAccounts, cleanAccountMap, accountFits, suggestAccountMap, LOCAL_ACCOUNTS, STATE_TTL_MS } = require('../utils/quickbooks-core');

const MANAGE_NOTE = 'Visitors can see the QuickBooks connection but not change it';
const site = (req) => req.get('host');
const back = (res, q) => {
  res.clearCookie('qbo_state', { path: '/api/quickbooks' });
  res.redirect(`/settings?tab=integrations&${new URLSearchParams(q)}`);
};

// The state cookie is signed, because Intuit's redirect back is a cross-site navigation: the browser holds back the
// SameSite=strict login and owner-pass cookies on it, so the callback (mounted before the login check in app.js) trusts
// this cookie instead, which only /connect — owner pass and admin/manager — can hand out.
const sig = (v) => createHmac('sha256', process.env.SESSION_SECRET).update(`qbo-state.${v}`).digest('base64url');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const readState = (req) => {
  const [v, s] = String(req.cookies?.qbo_state || '').split('.');
  try { return s && same(s, sig(v)) ? JSON.parse(Buffer.from(v, 'base64url').toString()) : null; } catch { return null; }
};

// Not configured → 404 (the card says so for status); not admin/manager → 403.
function gate(req, res, next) {
  if (!['admin', 'manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Not authorized' });
  if (!qboConfig() && req.path !== '/status') return res.status(404).json({ error: 'QuickBooks is not set up on this server' });
  next();
}
function owner(req, res, next) {
  if (isOwnerPass(req)) return next();
  if (req.method === 'GET') return back(res, { qbo_error: MANAGE_NOTE });
  res.status(403).json({ error: MANAGE_NOTE });
}

// Same people as routes/sales-invoices.js. Registered before `gate` so non-admin staff reach /sync and /send.
const SALES_ROLES = [...STAFF_ROLES, 'gelco_manager', 'gelco_worker'];
const sales = (req, res, next) => (SALES_ROLES.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Not authorized' }));

router.get('/sync', sales, ah(async (req, res) => {
  res.json(qboConfig() ? await syncState(site(req)) : { invoices: {}, failures: [], unsent: [], sentToday: 0 });
}));
router.post('/send', sales, ah(async (req, res) => {
  if (!qboConfig()) return res.status(404).json({ error: 'QuickBooks is not set up on this server' });
  const { kind, id } = req.body || {};
  if (!['invoice', 'receipt'].includes(kind) || !id) return res.status(400).json({ error: 'Send {kind: "invoice"|"receipt", id}' });
  try { res.json(await send(site(req), kind, String(id))); } catch (err) { res.status(502).json({ error: err.message }); }
}));

router.get('/status', gate, ah(async (req, res) => {
  const cfg = qboConfig();
  if (!cfg) return res.json({ enabled: false });
  const connection = await connectionStatus(site(req)).catch((err) => ({ status: 'error', last_error: err.message }));
  const canManage = isOwnerPass(req);
  res.json({ enabled: true, environment: cfg.environment, canManage, manageNote: canManage ? null : MANAGE_NOTE, connection, localAccounts: LOCAL_ACCOUNTS });
}));

// `fits` and `suggested` come from the shared rules in quickbooks-core.js, so the page needs no copy of them.
router.get('/accounts', gate, ah(async (req, res) => {
  try {
    const accounts = normalizeAccounts(await qboAccounts(site(req)));
    const fits = Object.fromEntries(LOCAL_ACCOUNTS.map((a) => [a.code, accounts.filter((q) => accountFits(a.account_type, q.type)).map((q) => q.id)]));
    res.json({ accounts, fits, suggested: suggestAccountMap(LOCAL_ACCOUNTS, accounts) });
  } catch (err) { res.status(502).json({ error: err.message }); }
}));

router.get('/connect', gate, owner, (req, res) => {
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const v = Buffer.from(JSON.stringify({ state, userId: req.user.username, exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  res.cookie('qbo_state', `${v}.${sig(v)}`, { path: '/api/quickbooks', httpOnly: true, sameSite: 'lax', secure: true, maxAge: STATE_TTL_MS });
  res.redirect(authorizeUrl({ clientId: qboConfig().clientId, redirectUri: redirectUri(site(req)), state }));
});

// No session here (see sig above). The page is handed back as HTML that navigates on, not a 302: a redirect chain that
// began on Intuit's site is still cross-site, so /settings would arrive without the login cookie and bounce to /demo.
router.callback = ah(async (req, res) => {
  const hop = (q) => {
    res.clearCookie('qbo_state', { path: '/api/quickbooks' });
    const to = `/settings?tab=integrations&${new URLSearchParams(q)}`;
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to.replace(/&/g, '&amp;')}"><a href="${to.replace(/&/g, '&amp;')}">Continue</a>`);
  };
  const cfg = qboConfig();
  if (!cfg) return hop({ qbo_error: 'QuickBooks is not set up on this server' });
  const { error, state, code, realmId } = req.query;
  if (error) return hop({ qbo_error: error === 'access_denied' ? 'Connection cancelled in QuickBooks' : String(error) });
  const cookie = readState(req);
  const bad = checkState({ cookie, state, userId: cookie?.userId });
  if (bad) return hop({ qbo_error: bad });
  if (!code || !realmId) return hop({ qbo_error: 'QuickBooks did not send back a company' });
  try { await completeConnection({ site: site(req), code, realmId, user: { username: cookie.userId } }); } catch (err) { return hop({ qbo_error: err.message }); }
  hop({ qbo: 'connected' });
});

router.post('/disconnect', gate, owner, ah(async (req, res) => {
  await disconnect(site(req));
  res.json({ ok: true });
}));

router.put('/account-map', gate, owner, ah(async (req, res) => {
  try {
    const { rows, error } = cleanAccountMap(req.body?.map, LOCAL_ACCOUNTS.map((a) => a.code), normalizeAccounts(await qboAccounts(site(req))).map((a) => a.id));
    if (error) return res.status(400).json({ error });
    res.json({ account_map: await saveAccountMap(site(req), rows) });
  } catch (err) { res.status(502).json({ error: err.message }); }
}));

module.exports = router;
