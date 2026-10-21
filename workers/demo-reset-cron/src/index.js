// Nightly reset of the public LS Inventory demo (electronics-erp.ahromlabs.com). The owner pass works on the golden database directly (the app's
// GOLDEN_TURSO_URL), so golden holds the owner's data. Each night: back golden up to <golden>-prev, move golden's dates
// up to today, then delete the demo database and recreate it as a copy of golden (Turso "seed from database"), which
// wipes every other visitor's changes. If the date shift fails, golden is put back from the backup.
// The demo Worker uses a group token, which keeps working for recreated databases. Only ever touches DEMO_DB, GOLDEN_DB
// and the backup; never the leads database or anything else.

const API = 'https://api.turso.tech/v1';
const DAY = 86400000;
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function reset(env) {
  const base = `${API}/organizations/${env.TURSO_ORG}/databases`;
  const headers = { authorization: `Bearer ${env.TURSO_API_TOKEN}`, 'content-type': 'application/json' };
  // Delete `name` (if there) and recreate it as a copy of `from`.
  const copy = async (name, from) => {
    const del = await fetch(`${base}/${name}`, { method: 'DELETE', headers });
    if (!del.ok && del.status !== 404) throw new Error(`delete ${name}: ${del.status} ${await del.text()}`);
    const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name, group: env.GROUP, seed: { type: 'database', name: from } }) });
    if (!res.ok) throw new Error(`create ${name}: ${res.status} ${await res.text()}`);
  };
  const backup = `${env.GOLDEN_DB}-prev`;
  try { await copy(backup, env.GOLDEN_DB); } catch (e) { return { ok: false, step: 'backup', error: e.message }; }
  let shifted, shiftError;
  try {
    const db = await fetch(`${base}/${env.GOLDEN_DB}`, { headers });
    if (!db.ok) throw new Error(`golden: ${db.status} ${await db.text()}`);
    const { database } = await db.json();
    const tok = await fetch(`${base}/${env.GOLDEN_DB}/auth/tokens?expiration=1h&authorization=full-access`, { method: 'POST', headers });
    if (!tok.ok) throw new Error(`token: ${tok.status} ${await tok.text()}`);
    const { jwt } = await tok.json();
    shifted = await shiftDates(hrana(`https://${database.Hostname}`, jwt), istToday());
  } catch (e) {
    shiftError = e.message;
    try { await copy(env.GOLDEN_DB, backup); } catch (r) { return { ok: false, step: 'restore golden', error: `${shiftError}; ${r.message}` }; }
  }
  try { await copy(env.DEMO_DB, env.GOLDEN_DB); } catch (e) { return { ok: false, step: 'demo', error: e.message, shiftError }; }
  return shiftError ? { ok: false, step: 'shift (golden restored, demo reset)', error: shiftError } : { ok: true, ...shifted };
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
