// "Connect Claude / ChatGPT": the MCP sign-in (OAuth 2.1 with PKCE and dynamic client registration, as the MCP spec asks).
// An AI app is pointed at <origin>/mcp, finds this server through /.well-known/*, registers itself, sends the person to
// /oauth/authorize (their normal login, then Allow), and swaps the one-time code for tokens at /oauth/token.
// A connection is an api_keys row (the access token's hash, an expiry, a refresh token's hash), so Settings → AI lists and
// disconnects it. Ported from savistar-ops lib/oauth.js. Off in the public demo (routes/mcp.js).
const { createHash, randomBytes } = require('node:crypto');
const { queryOne, execute } = require('../db/schema');

const ACCESS_TTL = 7 * 864e5; // a week; the app refreshes quietly, so a connection stays until disconnected
const CODE_TTL = 5 * 60e3;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const token = (prefix) => `${prefix}_${randomBytes(24).toString('base64url')}`;
// Only the admin role connects AI apps (and sees and disconnects them in Settings → AI).
const canConnect = (user) => user?.role === 'admin';

// The public address, behind Cloudflare too.
function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)/.test(host || '') ? 'http' : 'https');
  return `${String(proto).split(',')[0]}://${host}`;
}

const authServerMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['assistant'],
});
const resourceMetadata = (origin) => ({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['assistant'], bearer_methods_supported: ['header'] });

// Redirect addresses an AI app may register: https anywhere, http only on this machine (local MCP clients).
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)); } catch { return false; } };

async function registerClient(body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (!uris.length || !uris.every(okRedirect)) throw Object.assign(new Error('redirect_uris must be https (or http on localhost)'), { code: 'invalid_redirect_uri' });
  const clientId = token('ohmc');
  const name = String(body.client_name || 'AI app').slice(0, 60);
  await execute('INSERT INTO oauth_clients (client_id, name, redirect_uris) VALUES (?, ?, ?)', [clientId, name, JSON.stringify(uris)]);
  return { client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
}

async function getClient(clientId) {
  const c = await queryOne('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?', [String(clientId || '')]);
  return c ? { ...c, redirect_uris: JSON.parse(c.redirect_uris) } : null;
}

// Checks an /oauth/authorize request; returns the client or throws a message to show the person.
async function checkAuthorize(p) {
  const client = await getClient(p.client_id);
  if (!client) throw new Error('This app is not registered here. Remove the connector in the AI app and add it again.');
  if (!client.redirect_uris.includes(p.redirect_uri)) throw new Error('The app sent an address it did not register.');
  if (p.response_type !== 'code') throw new Error('Unsupported response_type.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') throw new Error('The app must use PKCE (S256).');
  return client;
}

async function createCode({ client_id, username, redirect_uri, code_challenge }) {
  const code = token('ohmg');
  await execute('INSERT INTO oauth_codes (code_hash, client_id, username, redirect_uri, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha(code), client_id, username, redirect_uri, code_challenge, Date.now() + CODE_TTL]);
  return code;
}

async function issue(row) {
  const access = token('ohma'), refresh = token('ohmr');
  const expires = Date.now() + ACCESS_TTL;
  if (row.id) await execute('UPDATE api_keys SET hash = ?, refresh_hash = ?, expires_at = ? WHERE id = ?', [sha(access), sha(refresh), expires, row.id]);
  else await execute('INSERT INTO api_keys (username, name, hash, client_id, expires_at, refresh_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [row.username, row.name, sha(access), row.client_id, expires, sha(refresh)]);
  return { access_token: access, token_type: 'Bearer', expires_in: Math.round(ACCESS_TTL / 1000), refresh_token: refresh, scope: 'assistant' };
}

const fail = (error, description) => Object.assign(new Error(description || error), { oauth: error });

async function exchange(p) {
  if (p.grant_type === 'authorization_code') {
    const c = await queryOne('SELECT * FROM oauth_codes WHERE code_hash = ?', [sha(p.code || '')]);
    if (c) await execute('DELETE FROM oauth_codes WHERE code_hash = ?', [c.code_hash]); // one use only
    if (!c || c.expires_at < Date.now()) throw fail('invalid_grant', 'The code is invalid or expired');
    if (c.client_id !== p.client_id || c.redirect_uri !== p.redirect_uri) throw fail('invalid_grant', 'The code was issued to another app or address');
    if (createHash('sha256').update(String(p.code_verifier || '')).digest('base64url') !== c.challenge) throw fail('invalid_grant', 'PKCE check failed');
    const user = await queryOne('SELECT username, role FROM users WHERE username = ?', [c.username]);
    if (!canConnect(user)) throw fail('invalid_grant', 'That login can no longer connect AI apps');
    const client = await getClient(c.client_id);
    return issue({ username: c.username, client_id: c.client_id, name: client?.name || 'AI app' });
  }
  if (p.grant_type === 'refresh_token') {
    const row = await queryOne('SELECT id, username, client_id, name FROM api_keys WHERE refresh_hash = ? AND revoked = 0', [sha(p.refresh_token || '')]);
    if (!row || (p.client_id && row.client_id !== p.client_id)) throw fail('invalid_grant', 'The refresh token is invalid or the connection was removed');
    return issue(row); // rotates both tokens on the same connection
  }
  throw fail('unsupported_grant_type');
}

// The login behind a Bearer token on /mcp (a connection or a pasted key), or null.
async function keyUser(authorization) {
  const key = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const u = await queryOne(`SELECT u.id, u.username, u.role, k.id AS key_id FROM api_keys k JOIN users u ON u.username = k.username
    WHERE k.hash = ? AND k.revoked = 0 AND (k.expires_at IS NULL OR k.expires_at > ?)`, [sha(key), Date.now()]);
  if (!u || !canConnect(u)) return null;
  execute('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [u.key_id]).catch(() => {});
  return { id: u.id, username: u.username, role: u.role };
}

module.exports = { ACCESS_TTL, sha, canConnect, originOf, authServerMetadata, resourceMetadata, registerClient, getClient, checkAuthorize, createCode, exchange, keyUser };
