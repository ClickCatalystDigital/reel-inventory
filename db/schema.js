// db/schema.js
const { createClient } = require('@libsql/client');

let db = null;

async function initDB() {
  // Use Turso if URL is set, otherwise fall back to local SQLite file
  if (process.env.TURSO_URL) {
    db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log('Connected to Turso (cloud)');
  } else {
    db = createClient({ url: 'file:./inventory.db' });
    console.log('Connected to local SQLite');
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    default_spq INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add status column to existing databases that predate this change
  try {
    await db.execute(`ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    reel_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    box_number TEXT,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'In Stock',
    inward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS outwards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    quantity_shipped INTEGER NOT NULL,
    outward_type TEXT NOT NULL DEFAULT 'Full',
    outward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 10000
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS requests (
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

  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS stock_transfers (
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

  await db.execute(`CREATE TABLE IF NOT EXISTS daily_gate_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_code TEXT NOT NULL,
    gate_date TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_code, gate_date)
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS gelco_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add store_code to existing tables — same best-effort ALTER pattern as items.status
  try {
    await db.execute(`ALTER TABLE reels ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await db.execute(`ALTER TABLE boxes ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await db.execute(`ALTER TABLE outwards ADD COLUMN store_code TEXT NOT NULL DEFAULT 'primary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await db.execute(`ALTER TABLE gelco_docs ADD COLUMN store_code TEXT NOT NULL DEFAULT 'secondary'`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  // routes/po.js's outward tie-in — outwards.company_id/po_id are genuinely owned by
  // this app (unlike crm_* below), just missing from this migration list until now.
  try {
    await db.execute(`ALTER TABLE outwards ADD COLUMN company_id INTEGER`);
  } catch (e) {
    // Column already exists — safe to ignore
  }
  try {
    await db.execute(`ALTER TABLE outwards ADD COLUMN po_id INTEGER`);
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
  const crmCheck = await db.execute(
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

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_outwards_date ON outwards(outward_date)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reels_inward_date ON reels(inward_date)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reels_store ON reels(store_code)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_boxes_store ON boxes(store_code)`);

  // Seed stores
  const primaryStore = await db.execute("SELECT code FROM stores WHERE code = 'primary'");
  if (!primaryStore.rows.length) {
    await db.execute("INSERT INTO stores (code, name) VALUES ('primary', 'LS Tech Stores')");
  }
  const secondaryStore = await db.execute("SELECT code FROM stores WHERE code = 'secondary'");
  if (!secondaryStore.rows.length) {
    await db.execute("INSERT INTO stores (code, name) VALUES ('secondary', 'Gelco Stores')");
  }

  // Seed counters
  const reelCounter = await db.execute("SELECT value FROM counters WHERE name = 'reel'");
  if (!reelCounter.rows.length) {
    await db.execute("INSERT INTO counters (name, value) VALUES ('reel', 10000)");
  }
  const boxCounter = await db.execute("SELECT value FROM counters WHERE name = 'box'");
  if (!boxCounter.rows.length) {
    await db.execute("INSERT INTO counters (name, value) VALUES ('box', 1000)");
  }

  // Seed default admin user if no users exist
  const userCount = await db.execute("SELECT COUNT(*) as count FROM users");
  if (userCount.rows[0].count === 0) {
    await db.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
    await db.execute("INSERT INTO users (username, password, role) VALUES ('pranav', 'lstech123', 'manager')");
    await db.execute("INSERT INTO users (username, password, role) VALUES ('zakir', 'lstech123', 'user')");
    await db.execute("INSERT INTO users (username, password, role) VALUES ('sahil', 'lstech123', 'user')");
    // console.log('Default users created: admin/admin123, pranav/lstech123');
  }

  return db;
}

async function queryAll(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows;
}

async function queryOne(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows.length ? result.rows[0] : null;
}

async function execute(sql, params = []) {
  const result = await db.execute({ sql, args: params });
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
  const tx = await db.transaction('write');
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

async function getNextReelNumber() {
  // Auto-heal: ensure counter is always ahead of actual max
  await db.execute(`
    UPDATE counters SET value = MAX(value, (
      SELECT COALESCE(MAX(CAST(REPLACE(reel_number, 'REEL-', '') AS INTEGER)), 10000)
      FROM reels
    )) WHERE name = 'reel'
  `);
  await db.execute("UPDATE counters SET value = value + 1 WHERE name = 'reel'");
  const result = await db.execute("SELECT value FROM counters WHERE name = 'reel'");
  return `REEL-${result.rows[0].value}`;
}

async function getNextBoxNumber() {
  await db.execute(`
    UPDATE counters SET value = MAX(value, (
      SELECT COALESCE(MAX(CAST(REPLACE(box_number, 'BOX-', '') AS INTEGER)), 1000)
      FROM boxes
    )) WHERE name = 'box'
  `);
  await db.execute("UPDATE counters SET value = value + 1 WHERE name = 'box'");
  const result = await db.execute("SELECT value FROM counters WHERE name = 'box'");
  return `BOX-${result.rows[0].value}`;
}

// Helper for adding new users
async function createUser(username, password, role = 'user') {
  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash(password, 10);
  await db.execute('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
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

module.exports = { initDB, queryAll, queryOne, execute, withTransaction, getNextReelNumber, getNextBoxNumber, createUser, nowIST, istDateString, istDayBounds };