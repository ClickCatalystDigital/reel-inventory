// Nightly reset of the public LS Inventory demo (electronics-erp.ahromlabs.com): delete the demo database and recreate it as a copy of the
// golden one (Turso "seed from database"). The demo Worker uses a group token, which keeps working
// for the recreated database. Only ever touches DEMO_DB; never the leads database or anything else.

const API = 'https://api.turso.tech/v1';

async function reset(env) {
  const base = `${API}/organizations/${env.TURSO_ORG}/databases`;
  const headers = { authorization: `Bearer ${env.TURSO_API_TOKEN}`, 'content-type': 'application/json' };
  const del = await fetch(`${base}/${env.DEMO_DB}`, { method: 'DELETE', headers });
  if (!del.ok && del.status !== 404) return { ok: false, step: 'delete', status: del.status, body: await del.text() };
  const create = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ name: env.DEMO_DB, group: env.GROUP, seed: { type: 'database', name: env.GOLDEN_DB } }),
  });
  if (!create.ok) return { ok: false, step: 'create', status: create.status, body: await create.text() };
  return { ok: true };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reset(env).then(r => { if (!r.ok) console.error('demo reset failed', JSON.stringify(r)); }));
  },
  // Manual run (testing): POST with x-trigger-key.
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!env.TRIGGER_KEY || req.headers.get('x-trigger-key') !== env.TRIGGER_KEY) return new Response('Unauthorized', { status: 401 });
    const r = await reset(env);
    return Response.json(r, { status: r.ok ? 200 : 502 });
  },
};
