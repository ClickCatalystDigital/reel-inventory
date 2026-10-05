// Shared by app.js (API) and worker.mjs (page gating) so both enforce the same rules.
const jwt = require('jsonwebtoken');

// No fallback value: a missing secret must stop the app, not silently sign tokens with a
// string that's in git history.
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

const sign = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role }, secret(), { expiresIn: '30d' });

// `get` reads a request header by lowercase name — works for Express and Fetch requests.
function userFromHeaders(get) {
  const token = get('authorization')?.replace('Bearer ', '')
    || /(?:^|;\s*)token=([^;]+)/.exec(get('cookie') || '')?.[1];
  if (!token) return null;
  try { return jwt.verify(token, secret()); } catch { return null; }
}

// Restrict certain roles to an allowlist of pages — anything else redirects.
const ROLE_PAGE_ALLOWLIST = {
  client: { pages: ['/stock'], redirectTo: '/stock' },
  gelco_worker: { pages: ['/outward'], redirectTo: '/outward' },
  gelco_manager: { pages: ['/', '/outward', '/gelco-docs', '/stocks'], redirectTo: '/outward' },
};

// `client` is read-only and restricted to /stock, so it may only hit the API paths /stock uses.
const CLIENT_API_ALLOWLIST = ['/api/auth/me', '/api/stores', '/api/dashboard/stock-summary'];

module.exports = { sign, userFromHeaders, ROLE_PAGE_ALLOWLIST, CLIENT_API_ALLOWLIST };
