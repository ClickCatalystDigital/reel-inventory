// LS AI — one chat turn. Jev decides (kind / look-up / store / period / guide section); code resolves entities
// (items, customers, POs, users, reel/box numbers) and runs a fixed read-only look-up; the answer is a table the UI
// renders as-is (mode "show") or a short writing-model summary on top of it (mode "write").
// Jev only ever CHOOSES between options we give it. It never writes SQL and never supplies a value.
const A = require('./assistant');
const E = require('./assistantEntities');
const { TOOLS, BY_KEY } = require('./assistantTools');
const { GUIDE, SCREEN_LABEL, pickSections } = require('./assistantGuide');
const { istDateString } = require('../db/schema');

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

// run one turn. Returns { status, body }.
async function turn({ user, messages, path, dry }) {
  const t0 = Date.now(); let cost = 0; const trace = [];
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return { status: 400, body: { error: 'Ask a question first.' } };
  const question = last.content.trim().slice(0, MAX_Q);
  const previous = msgs.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content?.slice(0, MAX_Q) || null;

  const settings = await A.getSettings();
  const key = await A.getKey().catch(() => null);
  if (!key) return { status: 400, body: { error: 'No OpenRouter key yet. Add one in Settings → LS AI.', link: '/settings', linkLabel: 'Open Settings' } };

  let usage = null;
  if (!dry) {
    usage = await A.useQuestion(settings.cap);
    if (!usage.ok) return { status: 429, body: { error: `You have used today's ${settings.cap} questions. The limit resets at midnight IST.` } };
  } else usage = { used: await A.usedToday(), cap: settings.cap };

  const today = istDateString();
  const done = async (reply, kind, tool, ok = true) => {
    const ms = Date.now() - t0;
    if (!dry) await A.logAsk(user, question, kind, tool, ok, ms, cost).catch(() => {});
    return { status: 200, body: { reply, meta: { used: usage.used, cap: settings.cap, ms, cost: Number(cost.toFixed(6)), ...(dry ? { trace } : {}) } } };
  };
  const upstreamError = (e) => {
    const up = e.upstream || { status: 502, error: e.message };
    return { status: [401, 402, 429].includes(up.status) ? up.status : 502, body: { error: up.error, link: up.link, linkLabel: up.linkLabel } };
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
  if (pool.length) {
    const sc = {}; pool.forEach((g, i) => { sc[`s${i}`] = `${g.label}: ${g.text.slice(0, 160)}`; }); sc.none = 'None of these sections is about what the question asks';
    questions.section = { type: 'choice', instructions: 'Which section of the app guide answers the latest question?', criteria: sc };
  }
  let route = null, jev = null;
  try {
    const d = new Date(`${today}T00:00:00Z`);
    const r = await A.jevDecide(key, { latest_question: question, previous_question: previous, today: `${today} (${DAYS[d.getUTCDay()]})`, screen_the_user_is_on: String(path || '').slice(0, 100) }, questions);
    cost += r.cost; jev = r.answers;
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

  const sectionOf = (k) => GUIDE.find((g) => g.key === k);
  const link = (path) => (path ? { path, label: `Open ${SCREEN_LABEL[path] || path}` } : null);
  const kind = route.kind;

  if (kind === 'smalltalk') return done(text("Hi! I can look things up in your LS TECH data — stock, shipments, POs, tasks, clients — and explain how the app works. Try one of these:", { chips: chips(STARTERS) }), kind, null);
  if (kind === 'offtopic') return done(text('I only help with LS TECH: inventory, shipments, purchase orders, tasks, clients and how this app works. Ask me something about those.', { chips: chips(STARTERS) }), kind, null);
  if (kind === 'unclear') return done(text("I'm not sure what you'd like to know. Could you say it with an item, customer or date? For example:", { chips: chips(STARTERS) }), kind, null);

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
    return done(text('Data questions are switched off. An admin can turn on “Answers about live business data” in Settings → LS AI after recording the approval.', { link: { path: '/settings', label: 'Open Settings' } }), kind, null);
  }
  let toolKey = route.tool && route.tool !== 'none' ? route.tool : null;
  const rb = E.reelBox(question);
  if ((rb.reel || rb.box) && !toolKey) toolKey = 'trace';
  if (!toolKey || !BY_KEY[toolKey]) {
    return done(text(`I couldn't match that to a look-up. I can look up: ${TOOLS.map((t) => t.label.toLowerCase()).join(', ')}.`, { chips: chips(STARTERS) }), kind, null);
  }
  const tool = BY_KEY[toolKey];
  const ctx = { question, today, user };

  // A store filter applies only when the question talks about a store. Jev must not turn a customer name
  // ("Gelco Electronics") into the Gelco Stores warehouse — that once made a shipments question answer "nothing".
  const mentionsStore = /\bstores?\b|\bwarehouse\b|\bsecondary\b|\bprimary\b|\bmain\b/i.test(question);
  ctx.store = E.parseStore(question) || (mentionsStore && jev && top(jev.store).p >= 0.6 ? top(jev.store).key : 'all');
  if (tool.period) {
    ctx.period = E.parsePeriod(question, today) || (jev && top(jev.period).p >= 0.6 && top(jev.period).key !== 'none' ? E.periodFromPreset(top(jev.period).key, today) : null);
  }

  const askWhich = (what, cands, label) => done({ type: 'ask', text: `Which ${what} do you mean?`, options: cands.slice(0, 4).map((c) => ({ label: label(c), send: `${question} (${label(c)})` })) }, kind, toolKey);
  if (tool.entity === 'trace') {
    if (!rb.reel && !rb.box) return done(text('Which reel or box? For example “where is REEL-15600”.'), kind, toolKey);
    ctx.reel = rb.reel; ctx.box = rb.reel ? null : rb.box;
  } else if (tool.entity === 'item') {
    const cands = await E.itemCandidates(question);
    const [a, b] = cands;
    const clear = a && (!b || a.score >= 1.6 * b.score);
    if (clear) ctx.item = { code: a.code, label: a.label };
    else if (tool.required) {
      if (!a) return done(text("Which item? Give me the item code or part of its description, for example “BLDC CARD” or “22pF disc cap”."), kind, toolKey);
      try {
        const r = await chooseCandidate(key, question, 'item', cands, (c) => `${c.code} — ${c.label}`); cost += r.cost;
        trace.push(`item pick: ${r.pick ? r.pick.code : 'none'} (${Math.round((r.p || 0) * 100)}%)`);
        if (r.pick && r.p >= 0.6) ctx.item = { code: r.pick.code, label: r.pick.label };
        else return askWhich('item', cands, (c) => c.code);
      } catch (e) { return askWhich('item', cands, (c) => c.code); }
    }
  } else if (tool.entity === 'customer') {
    const cands = await E.customerCandidates(question);
    if (cands.length === 1) ctx.customer = cands[0];
    else if (cands.length > 1) {
      try {
        const r = await chooseCandidate(key, question, 'customer or company', cands, (c) => `${c.label}${c.internal ? ' — OUR OWN internal Gelco Stores warehouse, not a customer' : ' — a customer'}`); cost += r.cost;
        trace.push(`customer pick: ${r.pick ? r.pick.label : 'none'} (${Math.round((r.p || 0) * 100)}%)`);
        if (r.pick && r.p >= 0.6) ctx.customer = r.pick; else return askWhich('customer', cands, (c) => c.label);
      } catch (e) { return askWhich('customer', cands, (c) => c.label); }
    }
  } else if (tool.entity === 'po') {
    const cands = await E.poCandidates(question);
    if (cands.length === 1) ctx.po = cands[0];
    else if (cands.length > 1) return askWhich('PO', cands, (c) => c.po_number);
    else { const cust = await E.customerCandidates(question); if (cust.length === 1 && !cust[0].internal) ctx.customer = cust[0]; }
  } else if (tool.entity === 'user') {
    const u = await E.userMentions(question, user);
    if (u.length) ctx.users = u;
  }

  // ---- run the look-up ----
  let result;
  try { result = await tool.run(ctx); } catch (e) {
    trace.push(`tool error: ${e.message}`);
    return done(text('I could not read that data just now. Please try again in a moment.'), kind, toolKey, false);
  }

  // ---- grounding check: only when Jev was not sure of the look-up. Sends the look-up and parameters, never rows. ----
  if (route.toolP && route.toolP < 0.85 && !route.fallback) {
    try {
      const g = await A.jevDecide(key, { question, look_up: tool.label, what_it_does: tool.about, parameters_used: { store: ctx.store, period: ctx.period?.label || null, item: ctx.item?.code || null, customer: ctx.customer?.label || null }, columns_returned: result.columns.map((c) => c.label), row_count: result.rows.length },
        { fits: { type: 'noul', instructions: 'Does this look-up, with these parameters, answer the question that was asked?', criteria: { true: 'Yes, it answers the question.', false: 'No, it answers a different question or misses an important part of it.' } } });
      cost += g.cost; trace.push(`grounding: ${Math.round((g.answers.fits?.noul || 0) * 100)}%`);
      if ((g.answers.fits?.noul ?? 1) < 0.4) result.note = `This may not answer your question exactly. ${result.note || ''}`.trim();
    } catch (e) { trace.push(`grounding skipped: ${e.message}`); }
  }

  // ---- optional writing-model summary (the rows go to OpenRouter only in this mode) ----
  let written = null;
  if (settings.mode === 'write' && result.rows.length) {
    try {
      const w = await A.writeAnswer(key, settings.model,
        "You are LS AI, the assistant inside LS TECH, an electronic-component inventory app. Answer the QUESTION in one to three short sentences using ONLY the DATA. Copy numbers and names exactly. Never estimate or add up numbers that are not shown. Plain text, no markdown symbols. If the DATA does not answer the question, say what it does show.",
        JSON.stringify({ title: result.title, summary: result.summary, rows: result.rows.slice(0, 20) }).slice(0, 6000), question);
      written = w.text; cost += w.cost; trace.push('writer: data');
    } catch (e) { trace.push(`writer failed: ${e.message}`); }
  }

  const params = [];
  if (ctx.item) params.push({ label: 'Item', value: ctx.item.code });
  if (ctx.customer) params.push({ label: 'Customer', value: ctx.customer.label });
  if (ctx.po) params.push({ label: 'PO', value: ctx.po.po_number });
  if (ctx.users) params.push({ label: 'Person', value: ctx.users.join(', ') });
  if (ctx.reel || ctx.box) params.push({ label: ctx.reel ? 'Reel' : 'Box', value: ctx.reel || ctx.box });
  if (['stock_for_item', 'stock_overview', 'low_stock', 'dead_stock', 'inward_history', 'outward_by_customer', 'stock_transfers', 'daily_report'].includes(toolKey)) params.push({ label: 'Store', value: E.STORE_NAME[ctx.store] });
  if (tool.period && ctx.period) params.push({ label: 'Period', value: ctx.period.label });
  trace.push(`tool: ${toolKey} params=${JSON.stringify(params)}`);

  return done({ type: 'table', tool: toolKey, toolLabel: tool.label, params, text: written, ...result }, kind, toolKey);
}

module.exports = { turn, STARTERS };
