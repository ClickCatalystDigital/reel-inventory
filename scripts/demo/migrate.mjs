// Brings the demo databases' schema up to the current code before a demo deploy (npm run deploy:demo):
// a table or column added in db/schema.js initDB() would otherwise never reach the demo, and the nightly
// reset would keep restoring the old golden copy. Golden first, then the live demo DB. initDB() is
// idempotent and creates no logins on a database that has users. (ls_crm's crm_* tables are not
// covered: their schema lives in ls_crm; copy a change there into scripts/demo/schema.sql by hand.)
// Token: TURSO_GROUP_TOKEN (lsdemo group) from the environment or the gitignored .demo-secrets.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const DBS = ['libsql://ls-demo-golden-pujan.aws-ap-south-1.turso.io', 'libsql://ls-demo-pujan.aws-ap-south-1.turso.io'];
if (!process.env.TURSO_GROUP_TOKEN && existsSync('.demo-secrets')) {
  for (const line of readFileSync('.demo-secrets', 'utf8').split('\n')) {
    const m = /^TURSO_GROUP_TOKEN=(.+)$/.exec(line);
    if (m) process.env.TURSO_GROUP_TOKEN = m[1];
  }
}
if (!process.env.TURSO_GROUP_TOKEN) throw new Error('TURSO_GROUP_TOKEN is required (lsdemo group token)');
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_GROUP_TOKEN;

const require = createRequire(import.meta.url);
for (const url of DBS) {
  process.env.TURSO_URL = url;
  // A fresh copy of db/schema.js per database: it keeps one client per process.
  delete require.cache[require.resolve('../../db/schema.js')];
  const { initDB } = require('../../db/schema.js');
  const t = Date.now();
  await initDB();
  console.log(`demo migrate: ${new URL(url).hostname} up to date (${Date.now() - t} ms)`);
}
process.exit(0);
