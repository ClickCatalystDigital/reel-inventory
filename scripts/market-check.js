// node scripts/market-check.js — IN by default; MARKET=NA gives $, en-US and Central Time. Runs both in child processes.
const { execFileSync } = require('node:child_process');
const assert = require('node:assert');
const probe = (env) => JSON.parse(execFileSync(process.execPath, ['-e', `const m=require('./utils/market');const d=new Date('2026-07-01T12:00:00Z');console.log(JSON.stringify({l:m.locale(),m:m.money(123456.5),w:m.wallClock(d),p:m.paper}))`], { env: { ...process.env, ...env }, cwd: __dirname + '/..' }));
const IN = probe({ MARKET: '' }), NA = probe({ MARKET: 'NA' });
assert.deepEqual(IN, { l: 'en-IN', m: '₹1,23,456.50', w: '2026-07-01 17:30:00', p: 'A4' });
assert.deepEqual(NA, { l: 'en-US', m: '$123,456.50', w: '2026-07-01 07:00:00', p: 'LETTER' }); // CDT, UTC-5
assert.equal(probe({ MARKET: 'NA' }).w, NA.w);
console.log('market ok');
