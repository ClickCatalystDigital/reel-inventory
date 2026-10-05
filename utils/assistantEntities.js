// LS AI — turning words in a question into exact values: stores, periods, items, customers, POs, users, reel/box
// numbers. Everything here is deterministic code; Jev is only asked to choose between candidates found here.
const { queryAll, istDateString } = require('../db/schema');

// ---------- small text helpers ----------
const STOP = new Set(('a an and any are as at be by can could did do does for from get give have how i in is it its list me my of on or our please '
  + 'show tell that the their there these this those to us was we were what when where which who whom why will with would you stock stocks stocked many much '
  + 'reel reels box boxes item items code codes qty quantity quantities pcs pieces available left remaining total number numbers count how-many '
  + 'today yesterday week month year last past next days day weeks months years ago since between during till until still now current currently latest recent '
  + 'shipped shipments shipment shipping sent send outward outwards inward received receive receiving transfer transfers transferred moved move '
  + 'customer customers client clients company po pos order orders purchase tasks task overdue pending open status store stores ls tech').split(/\s+/));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9₹±µ.%/+-]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
const distinctive = (q) => words(q).map((w) => w.replace(/^[.%/+-]+|[.%/+-]+$/g, '')).filter((w) => w && !STOP.has(w) && (w.length >= 2 || /\d/.test(w)));

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// ---------- customers ----------
const COMPANY_NOISE = new Set(['pvt', 'ltd', 'limited', 'private', 'p', 'co', 'company', 'inc', 'llp', 'the']);
// "Gelco Electronics Pvt. Ltd." / "GELCO ELECTRONICS PVT LTD" / "Gelco Electronics P LTD" -> "gelco electronics"
function normalizeCustomer(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !COMPANY_NOISE.has(t)).join(' ');
}
// Internal warehouse rows: Gelco roles ship to "Gelco Stores", which is NOT a customer.
const INTERNAL_KEYS = new Set(['gelco stores']);

// All distinct customer spellings (outwards + CRM companies), grouped by normalised key; near-identical keys
// (typos such as ELCTRONICS) are merged. One query.
async function loadCustomerGroups() {
  const rows = await queryAll(`
    SELECT customer_name AS name, COUNT(*) AS n FROM outwards WHERE customer_name IS NOT NULL AND customer_name != '' GROUP BY customer_name
    UNION ALL SELECT name, 0 FROM crm_companies WHERE name IS NOT NULL AND name != ''`);
  const groups = new Map();
  for (const r of rows) {
    const key = normalizeCustomer(r.name);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, variants: new Set(), counts: new Map(), shipments: 0 }));
    g.variants.add(r.name); g.counts.set(r.name, (g.counts.get(r.name) || 0) + (Number(r.n) || 0)); g.shipments += Number(r.n) || 0;
  }
  const keys = [...groups.keys()].sort((a, b) => groups.get(b).shipments - groups.get(a).shipments);
  for (const k of keys) {
    if (!groups.has(k)) continue;
    for (const k2 of keys) {
      if (k2 === k || !groups.has(k2) || INTERNAL_KEYS.has(k) !== INTERNAL_KEYS.has(k2)) continue;
      // same company: near-identical spelling (typos), or one is just the other's first word ("impax" / "impax industries")
      const typo = k.length >= 8 && k.split(' ')[0] === k2.split(' ')[0] && lev(k, k2) <= 2;
      const firstWord = !k2.includes(' ') && k.split(' ')[0] === k2 && k.split(' ').length > 1;
      if (typo || firstWord) {
        const keep = groups.get(k), gone = groups.get(k2);
        gone.variants.forEach((v) => keep.variants.add(v)); gone.counts.forEach((c, v) => keep.counts.set(v, (keep.counts.get(v) || 0) + c)); keep.shipments += gone.shipments; groups.delete(k2);
      }
    }
  }
  return [...groups.values()].map((g) => ({ key: g.key, label: [...g.variants].sort((a, b) => (g.counts.get(b) || 0) - (g.counts.get(a) || 0) || b.length - a.length)[0], variants: [...g.variants], shipments: g.shipments, internal: INTERNAL_KEYS.has(g.key) }));
}

async function customerCandidates(question) {
  const q = new Set(distinctive(question));
  const stores = /\bstores?\b/i.test(question);
  const scored = [];
  for (const g of await loadCustomerGroups()) {
    const toks = g.key.split(' ');
    const hits = toks.filter((t) => [...q].some((w) => w === t || (w.length >= 4 && t.length >= 3 && (t.startsWith(w) || w.startsWith(t))))).length;
    if (!hits) continue;
    if (g.internal && !stores) continue; // "Gelco Stores" only when the question says "stores"
    scored.push({ ...g, score: hits / toks.length + hits });
  }
  return scored.sort((a, b) => b.score - a.score || b.shipments - a.shipments).slice(0, 6);
}

// ---------- items ----------
async function itemCandidates(question) {
  const toks = distinctive(question);
  if (!toks.length) return [];
  const items = await queryAll("SELECT item_code, description FROM items WHERE status != 'Deleted'");
  const scored = [];
  for (const it of items) {
    const hay = norm(`${it.item_code} ${it.description}`);
    const codeHay = norm(it.item_code);
    let score = 0, hits = 0;
    for (const t of toks) {
      if (hay.includes(t)) { hits++; score += (/\d/.test(t) ? 3 : 1.5) + Math.min(t.length, 8) / 8 + (codeHay.includes(t) ? 1 : 0); }
    }
    if (hits) scored.push({ code: it.item_code, label: it.description, hits, score: score + (hits === toks.length ? 4 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ---------- CRM clients (contacts + their company) ----------
// A question names a client by company or contact ("Sansui", "Rishabh", "Pragnesh"). Tokens are weighted by rarity so a word like
// "electronics" (in many companies) counts for little. Returns one candidate per COMPANY (all of its contacts), best first.
async function clientCandidates(question, skipWords = []) {
  const skip = new Set(skipWords.map((w) => w.toLowerCase()));
  const toks = [...new Set(distinctive(question))].filter((t) => t.length >= 3 && !skip.has(t));
  if (!toks.length) return [];
  const rows = await queryAll('SELECT c.id, c.poc_name, c.company_id, co.name AS company FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id');
  const hay = rows.map((r) => ({ r, w: new Set(normalizeCustomer(`${r.poc_name} ${r.company || ''}`).split(' ').filter(Boolean)) }));
  const N = rows.length || 1;
  const match = (w, t) => w.has(t) || (t.length >= 4 && [...w].some((x) => x.length >= 4 && (x.startsWith(t) || t.startsWith(x))));
  const idf = new Map(toks.map((t) => [t, Math.log(N / (hay.filter((h) => match(h.w, t)).length || N)) + 1]));
  const byCo = new Map();
  for (const h of hay) {
    const score = toks.reduce((a, t) => a + (match(h.w, t) ? idf.get(t) : 0), 0);
    if (!score) continue;
    const key = h.r.company_id ? `c${h.r.company_id}` : `p${h.r.id}`;
    let g = byCo.get(key); if (!g) byCo.set(key, (g = { key, label: h.r.company || h.r.poc_name, ids: [], score: 0, names: [] }));
    g.ids.push(h.r.id); g.names.push(h.r.poc_name); g.score = Math.max(g.score, score);
  }
  return [...byCo.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------- POs / users / reel / box ----------
const alnum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function poCandidates(question) {
  const toks = [...new Set((String(question).match(/[A-Za-z0-9][A-Za-z0-9/_.-]{2,}/g) || []).filter((t) => /\d/.test(t)).map(alnum).filter((t) => t.length >= 3))];
  if (!toks.length) return [];
  const rows = await queryAll(
    `SELECT p.id, p.po_number, p.status, co.name AS company FROM crm_purchase_orders p LEFT JOIN crm_companies co ON co.id = p.company_id
     WHERE ${toks.map(() => "REPLACE(REPLACE(REPLACE(UPPER(p.po_number),'/',''),'-',''),' ','') LIKE ?").join(' OR ')} ORDER BY p.id DESC LIMIT 8`,
    toks.map((t) => `%${t}%`)
  );
  return rows.map((r) => ({ id: r.id, po_number: r.po_number, status: r.status, company: r.company }));
}

async function userMentions(question, me) {
  const users = (await queryAll('SELECT username FROM users')).map((u) => u.username);
  const qw = new Set(words(question));
  const hit = users.filter((u) => qw.has(u.toLowerCase()));
  if (/\b(my|me|mine)\b/i.test(question) && me) hit.push(me);
  return [...new Set(hit)];
}

function reelBox(question) {
  const reel = /\breel[-\s]?(\d{4,6})\b/i.exec(question); const box = /\bbox[-\s]?(\d{3,5})\b/i.exec(question);
  return { reel: reel ? `REEL-${reel[1]}` : null, box: box ? `BOX-${box[1]}` : null };
}

// ---------- store ----------
function parseStore(question) {
  const q = question.toLowerCase();
  if (/\ball (the )?stores?\b|\bboth stores\b|\bacross stores\b/.test(q)) return 'all';
  if (/\bgelco stores?\b|\bsecondary\b/.test(q)) return 'secondary';
  if (/\bls ?tech( stores?)?\b|\bprimary\b|\bmain store\b/.test(q)) return 'primary';
  return null;
}
const STORE_NAME = { all: 'All stores', primary: 'LS Tech Stores', secondary: 'Gelco Stores' };

// ---------- periods (IST, Monday-first weeks) ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d) => d.toISOString().substring(0, 10);
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthRange = (y, m) => ({ from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) });
const fmtD = (s) => { const d = D(s); return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`; };
const monthIdx = (w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());

function parsePeriod(question, today = istDateString()) {
  const q = question.toLowerCase();
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7)) - 1;
  const lab = (from, to, label) => ({ from, to, label: label || (from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`) });
  let m;
  if ((m = q.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|till|until|and)\s*(\d{4}-\d{2}-\d{2})/))) return lab(m[1], m[2]);
  if ((m = q.match(/\b(\d{4}-\d{2}-\d{2})\b/))) return lab(m[1], m[1]);
  const mon = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  if ((m = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${mon}\\w*\\s*(?:(\\d{4}))?\\s*(?:to|-|till|until|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*${mon}\\w*\\s*(?:(\\d{4}))?`)))) {
    const y2 = Number(m[6] || ty), y1 = Number(m[3] || y2);
    return lab(iso(new Date(Date.UTC(y1, monthIdx(m[2]), Number(m[1])))), iso(new Date(Date.UTC(y2, monthIdx(m[5]), Number(m[4])))));
  }
  if ((m = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${mon}\\w*\\s*(?:(\\d{4}))?`)))) {
    const day = iso(new Date(Date.UTC(Number(m[3] || ty), monthIdx(m[2]), Number(m[1])))); return lab(day, day);
  }
  if ((m = q.match(new RegExp(`\\b${mon}\\w*\\s*(?:(\\d{4}))?`)))) {
    const mi = monthIdx(m[1]); const y = m[2] ? Number(m[2]) : (mi > tm ? ty - 1 : ty);
    const r = monthRange(y, mi); return lab(r.from, r.to, `${MONTH_NAMES[mi]} ${y}`);
  }
  if ((m = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s*(day|week|month)s?\b/))) {
    const n = Number(m[1]); const days = m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : n * 30;
    return lab(add(today, -days + 1), today, `Last ${n} ${m[2]}${n > 1 ? 's' : ''}`);
  }
  if (/\btoday\b/.test(q)) return lab(today, today, `Today (${fmtD(today)})`);
  if (/\byesterday\b/.test(q)) { const y = add(today, -1); return lab(y, y, `Yesterday (${fmtD(y)})`); }
  if (/\b(this|current) week\b/.test(q)) { const dow = (D(today).getUTCDay() + 6) % 7; return lab(add(today, -dow), today, 'This week'); }
  if (/\blast week\b/.test(q)) { const dow = (D(today).getUTCDay() + 6) % 7; const s = add(today, -dow - 7); return lab(s, add(s, 6), 'Last week'); }
  if (/\b(this|current) month\b/.test(q)) { const r = monthRange(ty, tm); return lab(r.from, today, 'This month'); }
  if (/\blast month\b/.test(q)) { const r = monthRange(tm === 0 ? ty - 1 : ty, (tm + 11) % 12); return lab(r.from, r.to, 'Last month'); }
  if (/\b(this|current) year\b/.test(q)) return lab(`${ty}-01-01`, today, 'This year');
  if (/\blast year\b/.test(q)) return lab(`${ty - 1}-01-01`, `${ty - 1}-12-31`, 'Last year');
  if (/\ball[- ]time\b|\bever\b|\boverall\b|\bso far\b|\bin total\b/.test(q)) return { from: null, to: null, label: 'All time' };
  return null;
}

// The period right before p: the previous calendar month when p is exactly one month (or month-to-date and fullMonth), month-to-date compares the same days of the month before, else the same number of days just before it.
function previousPeriod(p, { fullMonth = false } = {}) {
  if (!p || !p.from) return null;
  const f = D(p.from), t = D(p.to);
  const isMonth = f.getUTCDate() === 1 && iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0))) === p.to;
  const monthToDate = f.getUTCDate() === 1 && t.getUTCMonth() === f.getUTCMonth() && !isMonth;
  if (isMonth || (monthToDate && fullMonth)) { const y = f.getUTCMonth() === 0 ? f.getUTCFullYear() - 1 : f.getUTCFullYear(), m = (f.getUTCMonth() + 11) % 12; return { ...monthRange(y, m), label: `${MONTH_NAMES[m]} ${y}` }; }
  // month to date (1st .. today): compare the same days of the month before, so both sides are the same length
  if (monthToDate) {
    const y = f.getUTCMonth() === 0 ? f.getUTCFullYear() - 1 : f.getUTCFullYear(), m = (f.getUTCMonth() + 11) % 12;
    const end = Math.min(t.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
    const from = iso(new Date(Date.UTC(y, m, 1))), to = iso(new Date(Date.UTC(y, m, end)));
    return { from, to, label: `${fmtD(from)} – ${fmtD(to)}` };
  }
  const days = Math.round((t - f) / 86400000) + 1;
  const to = add(p.from, -1), from = add(p.from, -days);
  return { from, to, label: `${fmtD(from)} – ${fmtD(to)}` };
}

// Jev's period choice (fallback when the question has no explicit period).
function periodFromPreset(preset, today = istDateString()) {
  const map = { today: 'today', yesterday: 'yesterday', this_week: 'this week', last_week: 'last week', this_month: 'this month', last_month: 'last month', last_30_days: 'last 30 days', this_year: 'this year', all_time: 'all time' };
  return map[preset] ? parsePeriod(map[preset], today) : null;
}

// variant spelling -> group key, for merging aggregated rows
async function customerKeyMap() {
  const m = new Map();
  for (const g of await loadCustomerGroups()) for (const v of g.variants) m.set(v, g);
  return m;
}

module.exports = {
  customerKeyMap, norm, words, distinctive, normalizeCustomer, loadCustomerGroups, customerCandidates, clientCandidates, itemCandidates, poCandidates, userMentions, reelBox,
  parseStore, STORE_NAME, parsePeriod, previousPeriod, periodFromPreset, fmtD, add, STOP,
};
