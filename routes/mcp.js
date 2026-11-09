// /mcp — Ohm AI for Claude, ChatGPT or any MCP client, acting as the admin who connected it (Settings → AI). JSON-RPC over HTTP
// POST answered with plain JSON: initialize, ping, tools/list, tools/call. ponytail: hand-written, no SDK, no SSE streams or
// sessions (the spec lets a server answer every POST with one JSON response); add the SDK if resources or pushes are needed.
// Tools come from the same registries as the chat, so an AI app does exactly what Ohm AI does:
//   ask             — the chat's own brain (utils/assistantChat.js turn): look-ups, how-to, the same answers and limits.
//   propose_action  — one of utils/assistantActions.js's tasks, checked: a preview plus a confirm token (10 minutes, this login only).
//   confirm_action  — runs exactly what was previewed, through the app's own route (utils/actionRunner.js).
// Also the OAuth endpoints an AI app needs before it can sign in (utils/oauth.js). Mounted before the login check in app.js;
// all of it is off in the public demo. Ported from savistar-ops (lib/mcp.js, lib/mcp-tools.js, app/mcp, app/oauth, app/.well-known).
const express = require('express');
const jwt = require('jsonwebtoken');
const O = require('../utils/oauth');
const brand = require('../utils/brand');

const router = express.Router();
const DEMO = process.env.DEMO_MODE === '1';
router.use((req, res, next) => (DEMO ? res.status(404).json({ error: 'Not available in the demo' }) : next()));

const secret = () => process.env.SESSION_SECRET;
const signConfirm = (user, action, values) => jwt.sign({ u: user.username, a: action, v: values }, secret(), { expiresIn: '10m', audience: 'mcp-confirm' });

// A table answer as plain rows (capped), so the AI app reads data, not layout.
function compact(reply) {
  if (!reply) return null;
  if (reply.type === 'table') {
    const cards = [reply, ...(reply.cards || [])].map((c) => ({ lookup: c.toolLabel || c.tool, filters: c.params, summary: c.summary, rows: (c.rows || []).slice(0, 50), total: c.total, note: c.note || undefined }));
    return { kind: 'data', text: reply.text || undefined, results: cards };
  }
  if (reply.type === 'draft' && reply.draft?.kind === 'action') {
    return { kind: 'action_suggested', note: 'This is a change. Call propose_action with this action and these fields, show the preview to the person, then confirm_action.', action: reply.draft.action, fields: reply.draft.values };
  }
  return { kind: reply.type, text: reply.text, title: reply.title, options: reply.options?.map((o) => o.label), link: reply.link?.path };
}

function tools() {
  const { ACTIONS, check } = require('../utils/assistantActions');
  const catalogue = ACTIONS.map((a) => `- ${a.key}: ${a.about} Fields: ${a.fields.map((f) => `${f.name}${f.required ? '*' : ''} (${f.type === 'ref' ? `${f.ref} id or name` : f.type === 'enum' ? f.options.map((o) => o.value).join('|') : f.type === 'units' ? 'reel/box numbers, comma separated' : f.type === 'unit' ? 'REEL-n or BOX-n' : f.type})`).join(', ')}`).join('\n');
  return [
    { name: 'ask', title: `Ask ${brand.ai}`, readOnly: true,
      description: `Ask about ${brand.company}'s electronic-component inventory in plain words, exactly as you would ask the in-app assistant: stock by item and store, reels and boxes, inward, shipments to customers, transfers between stores, customer purchase orders, approvals, tasks, clients, or how to do something in the app. Answers come from fixed read-only look-ups.`,
      inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question, in plain words' } }, required: ['question'] },
      async run({ question }, user) {
        if (!String(question || '').trim()) throw new Error('question is required');
        const out = await require('../utils/assistantChat').turn({ user: user.username, role: user.role, messages: [{ role: 'user', content: String(question).slice(0, 600) }], path: '/' });
        if (out.status !== 200) throw new Error(out.body?.error || `Failed (${out.status})`);
        return compact(out.body.reply);
      } },
    { name: 'propose_action', title: 'Prepare a change',
      description: `Prepare one change for the person to approve. Returns a preview, anything missing, and a confirm_token. Show the preview to the person and only call confirm_action after they agree. Dates are YYYY-MM-DD; a * marks a required field; record fields take an id or a name.\nActions:\n${catalogue}`,
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ACTIONS.map((a) => a.key) }, fields: { type: 'object', description: 'Field values by name' } }, required: ['action', 'fields'] },
      async run({ action, fields }, user) {
        if (!(await require('../utils/assistant').getSettings()).actionsOn) throw new Error('Changes from the assistant are switched off in Settings → AI');
        const c = await check(action, fields || {});
        const preview = Object.fromEntries(c.fields.map((f) => [f.label, f.type === 'ref' ? f.display || f.value : f.value]));
        if (!c.ready) {
          const choices = Object.fromEntries(c.fields.filter((f) => f.options?.length && f.value == null).map((f) => [f.name, f.options]));
          return { ready: false, summary: c.summary, preview, missing: c.missing, errors: c.errors, ...(Object.keys(choices).length ? { choose_from: choices } : {}) };
        }
        return { ready: true, summary: c.summary, preview, risk: c.risk, confirm_token: signConfirm(user, action, c.values), expires_in: '10 minutes' };
      } },
    { name: 'confirm_action', title: 'Make the change', destructive: true,
      description: 'Make a change the person approved: pass the confirm_token from propose_action. Runs through the app exactly as if they did it on screen.',
      inputSchema: { type: 'object', properties: { confirm_token: { type: 'string' } }, required: ['confirm_token'] },
      async run({ confirm_token }, user) {
        let t;
        try { t = jwt.verify(String(confirm_token || ''), secret(), { audience: 'mcp-confirm' }); } catch { throw new Error('That confirm_token is invalid or expired; call propose_action again'); }
        if (t.u !== user.username) throw new Error('That confirm_token belongs to someone else');
        const r = await require('../utils/actionRunner').runAction(user, t.a, t.v);
        if (!r.ok) throw new Error(r.error);
        return { done: true, pending_approval: r.pending || undefined, summary: r.summary, message: r.message || undefined, id: r.result?.id ?? null, open: r.link };
      } },
  ];
}
const INSTRUCTIONS = `${brand.app}, the inventory and CRM app of ${brand.company}, an electronic-component trader (reels, boxes, two stores: ${brand.mainStore} and ${brand.partnerStore}). Use ask for any question (it answers like the in-app assistant). To change anything, call propose_action, show the person the preview, and call confirm_action only after they say yes.`;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

// The JSON-RPC response for one message, or null for a notification (no id, nothing to answer).
async function handle(msg, user) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  if (msg.id === undefined) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': {
      const v = msg.params?.protocolVersion ?? '';
      return ok({ protocolVersion: VERSIONS.includes(v) ? v : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'ohm-ai', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: tools().map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !t.readOnly && !!t.destructive } })) });
    case 'tools/call': {
      const t = tools().find((x) => x.name === msg.params?.name);
      if (!t) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const r = await t.run(msg.params?.arguments ?? {}, user);
        return ok({ content: [{ type: 'text', text: r === undefined ? 'Done.' : typeof r === 'string' ? r : JSON.stringify(brand.deep(r)) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); // the model can read and correct it
      }
    }
    default: return fail(-32601, `Unknown method: ${msg.method}`);
  }
}

router.post('/mcp', async (req, res, next) => {
  try {
    // A web page elsewhere must not drive this (the MCP spec's Origin rule); AI apps send no Origin.
    if (req.headers.origin && req.headers.origin !== O.originOf(req)) return res.status(403).send('Forbidden');
    const user = await O.keyUser(req.headers.authorization);
    // Not signed in: point the AI app at the sign-in, so it can show the person a Connect page.
    if (!user) return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${O.originOf(req)}/.well-known/oauth-protected-resource"`).json({ error: 'Sign in: connect this app from Claude or ChatGPT (an admin login)' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).send('Expected application/json');
    const out = await handle(req.body, user);
    return out ? res.json(out) : res.status(202).end();
  } catch (e) { next(e); }
});
router.get('/mcp', (req, res) => res.status(405).set('Allow', 'POST').send('Method not allowed'));

const cors = (res) => res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'], (req, res) => cors(res).json(O.resourceMetadata(O.originOf(req))));
router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*', '/.well-known/openid-configuration'], (req, res) => cors(res).json(O.authServerMetadata(O.originOf(req))));
router.options(['/oauth/register', '/oauth/token'], (req, res) => cors(res).status(204).end());
// Dynamic client registration: an AI app registers itself before sending someone to sign in.
router.post('/oauth/register', async (req, res) => {
  try { cors(res).status(201).json(await O.registerClient(req.body)); } catch (e) { cors(res).status(400).json({ error: e.code || 'invalid_client_metadata', error_description: e.message }); }
});
// Code → tokens, and refresh. Form encoding (OAuth) or JSON; both parsed by app.js.
router.post('/oauth/token', async (req, res) => {
  try { cors(res).set('Cache-Control', 'no-store').json(await O.exchange(req.body || {})); } catch (e) { cors(res).status(400).json({ error: e.oauth || 'invalid_request', error_description: e.message }); }
});

// ---- signed in (mounted after the login check in app.js) ----
const signedIn = express.Router();
signedIn.use((req, res, next) => (DEMO ? res.status(404).json({ error: 'Not available in the demo' }) : next()));
// The consent page (frontend /oauth/authorize) asks what it is approving: the app's name, or why it can't connect.
signedIn.get('/api/oauth/check', async (req, res) => {
  try {
    const client = await O.checkAuthorize(req.query);
    if (!O.canConnect(req.user)) return res.status(403).json({ error: 'Only admins can connect an AI app. Ask one of them, or sign in with that login.' });
    res.json({ name: client.name, user: req.user.username, app: brand.app });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Allow / Deny on that page: a plain form post (same site only); Allow sends the app a one-time code.
signedIn.post('/api/oauth/approve', async (req, res, next) => {
  try {
    if (req.headers.origin && req.headers.origin !== O.originOf(req)) return res.status(403).send('Forbidden');
    if (!O.canConnect(req.user)) return res.status(403).send('Only admins can connect an AI app');
    const p = req.body || {};
    try { await O.checkAuthorize(p); } catch (e) { return res.status(400).send(e.message); }
    const back = new URL(p.redirect_uri);
    if (p.state) back.searchParams.set('state', p.state);
    if (p.decision !== 'allow') back.searchParams.set('error', 'access_denied');
    else back.searchParams.set('code', await O.createCode({ client_id: p.client_id, username: req.user.username, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge }));
    res.redirect(303, back.href);
  } catch (e) { next(e); }
});
// Settings → AI → "Connect Claude or ChatGPT": this admin's connections (and pasted keys), and disconnect.
signedIn.get('/api/assistant/connections', async (req, res, next) => {
  try {
    if (!O.canConnect(req.user)) return res.status(403).json({ error: 'Not authorized' });
    const { queryAll } = require('../db/schema');
    res.json({ url: `${O.originOf(req)}/mcp`, connections: await queryAll('SELECT id, name, created_at, last_used_at FROM api_keys WHERE username = ? AND revoked = 0 ORDER BY id DESC', [req.user.username]) });
  } catch (e) { next(e); }
});
signedIn.delete('/api/assistant/connections/:id', async (req, res, next) => {
  try {
    if (!O.canConnect(req.user)) return res.status(403).json({ error: 'Not authorized' });
    await require('../db/schema').execute('UPDATE api_keys SET revoked = 1 WHERE id = ? AND username = ?', [Number(req.params.id), req.user.username]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { router, signedIn, handle };
