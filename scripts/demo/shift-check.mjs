// Tests the nightly reset's date shift (workers/demo-reset-cron) on a SCRATCH copy of freshly seeded demo data: pretends
// the reset runs DAYS (default 30) days after the seed and checks the data then reads as current. It rewrites dates, so
// never point it at the golden or live demo database.
//   DB_URL=http://127.0.0.1:8080 [DB_TOKEN=...] [DAYS=30] node scripts/demo/shift-check.mjs
import assert from 'node:assert/strict';
import worker from '../../workers/demo-reset-cron/src/index.js';

const { DB_URL, DB_TOKEN = '', DAYS = '30' } = process.env;
if (!DB_URL || /golden|ls-demo-pujan|clickcatalyst/.test(DB_URL)) throw new Error('DB_URL must be a scratch database');
const db = worker.hrana(DB_URL.replace(/^libsql:/, 'https:'), DB_TOKEN);
const one = async (sql) => (await db.read([sql]))[0][0]?.[0];

const seededOn = await one("SELECT value FROM app_settings WHERE key = 'demo_seeded_on'");
const today = new Date(Date.parse(seededOn) + Number(DAYS) * 86400000).toISOString().slice(0, 10);
const before = { from: await one("SELECT value FROM counters WHERE name = 'tally_voucher_sync_from'"), sync: Number(await one("SELECT value FROM counters WHERE name = 'tally_masters_last_sync'")), outward: await one('SELECT MAX(outward_date) FROM outwards') };

console.log(await worker.shiftDates(db, today));
assert.equal(await one("SELECT value FROM app_settings WHERE key = 'demo_seeded_on'"), today);
assert.ok(Number(await one(`SELECT COUNT(*) FROM crm_tasks WHERE assigned_to = 'store' AND status = 'open' AND due_date = '${today}'`)) > 0, "store's task is due today");
assert.ok(Number(await one(`SELECT COUNT(*) FROM daily_gate_approvals WHERE gate_date = '${today}'`)) > 0, "today's gate is approved");
assert.ok((await one('SELECT MAX(outward_date) FROM outwards')) < `${today} 23:59:59`, 'no shipment in the future');
assert.equal((await one('SELECT MAX(outward_date) FROM outwards')).slice(11), before.outward.slice(11), 'time of day kept');
assert.equal(Number(await one("SELECT value FROM counters WHERE name = 'tally_masters_last_sync'")), before.sync + Number(DAYS) * 86400);
assert.equal(Number(await one("SELECT COUNT(*) FROM requests WHERE status = 'pending' AND created_at LIKE '" + today + "%'")), 3, "today's requests");
const from = String(before.from);
assert.equal(Number(await one("SELECT value FROM counters WHERE name = 'tally_voucher_sync_from'")), Number(new Date(Date.parse(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}`) + Number(DAYS) * 86400000).toISOString().slice(0, 10).replace(/-/g, '')));
console.log(`date shift OK: seeded ${seededOn}, reset as of ${today}`);
