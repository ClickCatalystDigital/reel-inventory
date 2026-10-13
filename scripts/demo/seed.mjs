// Builds the Acme Components demo data (a made-up trader) in an EMPTY Turso database, which then
// becomes the golden copy the nightly reset restores (workers/demo-reset-cron).
//
//   DB_URL=libsql://ls-demo-golden-pujan.aws-ap-south-1.turso.io DB_TOKEN=... node scripts/demo/seed.mjs
//
// Schema, logins and stores go straight into the DB. Everything with business rules (items, inward
// numbering, transfers, POs, dispatch, staff requests) goes through the app's real API, served
// in-process from app.js, so counters, stock and statuses behave exactly as in real use. Then dates are
// spread over the last 90 days so reports and charts have history. Run scripts/demo/scrub-check.mjs after.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { DB_URL, DB_TOKEN } = process.env;
if (!DB_URL) throw new Error('DB_URL is required (the golden demo database, never the live one)');
if (/ls-inventory-clickcatalyst/.test(DB_URL)) throw new Error('Refusing to seed the live LS Technologies database');

// The app reads these at load time.
process.env.TURSO_URL = DB_URL;
process.env.TURSO_AUTH_TOKEN = DB_TOKEN || '';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
delete process.env.DEMO_MODE; // seed through the normal password login

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { initDB, queryAll, execute, batch } = require('../../db/schema.js');
const app = require('../../app.js');

// --- 1. Schema (production layout, incl. ls_crm's crm_* tables), then this app's own migrations ---
const [existing] = await queryAll("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
if (Number(existing.n) > 0) throw new Error('Database is not empty; seed only a fresh one');
const ddl = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);
await batch(ddl.map((sql) => [sql]));

// --- 2. Logins (before initDB, so it never creates its default accounts) ---
// One random password, never printed: visitors enter through /demo, and the seed logs in with it below.
const PASSWORD = randomBytes(18).toString('base64url');
const hash = bcrypt.hashSync(PASSWORD, 10);
const USERS = [['owner', 'admin'], ['manager', 'manager'], ['store', 'user'], ['partner_manager', 'gelco_manager'], ['partner_worker', 'gelco_worker'], ['customer', 'client']];
await batch(USERS.map(([u, r]) => ['INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [u, hash, r]]));
await initDB();
await batch([
  ["UPDATE stores SET name = 'Main Store' WHERE code = 'primary'"],
  ["UPDATE stores SET name = 'Partner Store' WHERE code = 'secondary'"],
  // System PO numbers (routes/po.js); ls_crm's initDB creates this counter on the live database.
  ["INSERT OR IGNORE INTO counters (name, value) VALUES ('po_sys', 1000)"],
]);

// --- 3. The real API, in-process ---
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const cookies = {};
async function login(username) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${username} failed: ${res.status}`);
  cookies[username] = res.headers.get('set-cookie').split(';')[0];
}
async function api(as, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie: cookies[as] }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${as} ${method} ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
for (const [u] of USERS) await login(u);

// --- 4. Customers (CRM) ---
const CUSTOMERS = [
  ['Brightline Appliances Pvt Ltd', 'Neha Kapoor', 'Purchase Manager', 'customer', 'Home appliances'],
  ['Voltix Motors Ltd', 'Rahul Bansal', 'Supply Chain Head', 'customer', 'EV controllers'],
  ['Northwind Lighting', 'Sana Qureshi', 'Procurement Lead', 'customer', 'LED drivers'],
  ['Orbit Power Systems', 'Imran Shaikh', 'Stores In-charge', 'qualified', 'Inverters and UPS'],
  ['Keystone Meters Pvt Ltd', 'Pooja Iyer', 'Buyer', 'new', 'Energy meters'],
  ['Helios Solar Tech', 'Arvind Rao', 'Purchase Executive', 'lost', 'Solar charge controllers'],
];
const contact = {};
for (const [company_name, poc_name, designation, status, industry] of CUSTOMERS) {
  const r = await api('owner', 'POST', '/api/clients', {
    company_name, poc_name, designation, status, industry, email: `${poc_name.split(' ')[0].toLowerCase()}@${company_name.split(' ')[0].toLowerCase()}.example`,
    phone: '9800000000', note: `Buys ${industry.toLowerCase()} components; prefers monthly call-offs against a yearly PO.`,
    next_touchpoint: day(status === 'new' ? 1 : 3), next_touchpoint_title: status === 'new' ? 'Send line card and price list' : 'Check next month\'s call-off', next_touchpoint_assignee: 'manager',
  });
  contact[company_name] = r.id;
}
const companyId = {};
for (const row of await queryAll('SELECT co.id company_id, co.name FROM crm_contacts c JOIN crm_companies co ON co.id = c.company_id')) companyId[row.name] = Number(row.company_id);
// The customer login belongs to Brightline: it sees only Brightline's items (utils/visibility.js).
const [customerUser] = await queryAll("SELECT id FROM users WHERE username = 'customer'");
await execute('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [customerUser.id, companyId['Brightline Appliances Pvt Ltd']]);

// --- 5. Catalog ---
// [code, description, reel size, category, customers who may see it]
const ITEMS = [
  ['BC857B', 'PNP transistor SOT-23', 3000, 'Transistor', ['Brightline Appliances Pvt Ltd']],
  ['BC847C', 'NPN transistor SOT-23', 3000, 'Transistor', ['Brightline Appliances Pvt Ltd']],
  ['1N4148W', 'Switching diode SOD-123', 3000, 'Diode', []],
  ['SS34', 'Schottky diode 3A 40V SMA', 1800, 'Diode', ['Voltix Motors Ltd']],
  ['CC0603-104K', 'MLCC 100nF 50V X7R 0603', 4000, 'MLCC', ['Brightline Appliances Pvt Ltd']],
  ['CC0805-106K', 'MLCC 10uF 25V X5R 0805', 4000, 'MLCC', []],
  ['RC0603-10K', 'Resistor 10k 1% 0603', 5000, 'RESISTOR', ['Brightline Appliances Pvt Ltd']],
  ['RC1206-0R1', 'Current-sense resistor 0.1R 1206', 5000, 'RESISTOR', ['Voltix Motors Ltd']],
  ['EC-470U35', 'Electrolytic cap 470uF 35V 10x16', 500, 'Electrolytic Capacitor', ['Northwind Lighting']],
  ['TAN-22U16', 'SMD tantalum 22uF 16V case B', 2000, 'SMD Tan Cap', []],
  ['MOV-14D471', 'Varistor 14D471K', 1000, 'MOV', ['Northwind Lighting']],
  ['STM32G030', 'MCU 32-bit ARM Cortex-M0+ TSSOP20', 2500, 'IC', ['Voltix Motors Ltd']],
  ['LM358DR', 'Dual op-amp SOIC-8', 2500, 'IC', []],
  ['PCBA-BLDC-01', 'BLDC fan controller board', 200, 'PCBA', ['Brightline Appliances Pvt Ltd']],
];
for (const [item_code, description, default_spq, category, who] of ITEMS) {
  await api('owner', 'POST', '/api/items', { item_code, description, default_spq, category, company_ids: who.map((n) => companyId[n]) });
}

// --- 6. Stock in (owner inwards are approved at once), some moved to the partner store ---
const reels = {};
const INWARD = [
  ['BC857B', 12, 2], ['BC847C', 10, 2], ['1N4148W', 8, 1], ['SS34', 9, 1], ['CC0603-104K', 15, 3], ['CC0805-106K', 6, 1],
  ['RC0603-10K', 14, 2], ['RC1206-0R1', 5, 0], ['EC-470U35', 10, 2], ['TAN-22U16', 3, 0], ['MOV-14D471', 6, 1],
  ['STM32G030', 8, 2], ['LM358DR', 2, 0], ['PCBA-BLDC-01', 6, 1],
];
for (const [item_code, num_reels, num_boxes] of INWARD) {
  const r = await api('owner', 'POST', '/api/inward', { item_code, num_reels, num_boxes, store_code: 'primary', notes: 'Opening stock' });
  reels[item_code] = r.reels.map((x) => x.reel_number);
}
for (const item of ['BC857B', 'CC0603-104K', 'RC0603-10K', 'EC-470U35']) {
  for (const number of reels[item].splice(-3)) await api('manager', 'POST', '/api/transfer', { kind: 'reel', number, to_store: 'secondary', notes: 'Weekly top-up' });
}

// --- 7. Customer POs: one dispatched, one confirmed, one draft ---
async function po(customer, lines, stage) {
  const p = await api('owner', 'POST', '/api/po', { company_id: companyId[customer], contact_id: contact[customer], order_date: day(-20), expected_dispatch_date: day(10), generate_number: true, notes: 'Monthly call-off' });
  const id = p.id ?? p.po?.id;
  for (const [item_code, quantity_ordered, unit_price] of lines) await api('owner', 'POST', `/api/po/${id}/items`, { item_code, quantity_ordered, unit_price });
  if (stage !== 'draft') await api('owner', 'POST', `/api/po/${id}/confirm`, {});
  return id;
}
const poBright = await po('Brightline Appliances Pvt Ltd', [['BC857B', 9000, 0.42], ['CC0603-104K', 12000, 0.18], ['RC0603-10K', 15000, 0.06]], 'confirmed');
const poVoltix = await po('Voltix Motors Ltd', [['STM32G030', 5000, 38.5], ['SS34', 3600, 1.9]], 'confirmed');
await po('Northwind Lighting', [['EC-470U35', 2000, 6.2], ['MOV-14D471', 2000, 2.4]], 'draft');

// Dispatches against the POs (manager: approved at once).
async function ship(item_code, n, customer, poId, invoice) {
  await api('manager', 'POST', '/api/outward/grouped', { item_code, reel_numbers: reels[item_code].splice(0, n), customer_name: customer, invoice_number: invoice, company_id: companyId[customer], po_id: poId, store_code: 'primary' });
}
await ship('BC857B', 3, 'Brightline Appliances Pvt Ltd', poBright, 'INV-2601');
await ship('CC0603-104K', 3, 'Brightline Appliances Pvt Ltd', poBright, 'INV-2601');
await ship('RC0603-10K', 3, 'Brightline Appliances Pvt Ltd', poBright, 'INV-2601');
await api('owner', 'POST', `/api/po/${poBright}/dispatch`, { dispatch_date: day(-2) });
await ship('STM32G030', 2, 'Voltix Motors Ltd', poVoltix, 'INV-2604');
await ship('1N4148W', 2, 'Orbit Power Systems', null, 'INV-2607');

// --- 8. Work waiting for a manager: store staff requests go to approval ---
await api('store', 'POST', '/api/inward', { item_code: 'LM358DR', num_reels: 4, num_boxes: 0, store_code: 'primary', notes: 'Supplier delivery, awaiting check' });
await api('store', 'POST', '/api/outward/grouped', { item_code: 'SS34', reel_numbers: reels.SS34.splice(0, 2), customer_name: 'Voltix Motors Ltd', invoice_number: 'INV-2609', company_id: companyId['Voltix Motors Ltd'], po_id: poVoltix, store_code: 'primary' });

// --- 9. Spread history (everything above happened "now"): stock came in 30-89 days ago, and moved or
// shipped 1-29 days ago, so every reel arrives before it leaves.
const spread = (table, col, from, span) => execute(`UPDATE ${table} SET ${col} = datetime(${col}, '-' || (abs(random()) % ${span} + ${from}) || ' days') WHERE ${col} IS NOT NULL`);
await spread('reels', 'inward_date', 30, 60);
await spread('outwards', 'outward_date', 1, 29);
await spread('stock_transfers', 'transferred_at', 1, 29);

server.close();
const counts = {};
for (const t of ['users', 'items', 'reels', 'boxes', 'outwards', 'stock_transfers', 'crm_companies', 'crm_purchase_orders', 'crm_tasks', 'requests']) {
  counts[t] = Number((await queryAll(`SELECT COUNT(*) n FROM ${t}`))[0].n);
}
console.log('Acme Components demo data seeded:', counts);
process.exit(0);
