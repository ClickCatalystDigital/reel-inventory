// LS AI — one chat turn. Jev decides (kind / look-up / store / period / guide section); code resolves entities
// (items, customers, POs, users, reel/box numbers) and runs a fixed read-only look-up; the answer is a table the UI
// renders as-is (mode "show") or a short writing-model summary on top of it (mode "write").
// Jev only ever CHOOSES between options we give it. It never writes SQL and never supplies a value.
const A = require('./assistant');
const E = require('./assistantEntities');
const { TOOLS, BY_KEY } = require('./assistantTools');
const { GUIDE, SCREEN_LABEL, pickSections } = require('./assistantGuide');
const { istDateString, queryAll, queryOne } = require('../db/schema');

const MAX_Q = 600;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KINDS = {
  data: "Asks for numbers, lists or records from LS TECH's own data: stock, reels, boxes, items, inward, shipments to customers, transfers, purchase orders, approvals, tasks or clients.",
  howto: 'Asks how to do something in the LS TECH app, or where to find a screen or feature.',
  action: "Asks to create, change, delete, approve, reject, send or otherwise act on data (for example 'delete REEL-123', 'approve request 5', 'add a client').",
  smalltalk: 'A greeting, thanks or small talk.',
  offtopic: "Not about LS TECH's inventory, customers, tasks or this app (general knowledge, other companies, coding, jokes).",
  unclear: 'Too vague or incomplete to tell what is wanted.',
};
const PERIODS = { today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_week: 'Last week', this_month: 'This month', last_month: 'Last month', last_30_days: 'The last 30 days', this_year: 'This year', all_time: 'All time, overall, ever', none: 'No period is mentioned' };
const STORES = { all: 'All stores. Also use this whenever no store is literally named', primary: 'LS Tech Stores — only when the question names LS Tech Stores / the main store / the primary store', secondary: 'Gelco Stores — only when the question names Gelco Stores / the secondary store. A CUSTOMER called Gelco Electronics is NOT a store' };

// Jev's answers for a question are remembered for an hour (per Worker instance): asking the same thing again skips the Jev call —
// faster and free — while the data look-up still runs fresh, so numbers are never stale. Best effort: a cold instance just asks Jev.
const JEV_CACHE = new Map();
const JEV_TTL = 3600e3, JEV_MAX = 300;
function cacheGet(k) { const e = JEV_CACHE.get(k); if (e && Date.now() - e.t < JEV_TTL) return e.v; JEV_CACHE.delete(k); return null; }
function cacheSet(k, v) { if (JEV_CACHE.size >= JEV_MAX) JEV_CACHE.delete(JEV_CACHE.keys().next().value); JEV_CACHE.set(k, { t: Date.now(), v }); }

const UNSUPPORTED = {
  none: 'No — what it asks for could be found in stock, shipment, purchase-order, task or client records',
  money: 'Money amounts for SHIPMENTS or stock: selling price, revenue, margin, profit, cost (NOT purchase-order values, which exist)',
  who_did: 'Who personally received, shipped, scanned or entered a particular stock movement, or what a person did all day (stock movements do not record which staff member did them)',
  advice: 'Advice, a recommendation or an opinion, such as "what should I order", "will sales grow", "is this customer reliable" (NOT how long stock will last, NOT customers who stopped ordering)',
};
const UNSUPPORTED_REPLY = {
  money: ["Shipments and stock don't carry prices, so I can't give revenue or cost for them. Purchase-order lines do have unit prices — I can tell you what POs are worth.", ['How much are the confirmed POs worth?', 'What did we ship to Gelco Electronics in September?']],
  who_did: ["The app doesn't record which staff member received or shipped stock. It does record who submitted and who approved or rejected requests, and who made transfers.", ['What did pranav approve this month?', 'Any approvals waiting?']],
  advice: ["I only report what the data shows — I can't give recommendations or forecasts. I can show how long stock will last at the recent shipping rate, and which customers have gone quiet.", ['Which items will run out in 30 days?', 'Which customers stopped ordering?']],
};

const STARTERS = ['How many reels of BLDC CARD do we have?', 'What did we ship to Gelco Electronics in September?', "What's low on stock?", 'Which POs are confirmed but not dispatched?'];

// {key: p} sorted by probability, from a Jev choice answer
function ranked(a) {
  const probs = a?.probabilities || (a?.choice ? { [a.choice]: 1 } : {});
  return Object.entries(probs).map(([key, p]) => ({ key, p: Number(p) || 0 })).sort((x, y) => y.p - x.p);
}
const top = (a) => ranked(a)[0] || { key: null, p: 0 };

// ---- deterministic router used when Jev can't be reached (timeout / 5xx / rate limit) ----
function fallbackRoute(question) {
  const q = question.toLowerCase();
  if (/^\s*(hi|hello|hey|thanks|thank you)\b/.test(q)) return { kind: 'smalltalk' };
  if (/^\s*(please\s+)?(delete|remove|create|add|approve|reject|update|change|cancel|send|edit|undo)\b/.test(q)) return { kind: 'action' };
  const scored = TOOLS.map((t) => ({ t, s: (t.keywords || []).reduce((a, k) => a + (q.includes(k) ? k.split(' ').length : 0), 0) })).sort((a, b) => b.s - a.s);
  if (E.reelBox(question).reel || E.reelBox(question).box) return { kind: 'data', tool: 'trace' };
  if (scored[0].s > 0 && !/^\s*(how (do|can|to)|where (do|can|is the)|what is the (way|process))\b/.test(q)) return { kind: 'data', tool: scored[0].t.key };
  const sec = pickSections(question, 1)[0];
  return sec ? { kind: 'howto', section: sec.key } : { kind: 'unclear' };
}

const text = (t, extra = {}) => ({ type: 'text', text: t, ...extra });
const chips = (list) => list.map((q) => ({ label: q, send: q }));

// choose one candidate with Jev (entity resolution). Returns { pick, ask?, cost }
async function chooseCandidate(key, question, kind, cands, describe) {
  const criteria = {}; cands.forEach((c, i) => { criteria[`c${i}`] = describe(c); }); criteria.none = 'None of these is what the question is about';
  const { answers, cost } = await A.jevDecide(key, { question, candidates_are: kind }, { pick: { type: 'choice', instructions: `Which ${kind} is the question about?`, criteria } });
  const r = top(answers.pick);
  if (r.key === 'none' || !r.key) return { pick: null, cost, p: r.p };
  return { pick: cands[Number(r.key.slice(1))] || null, p: r.p, cost };
}

// follow-up context sent back by the browser (we issued it; still re-validated here, never trusted)
async function resolveContext(c) {
  if (!c || typeof c !== 'object' || !BY_KEY[c.tool]) return null;
  const out = { tool: c.tool, store: ['all', 'primary', 'secondary'].includes(c.store) ? c.store : 'all', period: null };
  const isD = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (c.period && ((c.period.from === null && c.period.to === null) || (isD(c.period.from) && isD(c.period.to))) && typeof c.period.label === 'string') out.period = { from: c.period.from, to: c.period.to, label: c.period.label.slice(0, 60) };
  if (typeof c.itemCode === 'string') { const r = await queryOne("SELECT item_code, description FROM items WHERE item_code = ? AND status != 'Deleted'", [c.itemCode.slice(0, 120)]); if (r) out.item = { code: r.item_code, label: r.description }; }
  if (typeof c.customerKey === 'string') out.customer = (await E.loadCustomerGroups()).find((g) => g.key === c.customerKey) || null;
  if (typeof c.poNumber === 'string') out.po = (await E.poCandidates(c.poNumber.slice(0, 60)))[0] || null;
  if (Array.isArray(c.clientIds) && c.clientIds.length) {
    const ids = c.clientIds.filter((x) => Number.isInteger(x)).slice(0, 20);
    if (ids.length) { const rows = await queryAll(`SELECT c.id, co.name AS company, c.poc_name FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id IN (${ids.map(() => '?').join(',')})`, ids); if (rows.length) out.client = { ids: rows.map((r) => r.id), label: rows[0].company || rows[0].poc_name }; }
  }
  if (Array.isArray(c.users)) { const all = (await queryAll('SELECT username FROM users')).map((u) => u.username); out.users = c.users.filter((u) => all.includes(u)).slice(0, 3); if (!out.users.length) out.users = null; }
  if (typeof c.reel === 'string' && /^REEL-\d{4,6}$/.test(c.reel)) out.reel = c.reel;
  if (typeof c.box === 'string' && /^BOX-\d{3,5}$/.test(c.box)) out.box = c.box;
  return out;
}
const contextOf = (toolKey, ctx) => ({ tool: toolKey, itemCode: ctx.item?.code || null, customerKey: ctx.customer?.key || null, poNumber: ctx.po?.po_number || null, clientIds: ctx.client?.ids || null, users: ctx.users || null, store: ctx.store, period: ctx.period || null, reel: ctx.reel || null, box: ctx.box || null });

function paramsFor(toolKey, tool, ctx) {
  const params = [];
  if (ctx.item) params.push({ label: 'Item', value: ctx.item.code });
  if (ctx.customer) params.push({ label: 'Customer', value: ctx.customer.label });
  if (ctx.po) params.push({ label: 'PO', value: ctx.po.po_number });
  if (ctx.client) params.push({ label: 'Client', value: ctx.client.label });
  if (ctx.users) params.push({ label: 'Person', value: ctx.users.join(', ') });
  if (ctx.reel || ctx.box) params.push({ label: ctx.reel ? 'Reel' : 'Box', value: ctx.reel || ctx.box });
  if (['stock_for_item', 'stock_overview', 'low_stock', 'dead_stock', 'stock_cover', 'inward_history', 'outward_by_customer', 'stock_transfers', 'daily_report'].includes(toolKey)) params.push({ label: 'Store', value: E.STORE_NAME[ctx.store] });
  if (tool.period && ctx.period) params.push({ label: 'Period', value: ctx.period.label });
  return params;
}

// Two periods side by side: rows matched on the first column (+ route for transfers), with the change.
function compareCard(toolKey, tool, a, b, ctx, prev) {
  const numKey = a.columns.find((c) => c.key === 'qty') ? 'qty' : a.columns.find((c) => c.key === 'reels') ? 'reels' : null;
  if (!numKey) return null;
  const first = a.columns[0];
  const keyOf = (r) => `${r[first.key]}|${r.route || ''}`;
  const map = new Map();
  for (const r of a.rows) map.set(keyOf(r), { label: r[first.key], route: r.route, a: Number(r[numKey]) || 0, b: 0 });
  for (const r of b.rows) { const k = keyOf(r); const m = map.get(k) || { label: r[first.key], route: r.route, a: 0, b: 0 }; m.b = Number(r[numKey]) || 0; map.set(k, m); }
  const ta = [...map.values()].reduce((x, r) => x + r.a, 0), tb = [...map.values()].reduce((x, r) => x + r.b, 0);
  const sign = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toLocaleString('en-IN');
  const rows = [...map.values()].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)).slice(0, 25).map((r) => ({ [first.key]: r.route ? `${r.label} · ${r.route}` : r.label, a: r.a, b: r.b, d: sign(r.a - r.b) }));
  const pct = tb ? ` (${ta >= tb ? '+' : '−'}${Math.abs(Math.round(((ta - tb) / tb) * 100))}%)` : '';
  const unit = numKey === 'qty' ? 'pcs' : 'reels';
  return { type: 'table', tool: toolKey, toolLabel: `${tool.label} · comparison`, params: paramsFor(toolKey, tool, ctx).filter((p) => p.label !== 'Period').concat([{ label: 'Compared', value: `${ctx.period.label} vs ${prev.label}` }]),
    title: `${tool.label}: ${ctx.period.label} vs ${prev.label}`, summary: `${ctx.period.label}: ${ta.toLocaleString('en-IN')} ${unit} · ${prev.label}: ${tb.toLocaleString('en-IN')} ${unit} — ${ta === tb ? 'no change' : `${ta > tb ? 'up' : 'down'} ${Math.abs(ta - tb).toLocaleString('en-IN')}${pct}`}.`,
    columns: [{ key: first.key, label: first.label, type: 'text' }, { key: 'a', label: 'Now', type: 'int' }, { key: 'b', label: 'Before', type: 'int' }, { key: 'd', label: 'Change', type: 'int' }], rows, total: map.size, truncated: map.size > 25,
    note: a.note || null, link: a.link };
}

// run one turn. Returns { status, body }.
async function turn({ user, role = 'admin', messages, path, dry, context }) {
  const isAdmin = role === 'admin', isStaff = role === 'user'; // 'user' = ordinary LS Tech employee: own tasks only, no approvals view
  const t0 = Date.now(); let cost = 0; const trace = [];
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return { status: 400, body: { error: 'Ask a question first.' } };
  const question = last.content.trim().slice(0, MAX_Q);
  const previous = msgs.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content?.slice(0, MAX_Q) || null;

  const settings = await A.getSettings();
  const key = await A.getKey().catch(() => null);
  if (!key) return { status: 400, body: isAdmin ? { error: 'No OpenRouter key yet. Add one in Settings → AI.', link: '/settings', linkLabel: 'Open Settings' } : { error: 'LS AI is not set up yet. Ask an admin to add the key in Settings → AI.' } };

  let usage = null;
  if (!dry) {
    usage = await A.useQuestion(settings.cap);
    if (!usage.ok) return { status: 429, body: { error: `LS AI has used today's ${settings.cap} questions. The limit resets at midnight IST.` } };
  } else usage = { used: await A.usedToday(), cap: settings.cap };

  const today = istDateString();
  const done = async (reply, kind, tool, ok = true) => {
    const ms = Date.now() - t0;
    if (!dry) await A.logAsk(user, question, kind, tool, ok, ms, cost).catch(() => {});
    return { status: 200, body: { reply, meta: { used: usage.used, cap: settings.cap, ms, cost: Number(cost.toFixed(6)), ...(dry ? { trace } : {}) } } };
  };
  const upstreamError = (e) => {
    const up = e.upstream || { status: 502, error: e.message };
    return { status: [401, 402, 429].includes(up.status) ? up.status : 502, body: isAdmin ? { error: up.error, link: up.link, linkLabel: up.linkLabel } : { error: [401, 402].includes(up.status) ? 'LS AI is unavailable right now. Please tell an admin.' : up.error } };
  };

  // ---- Jev call 1: what is this, which look-up, which store/period, which guide section ----
  const pool = pickSections(`${question} ${previous || ''}`, 8);
  const toolCriteria = Object.fromEntries(TOOLS.map((t) => [t.key, t.about])); toolCriteria.none = 'None of these look-ups can answer it, or it is not a data question';
  const questions = {
    kind: { type: 'choice', instructions: 'What kind of message is the latest question?', criteria: KINDS },
    tool: { type: 'choice', instructions: "If the latest question asks for LS TECH data, which look-up answers it?", criteria: toolCriteria },
    store: { type: 'choice', instructions: 'Which store is the latest question about?', criteria: STORES },
    period: { type: 'choice', instructions: 'Which time period is the latest question about?', criteria: PERIODS },
  };
  // Complex questions are chains of small decisions Jev is good at: is this a follow-up, does it need a second look-up, is it a comparison.
  if (context) questions.follow_up = { type: 'noul', instructions: "Is the latest question a short follow-up that only makes sense together with the previous question, because it leaves out the subject (for example 'and last month?', 'what about Gelco Stores?', 'same for Sansui', 'and the reels?')?", criteria: { true: 'It leaves out something it expects us to remember from the previous question.', false: 'It is complete on its own.' } };
  const second = { ...toolCriteria, none: 'No second look-up is needed — one look-up answers the whole question' };
  questions.second_tool = { type: 'choice', instructions: "Does the latest question ALSO ask for a second, different look-up besides its main one (for example 'stock AND transfers of BLDC CARD', 'overdue tasks and pending approvals')? If so, which one?", criteria: second };
  questions.compare = { type: 'noul', instructions: "Does the latest question ask to compare two time periods or how something changed between them (for example 'September vs August', 'compared to last month', 'is it up or down')?", criteria: { true: 'It compares two periods or asks about a change over time.', false: 'It asks about a single period or no period.' } };
  questions.unsupported = { type: 'choice', instructions: 'Does the latest question ask for something LS TECH\'s records do not contain?', criteria: UNSUPPORTED };
  if (pool.length) {
    const sc = {}; pool.forEach((g, i) => { sc[`s${i}`] = `${g.label}: ${g.text.slice(0, 160)}`; }); sc.none = 'None of these sections is about what the question asks';
    questions.section = { type: 'choice', instructions: 'Which section of the app guide answers the latest question?', criteria: sc };
  }
  let route = null, jev = null;
  try {
    const d = new Date(`${today}T00:00:00Z`);
    const ck = JSON.stringify([question.toLowerCase(), previous, !!context, today]);
    const hit = cacheGet(ck);
    if (hit) { jev = hit; trace.push('jev: remembered answer (no Jev call)'); }
    else {
      const r = await A.jevDecide(key, { latest_question: question, previous_question: previous, today: `${today} (${DAYS[d.getUTCDay()]})`, screen_the_user_is_on: String(path || '').slice(0, 100) }, questions);
      cost += r.cost; jev = r.answers; cacheSet(ck, jev);
    }
    const k = top(jev.kind), s = top(jev.section);
    // "offtopic" is only trusted at 90%+; a clearly matching guide section turns an awkward question into how-to
    let kind = k.key || 'unclear';
    if (kind === 'offtopic' && k.p < 0.9) kind = s.key && s.key !== 'none' && s.p >= 0.6 ? 'howto' : 'unclear';
    // The kind answer sometimes hesitates ("unclear" ~60%) on short questions like "what's running low?" while the look-up
    // choice is certain; a 90%+ look-up choice means it IS a data question.
    const tp = top(jev.tool);
    if ((kind === 'unclear' || kind === 'smalltalk') && tp.key && tp.key !== 'none' && tp.p >= 0.9 && k.p < 0.9) kind = 'data';
    // Terse messages ("bldc card stock") also get "unclear". If the words clearly name a catalog item and Jev leaned toward a look-up, it is a data question.
    if (kind === 'unclear' && tp.key && tp.key !== 'none' && tp.p >= 0.5) {
      const ic = await E.itemCandidates(question);
      if (ic.length && ic[0].hits >= 1) kind = 'data';
    }
    route = { kind, kindP: k.p, tool: top(jev.tool).key, toolP: top(jev.tool).p, section: s.key && s.key !== 'none' && pool[Number(s.key.slice(1))] ? pool[Number(s.key.slice(1))].key : null, sectionP: s.p };
    trace.push(`jev: kind=${kind} (${Math.round(k.p * 100)}%) tool=${route.tool} (${Math.round(route.toolP * 100)}%) section=${route.section || 'none'} (${Math.round(s.p * 100)}%)`);
  } catch (e) {
    if ([401, 402].includes(e.upstream?.status)) return upstreamError(e);
    const f = fallbackRoute(question);
    route = { kind: f.kind, tool: f.tool || null, toolP: 0, section: f.section || null, sectionP: 0, fallback: true };
    trace.push(`jev unavailable (${e.message}); keyword router: kind=${f.kind} tool=${f.tool || '-'}`);
    jev = null;
  }

  // "what about Gelco Stores?" on its own reads as unclear — but if Jev says it is a follow-up, it is a data question about the previous look-up
  if (context && jev && (jev.follow_up?.noul ?? 0) >= 0.7 && ['unclear', 'smalltalk'].includes(route.kind) && BY_KEY[context.tool]) {
    route.kind = 'data'; if (!route.tool || route.tool === 'none') route.tool = context.tool;
    trace.push(`follow-up rescued a short question -> ${route.tool}`);
  }

  const sectionOf = (k) => GUIDE.find((g) => g.key === k);
  const link = (path) => (path ? { path, label: `Open ${SCREEN_LABEL[path] || path}` } : null);
  const kind = route.kind;

  // Say plainly what the data cannot answer instead of answering a neighbouring question.
  // Jev decides; one phrase is also pinned in code because it is never answerable and Jev wavers near its threshold.
  const un = /\bwho\b[^?]*\b(inwarded|outwarded|scanned|entered|keyed|logged)\b/i.test(question) ? { key: 'who_did', p: 1 } : jev ? top(jev.unsupported) : { key: 'none', p: 0 };
  if (['data', 'unclear'].includes(kind) && un.key && un.key !== 'none' && un.p >= 0.8 && UNSUPPORTED_REPLY[un.key] && route.tool !== 'purchase_orders') {
    trace.push(`unsupported: ${un.key} (${Math.round(un.p * 100)}%)`);
    return done(text(UNSUPPORTED_REPLY[un.key][0], { chips: chips(UNSUPPORTED_REPLY[un.key][1]) }), kind, `unsupported:${un.key}`, false);
  }
  if (kind === 'smalltalk') return done(text("Hi! I can look things up in your LS TECH data — stock, shipments, POs, tasks, clients — and explain how the app works. Try one of these:", { chips: chips(STARTERS) }), kind, null);
  if (kind === 'offtopic') return done(text('I only help with LS TECH: inventory, shipments, purchase orders, tasks, clients and how this app works. Ask me something about those.', { chips: chips(STARTERS) }), kind, null);
  if (kind === 'unclear') return done(text("I'm not sure what you'd like to know. Could you say it with an item, customer or date? For example:", { chips: chips(STARTERS) }), kind, null, false);

  if (kind === 'action') {
    // only suggest a screen when Jev is confident which one — a keyword guess ("delete" -> Catalog) would mislead
    const sec = route.sectionP >= 0.6 ? sectionOf(route.section) : null;
    return done(text("I can only look things up — I can't change, delete or approve anything." + (sec ? ` You can do that from ${sec.label.split(':')[0]}.` : ''), { link: sec ? link(sec.path) : null }), kind, null);
  }

  if (kind === 'howto') {
    const sec = sectionOf(route.section) || pickSections(question, 1)[0];
    if (!sec) return done(text("I couldn't find that in the app guide. Try describing the screen or task, for example “how do I ship reels to a customer?”.", { chips: chips(['How do I ship reels to a customer?', 'How do I transfer stock to Gelco Stores?', 'Where do I approve requests?']) }), kind, null);
    let body = sec.text;
    if (settings.mode === 'write' && route.sectionP >= 0.3) {
      try {
        const w = await A.writeAnswer(key, settings.model, 'You are LS AI, the help assistant inside LS TECH, an electronic-component inventory app. Answer the question using ONLY the GUIDE below. Short numbered steps, plain text, no markdown symbols. Use the guide\'s exact screen names. Never invent screens or buttons.', sec.text, question);
        body = w.text; cost += w.cost; trace.push('writer: how-to');
      } catch (e) { trace.push(`writer failed: ${e.message}`); }
    }
    return done(text(body, { title: sec.label, link: link(sec.path) }), kind, 'howto');
  }

  // ---- data ----
  if (!settings.dataAccess.on) {
    return done(text(isAdmin ? 'Data questions are switched off. You can turn on “Answers about live business data” in Settings → AI after recording the approval.' : 'Data questions are switched off. Ask an admin to turn them on in Settings → AI.', isAdmin ? { link: { path: '/settings', label: 'Open Settings' } } : {}), kind, null);
  }
  let toolKey = route.tool && route.tool !== 'none' ? route.tool : null;
  if (isStaff && toolKey === 'pending_requests') return done(text('Approval requests are visible to managers and admins only.'), kind, toolKey);
  const rb = E.reelBox(question);
  if ((rb.reel || rb.box) && !toolKey) toolKey = 'trace';
  if (!toolKey || !BY_KEY[toolKey]) {
    return done(text(`I couldn't match that to a look-up. I can look up: ${TOOLS.map((t) => t.label.toLowerCase()).join(', ')}.`, { chips: chips(STARTERS) }), kind, null, false);
  }

  // A store filter applies only when the question talks about a store. Jev must not turn a customer name
  // ("Gelco Electronics") into the Gelco Stores warehouse — that once made a shipments question answer "nothing".
  const mentionsStore = /\bstores?\b|\bwarehouse\b|\bsecondary\b|\bprimary\b|\bmain\b/i.test(question);
  const explicitStore = E.parseStore(question) || (mentionsStore && jev && top(jev.store).p >= 0.6 ? top(jev.store).key : null);
  const explicitPeriod = E.parsePeriod(question, today) || (jev && top(jev.period).p >= 0.6 && top(jev.period).key !== 'none' ? E.periodFromPreset(top(jev.period).key, today) : null);

  // Follow-ups ("and last month?", "what about Gelco Stores?") inherit what the question leaves out from the previous answer.
  // The browser sends that back as `context`; resolveContext re-validates every value against the DB.
  const prior = context ? await resolveContext(context).catch(() => null) : null;
  const followUp = !!prior && jev && (jev.follow_up?.noul ?? 0) >= 0.7;
  if (followUp) trace.push(`follow-up of ${prior.tool} (${Math.round(jev.follow_up.noul * 100)}%)`);

  const base = (tk) => {
    const c = { question, today, user, store: explicitStore || (followUp ? prior.store : 'all') };
    // carry over only entities this look-up understands, and only when the question names none of its own (checked below)
    if (BY_KEY[tk].period) c.period = explicitPeriod || (followUp ? prior.period : null);
    return c;
  };

  // Resolves the entities a look-up needs (a look-up may need several: tasks = person + client), runs it, returns
  // { ctx, result } or { reply } when we must stop and ask.
  const lookup = async (tk, { carry }) => {
    const tool = BY_KEY[tk];
    const ctx = base(tk);
    const askWhich = (what, cands, label) => ({ reply: { type: 'ask', text: `Which ${what} do you mean?`, options: cands.slice(0, 4).map((c) => ({ label: label(c), send: `${question} (${label(c)})` })) } });
    const kinds = [].concat(tool.entity || []);
    // names of people are not clients: keep them out of the client match
    const peopleWords = kinds.includes('client') ? (await queryAll('SELECT username FROM users')).map((u) => u.username) : [];
    for (const e of kinds) {
      if (e === 'trace') {
        const r = E.reelBox(question);
        const reel = r.reel || (carry && prior?.reel), box = r.reel ? null : (r.box || (carry && prior?.box));
        if (!reel && !box) return { reply: text('Which reel or box? For example “where is REEL-15600”.') };
        ctx.reel = reel || null; ctx.box = reel ? null : box;
      } else if (e === 'item') {
        const cands = await E.itemCandidates(question);
        const [a, b] = cands;
        const clear = a && (!b || a.score >= 1.6 * b.score);
        if (clear) ctx.item = { code: a.code, label: a.label };
        else if (!a && carry && prior?.item) ctx.item = prior.item;
        else if (tool.required) {
          if (!a) return { reply: text("Which item? Give me the item code or part of its description, for example “BLDC CARD” or “22pF disc cap”.") };
          try {
            const r = await chooseCandidate(key, question, 'item', cands, (c) => `${c.code} — ${c.label}`); cost += r.cost;
            trace.push(`item pick: ${r.pick ? r.pick.code : 'none'} (${Math.round((r.p || 0) * 100)}%)`);
            if (r.pick && r.p >= 0.6) ctx.item = { code: r.pick.code, label: r.pick.label };
            else return askWhich('item', cands, (c) => c.code);
          } catch (err) { return askWhich('item', cands, (c) => c.code); }
        }
      } else if (e === 'customer') {
        const cands = await E.customerCandidates(question);
        if (cands.length === 1) ctx.customer = cands[0];
        else if (cands.length > 1) {
          try {
            const r = await chooseCandidate(key, question, 'customer or company', cands, (c) => `${c.label}${c.internal ? ' — OUR OWN internal Gelco Stores warehouse, not a customer' : ' — a customer'}`); cost += r.cost;
            trace.push(`customer pick: ${r.pick ? r.pick.label : 'none'} (${Math.round((r.p || 0) * 100)}%)`);
            if (r.pick && r.p >= 0.6) ctx.customer = r.pick; else return askWhich('customer', cands, (c) => c.label);
          } catch (err) { return askWhich('customer', cands, (c) => c.label); }
        } else if (carry && prior?.customer) ctx.customer = prior.customer;
      } else if (e === 'client') {
        const cands = await E.clientCandidates(question, peopleWords);
        const [a, b] = cands;
        if (a && (!b || b.score < 0.85 * a.score)) ctx.client = { ids: a.ids, label: a.label };
        else if (a && b) return askWhich('client', cands.filter((x) => x.score >= 0.85 * a.score), (c) => c.label);
        else if (carry && prior?.client) ctx.client = prior.client;
        else if (tool.required) return { reply: text('Which client or company? For example “notes on Rotomotive”.') };
      } else if (e === 'po') {
        const cands = await E.poCandidates(question);
        if (cands.length === 1) ctx.po = cands[0];
        else if (cands.length > 1) return askWhich('PO', cands, (c) => c.po_number);
        else {
          const cust = await E.customerCandidates(question);
          if (cust.length === 1 && !cust[0].internal) ctx.customer = cust[0];
          else if (carry && prior?.po) ctx.po = prior.po;
        }
      } else if (e === 'user') {
        const u = await E.userMentions(question, user);
        if (u.length) ctx.users = u; else if (carry && prior?.users) ctx.users = prior.users;
      }
    }
    // ordinary staff only see their own tasks (same as Home's "Mine"), whoever the question names
    const ownOnly = isStaff && tk === 'tasks';
    if (ownOnly) ctx.users = [user];
    let result;
    try { result = await tool.run(ctx); if (ownOnly) result.note = `Showing your own tasks only. ${result.note || ''}`.trim(); } catch (err) {
      trace.push(`tool error: ${tk}: ${err.message}`);
      return { reply: text('I could not read that data just now. Please try again in a moment.'), failed: true };
    }
    return { ctx, result };
  };

  // ---- main look-up ----
  const main = await lookup(toolKey, { carry: followUp });
  if (main.reply) return done(main.reply, kind, toolKey, !main.failed);
  const tool = BY_KEY[toolKey];
  let { ctx, result } = main;

  // ---- compare two periods: run the same look-up for the period right before, merge the rows ----
  let card = null;
  if (jev && (jev.compare?.noul ?? 0) >= 0.75 && tool.comparable) {
    const cur = ctx.period || E.periodFromPreset('this_month', today);
    const prev = E.previousPeriod(cur, { fullMonth: /\b(last|previous|prior) month\b/i.test(question) });
    if (prev) {
      try {
        const base0 = ctx.period ? result : await tool.run({ ...ctx, period: cur });
        const other = await tool.run({ ...ctx, period: prev });
        card = compareCard(toolKey, tool, base0, other, { ...ctx, period: cur }, prev);
        if (card && !ctx.period) ctx.period = cur;
        trace.push(`compare: ${cur.label} vs ${prev.label} ${card ? 'ok' : 'unsupported'}`);
      } catch (e) { trace.push(`compare failed: ${e.message}`); }
    }
  }

  // ---- grounding check: only when Jev was not sure of the look-up. Sends the look-up and parameters, never rows. ----
  const wantsSecond = jev && top(jev.second_tool).key !== 'none' && top(jev.second_tool).p >= 0.75; // a two-part question is answered by two cards; the single-look-up check would wrongly flag it
  if (!card && !wantsSecond && route.toolP && route.toolP < 0.85 && !route.fallback) {
    try {
      const g = await A.jevDecide(key, { question, look_up: tool.label, what_it_does: tool.about, parameters_used: { store: ctx.store, period: ctx.period?.label || null, item: ctx.item?.code || null, customer: ctx.customer?.label || null }, columns_returned: result.columns.map((c) => c.label), row_count: result.rows.length },
        { fits: { type: 'noul', instructions: 'Does this look-up, with these parameters, answer the question that was asked?', criteria: { true: 'Yes, it answers the question.', false: 'No, it answers a different question or misses an important part of it.' } } });
      cost += g.cost; trace.push(`grounding: ${Math.round((g.answers.fits?.noul || 0) * 100)}%`);
      if ((g.answers.fits?.noul ?? 1) < 0.4) result.note = `This may not answer your question exactly. ${result.note || ''}`.trim();
    } catch (e) { trace.push(`grounding skipped: ${e.message}`); }
  }

  // ---- optional writing-model summary (the rows go to OpenRouter only in this mode) ----
  const shown = card || result;
  let written = null;
  if (settings.mode === 'write' && shown.rows.length) {
    try {
      const w = await A.writeAnswer(key, settings.model,
        "You are LS AI, the assistant inside LS TECH, an electronic-component inventory app. Answer the QUESTION in one to three short sentences using ONLY the DATA. Copy numbers and names exactly. Never estimate or add up numbers that are not shown. Plain text, no markdown symbols. If the DATA does not answer the question, say what it does show.",
        JSON.stringify({ title: shown.title, summary: shown.summary, rows: shown.rows.slice(0, 20) }).slice(0, 6000), question);
      written = w.text; cost += w.cost; trace.push('writer: data');
    } catch (e) { trace.push(`writer failed: ${e.message}`); }
  }

  const params = paramsFor(toolKey, tool, ctx);
  trace.push(`tool: ${toolKey} params=${JSON.stringify(params)}`);
  const reply = card ? { ...card, text: written, context: contextOf(toolKey, ctx) } : { type: 'table', tool: toolKey, toolLabel: tool.label, params, text: written, context: contextOf(toolKey, ctx), ...result };

  // ---- second look-up: "stock AND transfers of X" — run it only when it needs nothing we don't already have ----
  const st = jev ? top(jev.second_tool) : { key: null, p: 0 };
  if (st.key && st.key !== 'none' && st.key !== toolKey && st.p >= 0.75 && BY_KEY[st.key] && !(isStaff && st.key === 'pending_requests')) {
    const t2 = BY_KEY[st.key];
    const kinds2 = [].concat(t2.entity || []);
    const needs = t2.required && ((kinds2.includes('item') && !ctx.item) || (kinds2.includes('customer') && !ctx.customer) || (kinds2.includes('po') && !ctx.po) || (kinds2.includes('client') && !ctx.client) || (kinds2.includes('trace') && !ctx.reel && !ctx.box));
    if (!needs) {
      // reuse what the first look-up resolved (item/customer/PO/people) so the two answers are about the same thing
      try {
        const c2 = { ...ctx }; if (isStaff && st.key === 'tasks') c2.users = [user]; if (!t2.period) delete c2.period; else if (!c2.period) c2.period = explicitPeriod || null;
        const r2 = await t2.run(c2);
        reply.cards = [{ type: 'table', tool: st.key, toolLabel: t2.label, params: paramsFor(st.key, t2, c2), ...r2 }];
        trace.push(`second: ${st.key} (${Math.round(st.p * 100)}%)`);
      } catch (e) { trace.push(`second failed: ${e.message}`); }
    } else trace.push(`second: ${st.key} skipped (needs an entity)`);
  }

  return done(reply, kind, toolKey);
}

module.exports = { turn, STARTERS };
