// One-off: create/migrate tables and seed defaults on the Turso DB in .env (idempotent).
// The Worker never runs this — it would burn the per-request subrequest budget.
require('dotenv').config();
const { initDB } = require('../db/schema');
initDB().then(() => { console.log('DB ready'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
