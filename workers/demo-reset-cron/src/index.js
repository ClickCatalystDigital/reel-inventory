// Nightly reset of the public LS Inventory demo (electronics-erp.ahromlabs.com): delete the demo database and recreate it as a copy of the
// golden one (Turso "seed from database"), then move its dates up to today. The demo Worker uses a group token, which keeps working
// for the recreated database. Only ever touches DEMO_DB; never the leads database or anything else.

const API = 'https://api.turso.tech/v1';
const DAY = 86400000;
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

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
  const { database } = await create.json();
  // A short-lived token for this database alone, to run the date shift over libsql's HTTP API.
  const tok = await fetch(`${base}/${env.DEMO_DB}/auth/tokens?expiration=1h&authorization=full-access`, { method: 'POST', headers });
  if (!tok.ok) return { ok: false, step: 'token', status: tok.status, body: await tok.text() };
  const { jwt } = await tok.json();
  try {
    return { ok: true, ...(await shiftDates(hrana(`https://${database.Hostname}`, jwt), istToday())) };
  } catch (e) {
    return { ok: false, step: 'shift', error: e.message };
  }
}

// libsql's HTTP API (Hrana, /v2/pipeline). read(sqls) → rows per statement. write(sqls) runs them as one transaction:
// each step only if the one before succeeded, and a ROLLBACK if anything failed, so a shift is all or nothing.
// The database was only just created, so a call retries for a little while.
function hrana(url, token) {
  const post = async (requests) => {
    const body = JSON.stringify({ requests: [...requests, { type: 'close' }] });
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${url}/v2/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
      if (res.ok) {
        const { results } = await res.json();
        const err = results.find((r) => r.type === 'error');
        if (err) throw new Error(err.error.message);
        return results.slice(0, requests.length).map((r) => r.response.result);
      }
      if (attempt >= 6) throw new Error(`pipeline ${res.status}: ${await res.text()}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  const stmt = (s) => (typeof s === 'string' ? { sql: s } : s);
  return {
    read: async (sqls) => (await post(sqls.map((s) => ({ type: 'execute', stmt: stmt(s) })))).map((r) => r.rows.map((row) => row.map((c) => c.value))),
    write: async (sqls) => {
      const all = ['BEGIN', ...sqls, 'COMMIT'];
      const steps = all.map((s, i) => ({ stmt: stmt(s), ...(i ? { condition: { type: 'ok', step: i - 1 } } : {}) }));
      steps.push({ stmt: { sql: 'ROLLBACK' }, condition: { type: 'not', cond: { type: 'ok', step: all.length - 1 } } });
      const [{ step_errors }] = await post([{ type: 'batch', batch: { steps } }]);
      const err = step_errors.find(Boolean);
      if (err) throw new Error(err.message);
    },
  };
}

// The golden copy was seeded on app_settings.demo_seeded_on. Move every date in it forward by the days since, so "today",
// "overdue" and "this week" read as they did on seed day. Any text value starting YYYY-MM-DD shifts and keeps its time part;
// dates inside JSON or free text, and FY-coded numbers, do not. The Tally sync counters are numbers: epoch seconds and YYYYMMDD.
// Two passes ('~' prefix, then strip it), because a one-pass shift can briefly collide in a UNIQUE date column.
// Then today's partner-store gate approval, so the partner worker isn't walled until someone approves.
async function shiftDates(db, today) {
  const [[[seededOn]], cols] = await db.read([
    "SELECT value FROM app_settings WHERE key = 'demo_seeded_on'",
    "SELECT m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '\\_%' ESCAPE '\\'",
  ]);
  const days = seededOn ? Math.round((Date.parse(today) - Date.parse(seededOn)) / DAY) : 0;
  const stmts = [];
  if (days > 0) {
    const q = (s) => `"${s.replace(/"/g, '""')}"`;
    for (const [t, c] of cols) {
      stmts.push(`UPDATE ${q(t)} SET ${q(c)} = '~' || date(substr(${q(c)}, 1, 10), '+${days} days') || substr(${q(c)}, 11)
        WHERE typeof(${q(c)}) = 'text' AND ${q(c)} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND date(substr(${q(c)}, 1, 10)) IS NOT NULL`);
      stmts.push(`UPDATE ${q(t)} SET ${q(c)} = substr(${q(c)}, 2) WHERE typeof(${q(c)}) = 'text' AND ${q(c)} GLOB '~[0-9][0-9][0-9][0-9]-*'`);
    }
    stmts.push(`UPDATE counters SET value = value + ${days * 86400} WHERE name = 'tally_masters_last_sync'`);
    stmts.push(`UPDATE counters SET value = CAST(strftime('%Y%m%d', substr(value, 1, 4) || '-' || substr(value, 5, 2) || '-' || substr(value, 7, 2), '+${days} days') AS INTEGER)
      WHERE name = 'tally_voucher_sync_from' AND length(value) = 8`);
  }
  stmts.push({ sql: "INSERT OR IGNORE INTO daily_gate_approvals (store_code, gate_date, approved_by, approved_at) VALUES ('secondary', ?, 'partner_manager', ?)",
    args: [{ type: 'text', value: today }, { type: 'text', value: `${today} 09:10:00` }] });
  await db.write(stmts);
  return { seededOn, today, days };
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
  // scripts/demo/shift-check.mjs runs the shift against a scratch database with these.
  shiftDates, hrana,
};
