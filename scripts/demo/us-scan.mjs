// Checks a running demo for anything Indian a North American visitor would see, and (with --snapshot) writes every
// page's visible text to a file so two builds can be diffed (the India-unchanged check). Copied from savistar-ops.
//
//   1. Build and run the demo:  NEXT_PUBLIC_DEMO=1 NEXT_PUBLIC_MARKET=NA npm run build
//                               npx wrangler dev -c wrangler.us.jsonc --port 8792 --var DEMO_PASS:<pin> --var SESSION_SECRET:x --var TURSO_AUTH_TOKEN:<token>
//   2. DB_URL=libsql://… DB_TOKEN=… node scripts/demo/us-scan.mjs --base http://localhost:8792 --pass <pin> [--snapshot out.txt] [--india]
//
// Needs Chrome and puppeteer-core (not a project dependency): PUPPETEER=/path/to/puppeteer-core.js.
// --india skips the deny list (an Indian build is meant to say GST) and the database scan; it only writes the snapshot.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8792'), PASS = arg('pass'), SNAP = arg('snapshot');
const INDIA = process.argv.includes('--india');
if (!PASS || !process.env.DB_URL) throw new Error('--pass and DB_URL are required');
const { createClient } = createRequire(import.meta.url)('@libsql/client/web');
const db = createClient({ url: process.env.DB_URL, authToken: process.env.DB_TOKEN });

// What a North American visitor must never see. Word-bounded and case-sensitive where the word is common in English.
const DENY = [
  /₹/, /\bRs\.?\s?\d/, /\bINR\b/, /\blakhs?\b/i, /\bcrores?\b/i, /\bGSTIN?\b/, /\b[CSI]GST\b/, /\bHSN\b/, /\bSAC\b/, /\bPAN\b/, /\bTDS\b/,
  /\be-?way bill/i, /\bIRN\b/, /\bTally/, /\bIFSC\b/, /\bUPI\b/, /\bNEFT\b/, /\bRTGS\b/, /\+91/, /\bIST\b/, /Kolkata/, /\bPvt\.? Ltd\b/, /\bLLP\b/,
  /Aadhaar/i, /Diwali/i, /\bBill of Entry\b/i, /\bSundry\b/, /\bA\/c\b/,
  /Ahmedabad|Gujarat|Gandhinagar|Mumbai|Pune|Delhi|Maharashtra|Bengaluru|Chennai/,
  /\b\d{1,2},\d{2},\d{3}\b/, // Indian digit grouping: 1,23,456
  /\bWhatsApp\b/, /\bquotation\b/i, /\benquir/i, /\bGelco\b|\bLS Tech/,
];
const hits = [];
const check = (where, text) => {
  if (INDIA) return;
  for (const line of String(text).split('\n')) for (const re of DENY) if (re.test(line)) hits.push(`${where}: [${re.source}] ${line.trim().slice(0, 160)}`);
};

// ---- pages: every page.tsx under frontend/app, outside /login (the demo redirects it) ----
const pages = [];
(function walk(dir, route) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, /^\(.*\)$/.test(f) ? route : `${route}/${f}`);
    else if (f === 'page.tsx' && route !== '/login' && route !== '/demo') pages.push(route || '/');
  }
})(join(process.cwd(), 'frontend/app'), '');

const { default: puppeteer } = await import(process.env.PUPPETEER || 'puppeteer-core');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const snapshot = [];
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
const visible = () => page.evaluate(() => document.body.innerText + '\n' + document.title + '\n' + [...document.querySelectorAll('input[placeholder],textarea[placeholder],[title],[aria-label],meta[name=description]')].map((e) => e.content || e.placeholder || e.title || e.getAttribute('aria-label')).join('\n'));
await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle0' });
let text = await visible();
check('/demo', text); snapshot.push(`=== /demo\n${text}`);
await page.evaluate(async (pass) => fetch('/api/demo/pass', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass }) }), PASS);
const enter = (username) => page.evaluate(async (u) => (await fetch('/api/demo/enter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u }) })).status, username);

const ROLES = ['owner', 'manager', 'store', 'partner_manager', 'partner_worker', 'customer'];
for (const role of ROLES) {
  if ((await enter(role)) !== 200) { hits.push(`enter ${role}: failed`); continue; }
  for (const u of pages) {
    await page.goto(`${BASE}${u}`, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    text = await visible();
    const at = new URL(page.url()).pathname;
    check(`${role} ${u}`, text); snapshot.push(`=== ${role} ${u} -> ${at}\n${text}`);
  }
  // The assistant's starter questions for this role (what a visitor taps first).
  const starters = await page.evaluate(async () => { const r = await fetch('/api/assistant/starters'); return r.ok ? r.text() : ''; });
  check(`${role} starters`, starters); snapshot.push(`=== ${role} starters\n${starters}`);
}

// ---- PDFs, as the owner: every sales invoice, the daily and transfer reports ----
await enter('owner');
const tmp = mkdtempSync(join(tmpdir(), 'us-scan-'));
const invoices = (await db.execute('SELECT invoice_no FROM sales_invoices ORDER BY invoice_date')).rows.map((r) => r.invoice_no);
const pdfs = [...invoices.map((n) => `/api/sales-invoices/${encodeURIComponent(n)}/pdf`), '/api/labels/daily-report', '/api/labels/transfer-report'];
for (const u of pdfs) {
  const b64 = await page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) return null; const a = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); }, u);
  if (!b64) { hits.push(`${u}: could not download`); continue; }
  const f = join(tmp, 'x.pdf'); writeFileSync(f, Buffer.from(b64, 'base64'));
  const t = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  check(u, t); snapshot.push(`=== ${u}\n${t}`);
}

// ---- every text value in the database ----
if (!INDIA) {
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => r.name);
  for (const t of tables) {
    for (const r of (await db.execute(`SELECT * FROM "${t}"`)).rows) {
      // crm_tally_ledgers.parent is the account group routes/finance.js filters on ('Sundry Debtors'); never shown.
      for (const [k, v] of Object.entries(r)) if (typeof v === 'string' && !/^(password|token|.*_hash|file_url|r2_key)$/.test(k) && !(t === 'crm_tally_ledgers' && k === 'parent')) check(`db ${t}.${k}`, v);
    }
  }
}

await browser.close();
if (SNAP) writeFileSync(SNAP, snapshot.join('\n\n'));
console.log(`us-scan: ${pages.length} pages × ${ROLES.length} roles, ${pdfs.length} PDFs, starters${INDIA ? '' : ', database'}${SNAP ? `; snapshot ${SNAP}` : ''}`);
if (hits.length) { console.log(`${hits.length} hit(s):\n${[...new Set(hits)].join('\n')}`); process.exit(1); }
if (!INDIA) console.log('us-scan: nothing Indian found');
process.exit(0);
