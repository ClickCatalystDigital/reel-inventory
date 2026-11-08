// Runs an assistant action (utils/assistantActions.js) through the app's own API, in the same process: the exact request
// the screen would send, dispatched through app.js as the person asking (a Bearer token, read by app.js's login check). So
// every middleware and route check applies as on screen: login, the client/staff guards, the demo guard, role rules,
// approvals for staff, and the owner pass's golden scope (an AsyncLocalStorage the dispatch runs inside of).
const { sign } = require('./auth');
const { check, ACTION_BY_KEY } = require('./assistantActions');
const { logAsk } = require('./assistant');

// A minimal request/response pair for Express. ponytail: only what JSON routes use (no streams, no uploads; actions never
// touch the multer routes). Express swaps the prototypes for its own, so the response methods are own properties.
function dispatch(user, method, path, body) {
  const app = require('../app'); // lazy: app.js requires routes/assistant.js, which requires this file
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${sign(user)}`, 'content-type': 'application/json', host: 'assistant.local' };
    const req = { method, url: path, originalUrl: path, headers, body: body || {}, _body: true, query: {}, params: {},
      connection: { remoteAddress: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' }, on() {}, once() {}, removeListener() {}, emit() {}, unpipe() {}, resume() {} };
    const h = {};
    let status = 200, sent = false;
    const finish = (chunk) => {
      if (sent) return; sent = true;
      const text = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
      resolve({ status: res.statusCode || status, data });
    };
    const res = {
      statusCode: 200, headersSent: false, locals: {},
      setHeader: (k, v) => { h[k.toLowerCase()] = v; }, getHeader: (k) => h[k.toLowerCase()], removeHeader: (k) => { delete h[k.toLowerCase()]; },
      getHeaders: () => ({ ...h }), hasHeader: (k) => k.toLowerCase() in h, writeHead(s) { status = s; this.statusCode = s; return this; },
      write: () => true, end(chunk) { this.headersSent = true; finish(chunk); return this; },
      on() { return this; }, once() { return this; }, emit() { return false; }, removeListener() { return this; },
    };
    app.handle(req, res, (err) => (err ? reject(err) : resolve({ status: 404, data: { error: `No route for ${method} ${path}` } })));
  });
}

// Check the fields again (never trust a card or an MCP client), then run. Returns { ok, status, summary, link, result | error }.
async function runAction(user, key, given) {
  const t0 = Date.now();
  const a = ACTION_BY_KEY[key];
  if (!a) return { ok: false, status: 400, error: `Unknown action: ${key}` };
  const c = await check(key, given);
  if (!c.ready) return { ok: false, status: 400, error: [...c.errors, ...(c.missing.length ? [`Missing: ${c.missing.join(', ')}`] : [])].join('. '), card: c };
  let out;
  try {
    // An action may be several requests (a mixed shipment = one per item, as the Outward page sends it); stop at the first refusal.
    let r;
    for (const { method, path, body } of [].concat(await a.request(c.values, user))) {
      r = await dispatch(user, method, path, body);
      if (r.status >= 400 || r.data?.success === false) break;
    }
    const ok = r.status < 400 && r.data?.success !== false;
    // Staff (role 'user') inward/outward/transfer go for approval: the route answers { pending: true }.
    const pending = !!r.data?.pending;
    out = ok ? { ok: true, status: r.status, summary: c.summary, pending, message: r.data?.message || null, link: a.link?.(r.data, c.values) || null, result: r.data }
      : { ok: false, status: r.status, summary: c.summary, error: r.data?.error || `The app refused it (${r.status})` };
  } catch (e) {
    out = { ok: false, status: 500, summary: c.summary, error: e.message };
  }
  logAsk(user.username, c.summary, 'action', key, out.ok, Date.now() - t0, 0).catch(() => {});
  return out;
}

module.exports = { runAction, dispatch };
