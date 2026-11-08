// Self-check for "Connect Claude / ChatGPT" (routes/mcp.js, utils/oauth.js), no model calls: discovery, client registration,
// the admin-only consent, PKCE code → tokens, a one-use code, tools/list, propose/confirm through the app's own route,
// refresh and disconnect. It WRITES (a connection, a task), so only against a local scratch copy of the demo golden DB:
//   TURSO_URL=http://127.0.0.1:8089 node scripts/check-mcp.js
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.TURSO_URL || '')) {
  console.error('check-mcp writes: set TURSO_URL to a local scratch copy (http://127.0.0.1:…), never a real database.');
  process.exit(1);
}
process.env.TURSO_AUTH_TOKEN = '';
process.env.SESSION_SECRET ||= 'check-mcp-only';
delete process.env.DEMO_MODE;
const app = require('../app');
const { sign } = require('../utils/auth');
const { initDB } = require('../db/schema');
(async () => {
  await initDB();
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const j = (r) => r.json();
  // discovery
  const unauth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauth.status, 401); assert.match(unauth.headers.get('www-authenticate'), /oauth-protected-resource/);
  const meta = await fetch(`${base}/.well-known/oauth-authorization-server`).then(j); assert.ok(meta.token_endpoint);
  assert.ok((await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then(j)).resource.endsWith('/mcp'));
  // register + consent
  const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) }).then(j);
  const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const p = { client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
  const owner = { id: 1, username: 'owner', role: 'admin' }, mgr = { id: 2, username: 'manager', role: 'manager' };
  const ck = (u) => ({ authorization: `Bearer ${sign(u)}` });
  assert.equal((await fetch(`${base}/api/oauth/check?${new URLSearchParams(p)}`, { headers: ck(mgr) })).status, 403);
  assert.equal((await fetch(`${base}/api/oauth/check?${new URLSearchParams(p)}`, { headers: ck(owner) }).then(j)).name, 'Claude');
  const ap = await fetch(`${base}/api/oauth/approve`, { method: 'POST', redirect: 'manual', headers: { ...ck(owner), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...p, decision: 'allow' }) });
  assert.equal(ap.status, 303);
  const back = new URL(ap.headers.get('location')); assert.equal(back.searchParams.get('state'), 'xyz');
  const tok = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), client_id: reg.client_id, redirect_uri: p.redirect_uri, code_verifier: verifier }) }).then(j);
  assert.ok(tok.access_token, JSON.stringify(tok));
  // code is single-use
  const again = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), client_id: reg.client_id, redirect_uri: p.redirect_uri, code_verifier: verifier }) });
  assert.equal(again.status, 400);
  const rpc = (body, t = tok.access_token) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body) }).then(j);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).result.serverInfo.name, 'ohm-ai');
  const tl = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(tl.result.tools.map((t) => t.name), ['ask', 'propose_action', 'confirm_action']);
  const call = async (name, args) => JSON.parse((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })).result.content[0].text.replace(/^Error: (.*)$/s, '{"error":"$1"}'));
  const prop = await call('propose_action', { action: 'add_task', fields: { title: 'MCP check task', due_date: '2026-12-01', client: 'Orbit' } });
  assert.ok(prop.ready && prop.confirm_token, JSON.stringify(prop));
  const missing = await call('propose_action', { action: 'inward_stock', fields: { item: 'SS34' } });
  assert.deepEqual(missing.missing, ['num_reels']);
  const done = await call('confirm_action', { confirm_token: prop.confirm_token });
  assert.ok(done.done, JSON.stringify(done));
  const bad = await call('confirm_action', { confirm_token: 'nope' }); assert.match(bad.error, /invalid or expired/);
  // refresh rotates, disconnect revokes
  const ref = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }) }).then(j);
  assert.ok(ref.access_token && ref.access_token !== tok.access_token);
  const list = await fetch(`${base}/api/assistant/connections`, { headers: ck(owner) }).then(j);
  const conn = list.connections.find((c) => c.name === 'Claude'); assert.ok(conn && list.url.endsWith('/mcp'));
  await fetch(`${base}/api/assistant/connections/${conn.id}`, { method: 'DELETE', headers: ck(owner) });
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ref.access_token}` }, body: '{}' })).status, 401);
  console.log('mcp flow: discovery, register, consent (admin only), PKCE token, single-use code, tools, propose/confirm, refresh, disconnect — ok');
  srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
