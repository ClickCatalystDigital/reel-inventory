// db/schema.js
// Web (fetch-based) libSQL client: the default Node build ships a native module that
// can't run on Cloudflare Workers. It talks to Turso over HTTP, so it can't open a local file.
const { createClient } = require('@libsql/client/web');
const bcrypt = require('bcryptjs');

let db = null;

// Lazy so Worker requests can use it without anything having called initDB() first.
function connect() {
  if (!db) {
    if (!process.env.TURSO_URL) throw new Error('TURSO_URL is not set');
    db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return db;
}

// Schema creation + seeding. Idempotent, but run it by hand (npm run db:init), never per
// Worker request: it fires ~40 queries and Workers cap subrequests per invocation.
async function initDB() {
  db = connect();

  await connect().execute(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    default_spq INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add status column to existing databases that predate this change
  try {
    await connect().execute(`ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }

  await connect().execute(`CREATE TABLE IF NOT EXISTS boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    reel_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    box_number TEXT,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'In Stock',
    inward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS outwards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    quantity_shipped INTEGER NOT NULL,
    outward_type TEXT NOT NULL DEFAULT 'Full',
    outward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 10000
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    reject_reason TEXT,
    payload TEXT NOT NULL
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT,
    box_number TEXT,
    from_store TEXT NOT NULL,
    to_store TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    transferred_by TEXT NOT NULL,
    transferred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed'
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS daily_gate_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_code TEXT NOT NULL,
    gate_date TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_code, gate_date)
  )`);

  await connect().execute(`CREATE TABLE IF NOT EXISTS gelco_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add store_code to existing tables — same best-effort ALTER pattern as items.status
  try {
    await connect().execute(`ALTER TABLE reels ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await connect().execute(`ALTER TABLE boxes ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await connect().execute(`ALTER TABLE outwards ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await connect().execute(`ALTER TABLE gelco_docs ADD COLUMN store_code TEXT NOT NULL DEFAULT 'secondary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  // routes/po.js's outward tie-in — outwards.company_id/po_id are genuinely owned by
  // this app (unlike crm_* below), just missing from this migration list until now.
  try {
    await connect().execute(`ALTER TABLE outwards ADD COLUMN company_id INTEGER`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await connect().execute(`ALTER TABLE outwards ADD COLUMN po_id INTEGER`);
  } catch (e) {
    // Column already exists — safe to ignore
  }

  // routes/po.js reads/writes 5 crm_* tables this app does NOT own — the same Turso
  // database is shared with the sibling `ls_crm` app, which owns and evolves these
  // tables' schema (confirmed by inspecting sqlite_master: crm_contacts/crm_purchase_orders
  // carry ls_crm-specific columns like `severity`/`industry`/`file_url` accumulated via
  // ls_crm's own ALTER TABLE migrations over time). Deliberately NOT creating them here —
  // doing so would make this file a second, drifting source of truth for tables another
  // app owns. Instead: a loud startup warning if they're ever missing, so a PO-feature
  // 500 doesn't have to be debugged from scratch to discover why.
  const CRM_TABLES = ['crm_companies', 'crm_contacts', 'crm_purchase_orders', 'crm_po_items', 'crm_tasks'];
  const crmCheck = await connect().execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${CRM_TABLES.map(() => '?').join(',')})`,
    CRM_TABLES
  );
  const foundCrmTables = new Set(crmCheck.rows.map(r => r.name));
  const missingCrmTables = CRM_TABLES.filter(t => !foundCrmTables.has(t));
  if (missingCrmTables.length) {
    console.warn(
      `⚠️  Missing table(s) required by routes/po.js: ${missingCrmTables.join(', ')}. ` +
      `These are owned by the sibling ls_crm app (same Turso DB), not this repo — ` +
      `PO features will 500 until they exist. See SYSTEM.md §2.`
    );
  }

  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_outwards_date ON outwards(outward_date)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_reels_inward_date ON reels(inward_date)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_reels_store ON reels(store_code)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_boxes_store ON boxes(store_code)`);
  // Lookups that used to scan whole tables on every call (item membership/stock summary per item,
  // outward history per reel, box contents, the 30s pending-requests poll).
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_reels_item_store_status ON reels(item_code, store_code, status)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_reels_box ON reels(box_number)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_outwards_reel ON outwards(reel_number)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)`);
  await connect().execute(`CREATE INDEX IF NOT EXISTS idx_transfers_from_reel ON stock_transfers(from_store, reel_number)`);

  // Seed stores
  const primaryStore = await connect().execute("SELECT code FROM stores WHERE code = 'primary'");
  if (!primaryStore.rows.length) {
    await connect().execute("INSERT INTO stores (code, name) VALUES ('primary', 'LS Tech Stores')");
  }
  const secondaryStore = await connect().execute("SELECT code FROM stores WHERE code = 'secondary'");
  if (!secondaryStore.rows.length) {
    await connect().execute("INSERT INTO stores (code, name) VALUES ('secondary', 'Gelco Stores')");
  }

  // Seed counters
  const reelCounter = await connect().execute("SELECT value FROM counters WHERE name = 'reel'");
  if (!reelCounter.rows.length) {
    await connect().execute("INSERT INTO counters (name, value) VALUES ('reel', 10000)");
  }
  const boxCounter = await connect().execute("SELECT value FROM counters WHERE name = 'box'");
  if (!boxCounter.rows.length) {
    await connect().execute("INSERT INTO counters (name, value) VALUES ('box', 1000)");
  }
  const invoiceCounter = await connect().execute("SELECT value FROM counters WHERE name = 'invoice'");
  if (!invoiceCounter.rows.length) {
    await connect().execute("INSERT INTO counters (name, value) VALUES ('invoice', 9999)");
  }

  // Seed default admin user if no users exist
  const userCount = await connect().execute("SELECT COUNT(*) as count FROM users");
  if (userCount.rows[0].count === 0) {
    await connect().execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
    await connect().execute("INSERT INTO users (username, password, role) VALUES ('pranav', 'lstech123', 'manager')");
    await connect().execute("INSERT INTO users (username, password, role) VALUES ('zakir', 'lstech123', 'user')");
    await connect().execute("INSERT INTO users (username, password, role) VALUES ('sahil', 'lstech123', 'user')");
    // console.log('Default users created: admin/admin123, pranav/lstech123');
  }

  return db;
}

async function queryAll(sql, params = []) {
  const result = await connect().execute({ sql, args: params });
  return result.rows;
}

async function queryOne(sql, params = []) {
  const result = await connect().execute({ sql, args: params });
  return result.rows.length ? result.rows[0] : null;
}

async function execute(sql, params = []) {
  const result = await connect().execute({ sql, args: params });
  return { changes: result.rowsAffected };
}

// Real transaction support — used only where genuine atomicity matters (currently
// just the multi-reel box transfer in utils/inventory.js). Not used elsewhere in
// this codebase, which otherwise relies on sequential best-effort execute() calls;
// keep it that way outside cases that specifically need all-or-nothing guarantees.
// fn receives a (sql, params) => {changes} function bound to the transaction,
// matching execute()'s own calling convention so callers can share helper code
// between transactional and non-transactional paths.
async function withTransaction(fn) {
  const tx = await connect().transaction('write');
  const txExecute = async (sql, params = []) => {
    const result = await tx.execute({ sql, args: params });
    return { changes: result.rowsAffected };
  };
  try {
    const result = await fn(txExecute);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// Reserve `count` consecutive numbers from a counter in ONE query; returns the first one.
// (This used to scan the whole reels/boxes table to "self-heal" the counter for every single
// number — see healCounters, which now only runs if a number actually collides.)
async function reserveNumbers(name, count) {
  const r = await connect().execute({
    sql: 'UPDATE counters SET value = value + ? WHERE name = ? RETURNING value',
    args: [count, name],
  });
  return Number(r.rows[0].value) - count + 1;
}

// Lift the reel/box counters to at least the highest number really in the tables. Full scans, so
// callers only use it after a UNIQUE collision (counter fell behind, e.g. manual DB edits).
async function healCounters() {
  await connect().execute(`
    UPDATE counters SET value = MAX(value, (
      SELECT COALESCE(MAX(CAST(REPLACE(reel_number, 'REEL-', '') AS INTEGER)), 10000) FROM reels
    )) WHERE name = 'reel'
  `);
  await connect().execute(`
    UPDATE counters SET value = MAX(value, (
      SELECT COALESCE(MAX(CAST(REPLACE(box_number, 'BOX-', '') AS INTEGER)), 1000) FROM boxes
    )) WHERE name = 'box'
  `);
}

// Many statements, ONE round trip, all-or-nothing. Each is [sql, args]. Workers allow few
// subrequests per request, and every execute() is one, so loops of queries must go through here.
async function batch(statements) {
  if (!statements.length) return [];
  return connect().batch(statements.map(([sql, args = []]) => ({ sql, args })), 'write');
}

// Gelco outward's invoice number, replacing the timestamp string it used to
// send. No self-heal scan like healCounters — those
// work because reel/box numbers are always PREFIX-<int>, but
// outwards.invoice_number is free text (real customer invoices look like
// "INV-2025-001"), so scanning it for a numeric max would be unreliable.
async function getNextInvoiceNumber() {
  await connect().execute("UPDATE counters SET value = value + 1 WHERE name = 'invoice'");
  const result = await connect().execute("SELECT value FROM counters WHERE name = 'invoice'");
  return String(result.rows[0].value);
}

// Helper for adding new users
async function createUser(username, password, role = 'user') {
  const hash = await bcrypt.hash(password, 10);
  await connect().execute('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
    [username, hash, role]);
}

function nowIST() {
  // Returns current time as IST string for storage
  const now = new Date();
  // IST = UTC + 5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  return ist.toISOString().replace('T', ' ').substring(0, 19);
}

// Returns 'YYYY-MM-DD' for the given moment in IST — never use SQLite's date('now', ...)
// for day-boundary logic, it's UTC-based while every stored timestamp here is naive IST.
function istDateString(d = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + istOffset).toISOString().substring(0, 10);
}

function istDayBounds(dateStr) {
  return { start: `${dateStr} 00:00:00`, end: `${dateStr} 23:59:59` };
}

module.exports = { initDB, queryAll, queryOne, execute, withTransaction, batch, reserveNumbers, healCounters, getNextInvoiceNumber, createUser, nowIST, istDateString, istDayBounds };