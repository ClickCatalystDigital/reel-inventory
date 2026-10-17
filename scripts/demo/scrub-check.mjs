// Fails if the public demo would show LS Technologies, its partner store, staff or customers, in any of:
//   1. the demo database (every text column) — when DB_URL is given;
//   2. the built frontend (frontend/out, built with NEXT_PUBLIC_DEMO=1, as `npm run deploy:demo` does);
//   3. the server's own wording in demo mode (brand names, the AI assistant's guide, tools, starters, store names).
// Run before publishing a golden database or deploying the demo:
//   NEXT_PUBLIC_DEMO=1 npm --prefix frontend run build
//   DB_URL=... DB_TOKEN=... node scripts/demo/scrub-check.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DENY = ['gelco', 'ls tech', 'lstech', 'l s tech', 'lstechnologies', 'impax', 'pranav', 'zakir', 'sahil', 'rotomotive', 'sansui', 'micro'];
// Internal codes the screens never print as words: role codes (shown as "Partner store manager/worker", frontend/lib/brand.ts),
// the /gelco-docs route and its API, and the guide's section key.
const CODES = /gelco_(manager|worker|docs|gate|docs_roles|stocks_roles)|gelco-docs|isgelco|gelco_roles/gi;
let hits = 0;
const hit = (where, w, ex) => { hits++; console.log(`${where} ~ "${w}": ${ex}`); };

// 1. Database. users.role holds the role codes and gelco_docs.file_url the route, so those columns are skipped.
if (process.env.DB_URL) {
  const { createClient } = await import('@libsql/client/web');
  const SKIP = new Set(['users.role', 'gelco_docs.file_url']);
  const db = createClient({ url: process.env.DB_URL, authToken: process.env.DB_TOKEN });
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => r.name);
  for (const t of tables) {
    const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.filter((c) => /TEXT|CHAR|DATE|^$/i.test(c.type)).map((c) => c.name);
    for (const c of cols) {
      if (SKIP.has(`${t}.${c}`)) continue;
      for (const w of DENY) {
        const r = await db.execute({ sql: `SELECT COUNT(*) n, MIN(substr("${c}",1,80)) ex FROM "${t}" WHERE "${c}" LIKE ?`, args: [`%${w}%`] });
        if (Number(r.rows[0].n)) hit(`db ${t}.${c} (${r.rows[0].n})`, w, r.rows[0].ex);
      }
    }
  }
  console.log(`db: ${tables.length} tables scanned`);
} else console.log('db: skipped (no DB_URL)');

// Whole words, so "micro" doesn't match "microtask" in a library bundle.
const re = new RegExp(`(?<![a-z])(${DENY.map((w) => w.replace(/ /g, '\\s')).join('|')})(?![a-z])`, 'gi');
function scan(where, s) {
  const t = s.replace(CODES, '');
  for (const m of t.matchAll(re)) hit(where, m[1], JSON.stringify(t.slice(Math.max(0, m.index - 50), m.index + 40)));
}

// 2. Built frontend.
const OUT = new URL('../../frontend/out/', import.meta.url).pathname;
if (!existsSync(OUT)) throw new Error('frontend/out is missing: build it with NEXT_PUBLIC_DEMO=1 first');
let files = 0;
for (const f of readdirSync(OUT, { recursive: true })) {
  if (!/\.(html|js|txt|json|css)$/.test(f)) continue;
  if (f === 'ls-tech-guide.html') continue; // the staff guide: worker.mjs answers 404 for it in the demo
  files++;
  scan(`ui ${f}`, readFileSync(join(OUT, f), 'utf8'));
}
console.log(`ui: ${files} files scanned`);

// 3. Server wording, loaded the way the demo Worker runs it.
process.env.DEMO_MODE = '1';
const require = createRequire(import.meta.url);
const strings = (v, seen = new Set()) => {
  if (typeof v === 'string') return [v];
  if (!v || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  return Object.values(v).flatMap((x) => strings(x, seen));
};
for (const m of ['utils/brand', 'utils/assistantGuide', 'utils/assistantTools', 'utils/assistantChat', 'utils/assistantEntities', 'utils/invoiceParties', 'utils/demo']) {
  const mod = require(`../../${m}.js`);
  // STOP is a word list for matching questions, never shown.
  const { STOP, ...shown } = mod;
  scan(`server ${m}`, strings(shown).join('\n'));
}
console.log('server: demo wording scanned');

console.log(`${hits} hit(s)`);
process.exit(hits ? 1 : 0);
