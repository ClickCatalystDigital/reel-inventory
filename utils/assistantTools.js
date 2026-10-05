// LS AI — the read-only look-ups. Each tool: { key, label, about (what Jev reads to choose it), entity, run(ctx) }.
// The model only CHOOSES a tool; every value used in SQL is a bound parameter resolved by code (utils/assistantEntities.js).
// Data quirks encoded here, not left to a model: Deleted reels excluded; reels.quantity is 0 once Outwarded/Deleted (shipped qty
// comes from outwards.quantity_shipped); primary = LS Tech Stores, secondary = Gelco Stores; low stock = fewer than 5 in-stock
// reels; dead stock = no outward in 30 days; customer spellings are merged by normalizeCustomer(); IST naive timestamps and
// string date bounds only (never SQLite date()).
const { queryAll, queryOne, readBatch, istDateString, istDayBounds } = require('../db/schema');
const { getDailyReportData } = require('./dailyReport');
const E = require('./assistantEntities');
const ST = require('./assistantStats');

const n = (x) => Number(x || 0).toLocaleString('en-IN');
const plural = (k, w) => `${n(k)} ${w}${Number(k) === 1 ? '' : 's'}`;
const CAP = 25;
const storeSql = (store, col = 'store_code') => (store && store !== 'all' ? { sql: ` AND ${col} = ?`, args: [store] } : { sql: '', args: [] });
const bounds = (p) => (p && p.from ? { from: `${p.from} 00:00:00`, to: `${p.to} 23:59:59` } : null);
const col = (key, label, type = 'text') => ({ key, label, type });
const table = (o) => ({ rows: [], total: o.rows ? o.rows.length : 0, ...o });

const TOOLS = [
  {
    key: 'search_items', label: 'Find items in the catalog', entity: null,
    about: 'Find items in the catalog by code or description, e.g. "do we have 22pF disc caps", "what is the SPQ of BLDC CARD", "list MLCC items".',
    keywords: ['catalog', 'spq', 'find item', 'search item', 'do we have', 'do we stock'],
    async run(c) {
      const toks = E.distinctive(c.question).slice(0, 5);
      const items = await queryAll("SELECT item_code, description, default_spq FROM items WHERE status != 'Deleted' ORDER BY item_code");
      const rows = items.filter((i) => !toks.length || toks.every((t) => E.norm(`${i.item_code} ${i.description}`).includes(t)));
      return table({ title: 'Catalog items', summary: rows.length ? `${plural(rows.length, 'item')} match${rows.length === 1 ? 'es' : ''}.` : 'No catalog item matches.',
        columns: [col('item_code', 'Item code'), col('description', 'Description'), col('default_spq', 'SPQ', 'int')], rows: rows.slice(0, CAP).map((r) => ({ ...r })), total: rows.length,
        truncated: rows.length > CAP, link: { path: '/catalog', label: 'Open Catalog' } });
    },
  },
  {
    key: 'stock_for_item', label: 'Stock of one item', entity: 'item', required: true,
    about: 'How much stock of ONE named item is on hand (reels and pieces), per store, e.g. "how many reels of BLDC CARD do we have", "stock of BC857B at Gelco Stores".',
    keywords: ['stock of', 'how many reels', 'how much stock', 'on hand', 'in stock', 'available'],
    async run(c) {
      const it = c.item; const st = storeSql(c.store, 'r.store_code');
      const [byStore, cat] = await readBatch([
        [`SELECT r.store_code, COUNT(*) AS reels, COALESCE(SUM(r.quantity),0) AS qty FROM reels r WHERE r.item_code = ? AND r.status = 'In Stock'${st.sql} GROUP BY r.store_code`, [it.code, ...st.args]],
        ['SELECT default_spq FROM items WHERE item_code = ?', [it.code]],
      ]);
      const rows = byStore.rows.map((r) => ({ store: E.STORE_NAME[r.store_code] || r.store_code, reels: Number(r.reels), qty: Number(r.qty) }));
      const tr = rows.reduce((a, r) => a + r.reels, 0), tq = rows.reduce((a, r) => a + r.qty, 0);
      return table({ title: `Stock: ${it.code}`, summary: tr ? `${plural(tr, 'reel')} · ${n(tq)} pcs in stock${c.store && c.store !== 'all' ? ` at ${E.STORE_NAME[c.store]}` : ''}.` : `No stock of ${it.code}${c.store && c.store !== 'all' ? ` at ${E.STORE_NAME[c.store]}` : ''}.`,
        columns: [col('store', 'Store'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows, note: `${it.label || ''}${cat.rows[0] ? ` · SPQ ${n(cat.rows[0].default_spq)}` : ''}`.replace(/^ · /, ''),
        link: { path: '/reports', label: 'Open Stock Summary' } });
    },
  },
  {
    key: 'stock_overview', label: 'Stock overview', entity: null,
    about: 'Overall stock across items: totals, the items with the most stock, "what is our total stock", "top 10 items by quantity", "stock at Gelco Stores overall".',
    keywords: ['total stock', 'overall stock', 'top items', 'most stock', 'biggest'],
    async run(c) {
      const st = storeSql(c.store, 'store_code');
      const [top, tot] = await readBatch([
        [`SELECT r.item_code, i.description, COUNT(*) AS reels, SUM(r.quantity) AS qty FROM reels r LEFT JOIN items i ON i.item_code = r.item_code WHERE r.status = 'In Stock'${st.sql.replace('store_code', 'r.store_code')} GROUP BY r.item_code ORDER BY qty DESC LIMIT 15`, st.args],
        [`SELECT COUNT(DISTINCT item_code) AS items, COUNT(*) AS reels, COALESCE(SUM(quantity),0) AS qty FROM reels WHERE status = 'In Stock'${st.sql}`, st.args],
      ]);
      const t = tot.rows[0];
      return table({ title: `Stock overview — ${E.STORE_NAME[c.store || 'all']}`, summary: `${plural(t.items, 'item')} in stock · ${plural(t.reels, 'reel')} · ${n(t.qty)} pcs.`,
        columns: [col('item_code', 'Item code'), col('description', 'Description'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows: top.rows.map((r) => ({ ...r, reels: Number(r.reels), qty: Number(r.qty) })),
        note: 'Top 15 items by quantity.', truncated: Number(t.items) > 15, total: Number(t.items), link: { path: '/reports', label: 'Open Stock Summary' } });
    },
  },
  {
    key: 'low_stock', label: 'Low stock items', entity: null,
    about: 'Items that are running low (fewer than 5 reels in stock), "what is running low", "low stock at Gelco Stores".',
    keywords: ['low stock', 'running low', 'running out', 'reorder', 'shortage'],
    async run(c) {
      const withStore = c.store && c.store !== 'all'; const st = storeSql(c.store, 'r.store_code');
      const rows = await queryAll(`SELECT i.item_code, i.description, COUNT(r.id) AS reels, COALESCE(SUM(r.quantity),0) AS qty FROM items i ${withStore ? 'JOIN' : 'LEFT JOIN'} reels r ON r.item_code = i.item_code AND r.status = 'In Stock'${st.sql}
        WHERE i.status != 'Deleted' GROUP BY i.item_code HAVING COUNT(r.id) < 5 ORDER BY reels ASC, i.item_code`, st.args);
      return table({ title: `Low stock — ${E.STORE_NAME[c.store || 'all']}`, summary: `${plural(rows.length, 'item')} with fewer than 5 reels in stock.`,
        columns: [col('item_code', 'Item code'), col('description', 'Description'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows: rows.slice(0, CAP).map((r) => ({ ...r, reels: Number(r.reels), qty: Number(r.qty) })),
        total: rows.length, truncated: rows.length > CAP, note: 'Low = fewer than 5 reels in stock (reel count, not quantity).', link: { path: '/reports/alerts', label: 'Open Dead & Low Stock' } });
    },
  },
  {
    key: 'dead_stock', label: 'Dead stock', entity: null,
    about: 'Items that have stock but have not moved (no outward in the last 30 days or ever), "dead stock", "slow moving items", "what has not shipped".',
    keywords: ['dead stock', 'slow moving', 'not moved', 'not shipped', 'idle', 'stagnant'],
    async run(c) {
      const st = storeSql(c.store, 'r.store_code');
      const rows = await queryAll(`SELECT i.item_code, i.description, COUNT(r.id) AS reels, SUM(r.quantity) AS qty, MAX(o.outward_date) AS last_outward,
          CAST(julianday('now') - julianday(MAX(o.outward_date)) AS INTEGER) AS days FROM items i JOIN reels r ON i.item_code = r.item_code AND r.status = 'In Stock'${st.sql}
        LEFT JOIN outwards o ON r.reel_number = o.reel_number GROUP BY i.item_code HAVING MAX(o.outward_date) IS NULL OR julianday('now') - julianday(MAX(o.outward_date)) > 30
        ORDER BY days DESC, qty DESC`, st.args);
      return table({ title: `Dead stock — ${E.STORE_NAME[c.store || 'all']}`, summary: `${plural(rows.length, 'item')} with stock and no outward in the last 30 days.`,
        columns: [col('item_code', 'Item code'), col('description', 'Description'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int'), col('last_outward', 'Last outward', 'date')],
        rows: rows.slice(0, CAP).map((r) => ({ ...r, reels: Number(r.reels), qty: Number(r.qty), last_outward: r.last_outward ? String(r.last_outward).slice(0, 10) : 'never' })),
        total: rows.length, truncated: rows.length > CAP, link: { path: '/reports/alerts', label: 'Open Dead & Low Stock' } });
    },
  },
  {
    key: 'inward_history', label: 'Stock received (inward)', entity: 'item', required: false, period: true, comparable: true,
    about: 'What was received into stock (inward) in a period, optionally for one item, "what came in last week", "inward of BC857B in September".',
    keywords: ['inward', 'received', 'came in', 'receiving', 'inwarded'],
    async run(c) {
      const p = c.period || E.parsePeriod('this month'); const b = bounds(p); const st = storeSql(c.store, 'r.store_code');
      const itemSql = c.item ? ' AND r.item_code = ?' : '';
      const rows = await queryAll(`SELECT r.item_code, COUNT(*) AS reels, SUM(r.quantity + COALESCE((SELECT SUM(o.quantity_shipped) FROM outwards o WHERE o.reel_number = r.reel_number), 0)) AS qty
        FROM reels r WHERE r.status != 'Deleted'${b ? ' AND r.inward_date BETWEEN ? AND ?' : ''}${st.sql}${itemSql} GROUP BY r.item_code ORDER BY qty DESC`, [...(b ? [b.from, b.to] : []), ...st.args, ...(c.item ? [c.item.code] : [])]);
      const tr = rows.reduce((a, r) => a + Number(r.reels), 0), tq = rows.reduce((a, r) => a + Number(r.qty), 0);
      return table({ title: `Stock received — ${p.label}`, summary: rows.length ? `${plural(tr, 'reel')} · ${n(tq)} pcs received across ${plural(rows.length, 'item')}.` : 'Nothing was received in this period.',
        columns: [col('item_code', 'Item code'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows: rows.slice(0, CAP).map((r) => ({ item_code: r.item_code, reels: Number(r.reels), qty: Number(r.qty) })), total: rows.length, truncated: rows.length > CAP,
        note: 'Quantity is what was originally received (it includes reels that have since shipped).', link: { path: '/inward', label: 'Open Inward' } });
    },
  },
  {
    key: 'outward_by_customer', label: 'Shipments to customers', entity: 'customer', required: false, period: true, comparable: true,
    about: 'What was shipped (outward) to customers in a period, per customer or for one named customer, "what did we ship to Gelco Electronics in September", "top customers this year", "last shipment to Sansui".',
    keywords: ['shipped', 'shipments', 'outward', 'sold', 'sent to', 'customer', 'dispatched to', 'delivered', 'ship to', 'did we ship', 'we ship'],
    async run(c) {
      const p = c.period || { from: null, to: null, label: 'All time' }; const b = bounds(p); const st = storeSql(c.store, 'o.store_code');
      const args = [...(b ? [b.from, b.to] : []), ...st.args];
      const where = `WHERE 1=1${b ? ' AND o.outward_date BETWEEN ? AND ?' : ''}${st.sql}`;
      if (c.customer) {
        const names = c.customer.variants;
        const ph = names.map(() => '?').join(',');
        const [byItem, tot] = await readBatch([
          [`SELECT r.item_code, COUNT(DISTINCT o.reel_number) AS reels, SUM(o.quantity_shipped) AS qty FROM outwards o JOIN reels r ON r.reel_number = o.reel_number ${where} AND o.customer_name IN (${ph}) GROUP BY r.item_code ORDER BY qty DESC LIMIT ${CAP}`, [...args, ...names]],
          [`SELECT COUNT(DISTINCT o.reel_number) AS reels, COALESCE(SUM(o.quantity_shipped),0) AS qty, COUNT(DISTINCT o.invoice_number) AS invoices, MAX(o.outward_date) AS last_date FROM outwards o ${where} AND o.customer_name IN (${ph})`, [...args, ...names]],
        ]);
        const t = tot.rows[0];
        return table({ title: `Shipped to ${c.customer.label} — ${p.label}`, summary: Number(t.reels) ? `${plural(t.reels, 'reel')} · ${n(t.qty)} pcs · ${plural(t.invoices, 'invoice')}; last shipment ${String(t.last_date).slice(0, 10)}.` : `Nothing was shipped to ${c.customer.label} in this period.`,
          columns: [col('item_code', 'Item code'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows: byItem.rows.map((r) => ({ item_code: r.item_code, reels: Number(r.reels), qty: Number(r.qty) })),
          note: c.customer.variants.length > 1 ? `Combines ${c.customer.variants.length} spellings of this customer's name.` : null, link: { path: '/notifications', label: 'Open Notifications' } });
      }
      const raw = await queryAll(`SELECT o.customer_name, COUNT(DISTINCT o.reel_number) AS reels, SUM(o.quantity_shipped) AS qty, COUNT(DISTINCT o.invoice_number) AS invoices, MAX(o.outward_date) AS last_date FROM outwards o ${where} GROUP BY o.customer_name`, args);
      const keyOf = await E.customerKeyMap(); // merges spellings, typos and first-word abbreviations of one customer
      const merged = new Map();
      for (const r of raw) {
        const grp = keyOf.get(r.customer_name); const k = grp ? grp.key : E.normalizeCustomer(r.customer_name); let g = merged.get(k);
        if (!g) merged.set(k, (g = { customer: grp ? grp.label : r.customer_name, reels: 0, qty: 0, invoices: 0, last: '' }));
        g.reels += Number(r.reels); g.qty += Number(r.qty); g.invoices += Number(r.invoices); if (String(r.last_date) > g.last) g.last = String(r.last_date);
      }
      const rows = [...merged.entries()].filter(([k]) => k !== 'gelco stores').map(([, g]) => ({ customer: g.customer, reels: g.reels, qty: g.qty, invoices: g.invoices, last_date: g.last.slice(0, 10) })).sort((a, b) => b.qty - a.qty);
      return table({ title: `Shipments by customer — ${p.label}`, summary: rows.length ? `${plural(rows.length, 'customer')} · ${n(rows.reduce((a, r) => a + r.qty, 0))} pcs shipped.` : 'No shipments in this period.',
        columns: [col('customer', 'Customer'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int'), col('invoices', 'Invoices', 'int'), col('last_date', 'Last shipment', 'date')], rows: rows.slice(0, CAP), total: rows.length,
        note: 'Spellings of the same customer are combined. Internal "Gelco Stores" movements are not customers and are excluded.', link: { path: '/notifications', label: 'Open Notifications' } });
    },
  },
  {
    key: 'trace', label: 'Trace a reel or box', entity: 'trace', required: true,
    about: 'Where is a specific reel (REEL-#####) or box (BOX-####), its status, its quantity, who it was shipped to, and its transfers, "where is REEL-15600", "what is in BOX-1450".',
    keywords: ['where is', 'trace', 'reel-', 'box-', 'which store is'],
    async run(c) {
      if (c.reel) {
        const [reel, outs, trs] = await readBatch([
          ['SELECT r.reel_number, r.item_code, r.box_number, r.quantity, r.status, r.store_code, r.inward_date, i.description FROM reels r LEFT JOIN items i ON i.item_code = r.item_code WHERE r.reel_number = ?', [c.reel]],
          ['SELECT customer_name, invoice_number, quantity_shipped, outward_type, outward_date FROM outwards WHERE reel_number = ? ORDER BY outward_date', [c.reel]],
          ['SELECT from_store, to_store, quantity, transferred_by, transferred_at FROM stock_transfers WHERE reel_number = ? ORDER BY transferred_at', [c.reel]],
        ]);
        const r = reel.rows[0];
        if (!r) return table({ title: c.reel, summary: `${c.reel} does not exist.`, columns: [], rows: [] });
        const rows = [
          { event: 'Inward', detail: `${r.item_code}${r.box_number ? ` · ${r.box_number}` : ''}`, when: String(r.inward_date).slice(0, 16) },
          ...trs.rows.map((t) => ({ event: 'Transfer', detail: `${E.STORE_NAME[t.from_store] || t.from_store} → ${E.STORE_NAME[t.to_store] || t.to_store} · ${n(t.quantity)} pcs`, when: String(t.transferred_at).slice(0, 16) })),
          ...outs.rows.map((o) => ({ event: o.outward_type === 'Partial' ? 'Outward (partial)' : 'Outward', detail: `${o.customer_name} · inv ${o.invoice_number} · ${n(o.quantity_shipped)} pcs`, when: String(o.outward_date).slice(0, 16) })),
        ].sort((a, b) => a.when.localeCompare(b.when));
        const where = r.status === 'In Stock' ? `in stock at ${E.STORE_NAME[r.store_code] || r.store_code} (${n(r.quantity)} pcs)` : r.status === 'Outwarded' ? `shipped (${E.STORE_NAME[r.store_code] || r.store_code} when shipped)` : 'deleted';
        return table({ title: `Trace: ${c.reel}`, summary: `${c.reel} — ${r.item_code} — ${where}.`, columns: [col('when', 'When', 'date'), col('event', 'Event'), col('detail', 'Details')], rows, note: r.description || null, link: { path: '/reports/search', label: 'Open Search & Trace' } });
      }
      const [box, reels] = await readBatch([
        ['SELECT box_number, item_code, reel_count FROM boxes WHERE box_number = ?', [c.box]],
        ['SELECT reel_number, status, quantity, store_code FROM reels WHERE box_number = ? ORDER BY reel_number', [c.box]],
      ]);
      const b = box.rows[0];
      if (!b) return table({ title: c.box, summary: `${c.box} does not exist.`, columns: [], rows: [] });
      const live = reels.rows.filter((r) => r.status === 'In Stock');
      return table({ title: `Trace: ${c.box}`, summary: `${c.box} — ${b.item_code} — ${live.length} of ${reels.rows.length} reels still in stock (${n(live.reduce((a, r) => a + Number(r.quantity), 0))} pcs).`,
        columns: [col('reel_number', 'Reel'), col('status', 'Status'), col('quantity', 'Quantity', 'int'), col('store', 'Store')], rows: reels.rows.slice(0, CAP).map((r) => ({ reel_number: r.reel_number, status: r.status, quantity: Number(r.quantity), store: E.STORE_NAME[r.store_code] || r.store_code })),
        total: reels.rows.length, truncated: reels.rows.length > CAP, link: { path: '/reports/search', label: 'Open Search & Trace' } });
    },
  },
  {
    key: 'stock_transfers', label: 'Stock transfers between stores', entity: 'item', required: false, period: true, comparable: true,
    about: 'Stock moved between LS Tech Stores and Gelco Stores in a period, "what moved to Gelco Stores this month", "transfers yesterday".',
    keywords: ['transfer', 'transferred', 'moved to', 'moved from'],
    async run(c) {
      const p = c.period || E.parsePeriod('this month'); const b = bounds(p);
      const sideSql = c.store && c.store !== 'all' ? ' AND (t.from_store = ? OR t.to_store = ?)' : ''; const itemSql = c.item ? ' AND r.item_code = ?' : '';
      const rows = await queryAll(`SELECT r.item_code, t.from_store, t.to_store, COUNT(*) AS reels, SUM(t.quantity) AS qty, MAX(t.transferred_at) AS last_at FROM stock_transfers t LEFT JOIN reels r ON r.reel_number = t.reel_number
        WHERE 1=1${b ? ' AND t.transferred_at BETWEEN ? AND ?' : ''}${sideSql}${itemSql} GROUP BY r.item_code, t.from_store, t.to_store ORDER BY qty DESC`,
        [...(b ? [b.from, b.to] : []), ...(sideSql ? [c.store, c.store] : []), ...(c.item ? [c.item.code] : [])]);
      const tr = rows.reduce((a, r) => a + Number(r.reels), 0);
      return table({ title: `Transfers — ${p.label}`, summary: rows.length ? `${plural(tr, 'reel')} moved across ${plural(rows.length, 'line')}.` : 'No transfers in this period.',
        columns: [col('item_code', 'Item code'), col('route', 'From → To'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int'), col('last_at', 'Last move', 'date')],
        rows: rows.slice(0, CAP).map((r) => ({ item_code: r.item_code, route: `${E.STORE_NAME[r.from_store] || r.from_store} → ${E.STORE_NAME[r.to_store] || r.to_store}`, reels: Number(r.reels), qty: Number(r.qty), last_at: String(r.last_at).slice(0, 10) })), total: rows.length, truncated: rows.length > CAP, link: { path: '/transfer', label: 'Open Transfer' } });
    },
  },
  {
    key: 'daily_report', label: 'Daily report', entity: null, period: true,
    about: 'The activity of one day or store (inward, outward, transfers, pending approvals): "today\'s numbers", "what happened yesterday", "what has Gelco Stores done today", "what did LS Tech Stores do on 2 Oct", "daily report".',
    keywords: ['daily report', 'today', 'yesterday', 'what happened', 'summary of the day'],
    async run(c) {
      const day = c.period && c.period.from ? c.period.from : istDateString();
      const d = await getDailyReportData(c.store, day);
      const tin = d.inward.reduce((a, r) => a + Number(r.reel_count), 0), tout = d.outward.reduce((a, r) => a + Number(r.reel_count), 0);
      const rows = [
        ...d.inward.slice(0, 8).map((r) => ({ section: 'Inward', item_code: r.item_code, reels: Number(r.reel_count), qty: Number(r.total_qty) })),
        ...d.outward.slice(0, 8).map((r) => ({ section: 'Outward', item_code: r.item_code, reels: Number(r.reel_count), qty: Number(r.total_qty) })),
      ];
      return table({ title: `Daily report — ${E.fmtD(day)}`, summary: `${plural(tin, 'reel')} in · ${plural(tout, 'reel')} out · ${plural((d.transfers || []).length, 'transfer')} · ${plural(d.pendingApprovals, 'approval')} waiting.`,
        columns: [col('section', 'Section'), col('item_code', 'Item code'), col('reels', 'Reels', 'int'), col('qty', 'Quantity', 'int')], rows, total: d.inward.length + d.outward.length,
        note: 'Same figures as Reports → Daily Report (its inward quantity is the current quantity, so reels already shipped count as 0).', link: { path: '/reports/daily', label: 'Open Daily Report' } });
    },
  },
  {
    key: 'pending_requests', label: 'Approval requests', entity: 'user', required: false, period: true,
    about: 'Staff requests for approval (inward, outward, transfer): waiting, or already approved/rejected, optionally by one person and in a period, "any approvals waiting", "what did sahil submit", "what did pranav approve yesterday", "rejected requests this month".',
    keywords: ['approval', 'approvals', 'pending request', 'requests', 'waiting for approval', 'rejected', 'approved'],
    async run(c) {
      const q = c.question.toLowerCase(); const status = /\brejected\b/.test(q) ? 'rejected' : /\bapproved?\b|\bapproving\b/.test(q) ? 'approved' : 'pending';
      const who = c.users && c.users.length ? c.users : null;
      const reviewer = status !== 'pending' && /approv|reject|review/.test(q); // "what did pranav approve" -> the reviewer, "what did sahil submit" -> the requester
      const p = c.period && c.period.from ? c.period : null; const b = bounds(p);
      const whoCol = reviewer ? 'reviewed_by' : 'created_by', timeCol = status === 'pending' ? 'created_at' : 'reviewed_at';
      const where = `status = ?${who ? ` AND ${whoCol} IN (${who.map(() => '?').join(',')})` : ''}${b ? ` AND ${timeCol} BETWEEN ? AND ?` : ''}`;
      const args = [status, ...(who || []), ...(b ? [b.from, b.to] : [])];
      const [cnt, list] = await readBatch([
        [`SELECT COUNT(*) AS n FROM requests WHERE ${where}`, args],
        [`SELECT id, type, created_by, reviewed_by, created_at, reviewed_at, payload FROM requests WHERE ${where} ORDER BY COALESCE(${timeCol}, created_at) DESC LIMIT ?`, [...args, CAP]],
      ]);
      const out = list.rows.map((r) => {
        let pl = {}; try { pl = JSON.parse(r.payload); } catch { /* keep empty */ }
        const what = r.type === 'inward' ? `${pl.num_reels || '?'} reels of ${pl.item_code}` : r.type === 'outward' ? `${(pl.reel_numbers || [pl.reel_number]).filter(Boolean).length} reel(s) to ${pl.customer_name || '?'}` : `${pl.kind || ''} ${pl.number || ''} → ${E.STORE_NAME[pl.to_store] || pl.to_store || ''}`;
        return { id: r.id, type: r.type, by: r.created_by, reviewed_by: r.reviewed_by || '—', what, at: String(status === 'pending' ? r.created_at : r.reviewed_at || r.created_at).slice(0, 16) };
      });
      const total = Number(cnt.rows[0].n);
      return table({ title: `Requests — ${status}${who ? ` — ${who.join(', ')}` : ''}${p ? ` — ${p.label}` : ''}`, summary: total ? `${plural(total, status + ' request')}${who ? (reviewer ? ` reviewed by ${who.join(', ')}` : ` from ${who.join(', ')}`) : ''}.` : `No ${status} requests${who ? ` for ${who.join(', ')}` : ''}${p ? ` in ${p.label}` : ''}.`,
        columns: [col('id', '#', 'int'), col('type', 'Type'), col('by', 'Submitted by'), col('reviewed_by', 'Reviewed by'), col('what', 'What'), col('at', 'When', 'date')], rows: out, total, truncated: total > out.length,
        note: 'Only approvals/rejections of staff requests are recorded per person — who received or shipped stock directly is not.', link: { path: '/requests', label: 'Open Requests' } });
    },
  },
  {
    key: 'purchase_orders', label: 'Purchase orders', entity: 'po', required: false,
    about: 'Customer purchase orders: by status (draft, confirmed, dispatched, cancelled), for a customer, their value (quantity × unit price on the PO lines), or one PO by number with its lines and how much has shipped, "which POs are confirmed but not dispatched", "status of PO P0055838", "how much are the Gelco POs worth".',
    keywords: ['purchase order', 'purchase orders', 'po status', 'confirmed po', 'dispatched po', 'open po', 'po value', 'worth'],
    async run(c) {
      if (c.po) {
        const [items, shipped] = await readBatch([
          ['SELECT item_code, quantity_ordered, unit_price FROM crm_po_items WHERE po_id = ?', [c.po.id]],
          ['SELECT r.item_code, SUM(o.quantity_shipped) AS qty FROM outwards o JOIN reels r ON r.reel_number = o.reel_number WHERE o.po_id = ? GROUP BY r.item_code', [c.po.id]],
        ]);
        const sh = new Map(shipped.rows.map((r) => [r.item_code, Number(r.qty)]));
        const rows = items.rows.map((i) => ({ item_code: i.item_code || '(unmatched line)', ordered: Number(i.quantity_ordered) || 0, shipped: sh.get(i.item_code) || 0, price: i.unit_price === null ? '—' : String(i.unit_price), value: Math.round((Number(i.quantity_ordered) || 0) * Number(i.unit_price || 0)) }));
        const tv = rows.reduce((a, r) => a + r.value, 0);
        return table({ title: `PO ${c.po.po_number}`, summary: `${c.po.po_number} — ${c.po.status}${c.po.company ? ` — ${c.po.company}` : ''}; ${plural(rows.length, 'line')}; value ${n(tv)}.`, columns: [col('item_code', 'Item code'), col('ordered', 'Ordered', 'int'), col('shipped', 'Shipped', 'int'), col('price', 'Unit price', 'int'), col('value', 'Value', 'int')], rows,
          note: 'Shipped = outwards tied to this PO. Value = ordered quantity × unit price on the PO line (the PO does not record a currency).' });
      }
      const q = c.question.toLowerCase(); const status = ['draft', 'confirmed', 'dispatched', 'cancelled'].find((s) => q.includes(s)) || (/\bopen\b|\bnot dispatched\b|\bpending\b/.test(q) ? 'confirmed' : null);
      const cust = c.customer ? ` AND co.name IN (${c.customer.variants.map(() => '?').join(',')})` : '';
      const rows = await queryAll(`SELECT p.po_number, p.status, co.name AS company, p.order_date, p.expected_dispatch_date, (SELECT COUNT(*) FROM crm_po_items i WHERE i.po_id = p.id) AS lines,
          (SELECT COALESCE(SUM(i.quantity_ordered * COALESCE(i.unit_price, 0)), 0) FROM crm_po_items i WHERE i.po_id = p.id) AS value
        FROM crm_purchase_orders p LEFT JOIN crm_companies co ON co.id = p.company_id WHERE 1=1${status ? ' AND p.status = ?' : ''}${cust} ORDER BY p.id DESC LIMIT ?`, [...(status ? [status] : []), ...(c.customer ? c.customer.variants : []), CAP]);
      const counts = await queryAll('SELECT status, COUNT(*) AS n FROM crm_purchase_orders GROUP BY status');
      const tv = rows.reduce((a, r) => a + Number(r.value), 0);
      return table({ title: `Purchase orders${status ? ` — ${status}` : ''}`, summary: `${plural(rows.length, 'PO')} shown, together worth ${n(Math.round(tv))}. All POs: ${counts.map((r) => `${n(r.n)} ${r.status}`).join(', ')}.`,
        columns: [col('po_number', 'PO'), col('status', 'Status'), col('company', 'Customer'), col('order_date', 'Ordered', 'date'), col('expected_dispatch_date', 'Dispatch by', 'date'), col('lines', 'Lines', 'int'), col('value', 'Value', 'int')],
        rows: rows.map((r) => ({ ...r, lines: Number(r.lines), value: Math.round(Number(r.value)), order_date: r.order_date || '—', expected_dispatch_date: r.expected_dispatch_date || '—', company: r.company || '—' })),
        note: 'Value = ordered quantity × unit price on the PO lines (no currency is recorded). Shipments themselves carry no prices.', link: { path: '/outward', label: 'Open Outward' } });
    },
  },
  {
    key: 'tasks', label: 'Tasks', entity: ['user', 'client'], required: false, period: true,
    about: 'Follow-up tasks and call reminders: open, overdue, due in a period, or completed — for a person, for one named client/company, or for everyone, "what is overdue", "tasks zakir has this week", "next follow-up with Sansui", "what did we complete last week", "my tasks".',
    keywords: ['task', 'tasks', 'overdue', 'follow up', 'follow-up', 'to do', 'plate', 'reminder', 'schedule', 'next call'],
    async run(c) {
      const today = istDateString(); const q = c.question.toLowerCase();
      const who = c.users && c.users.length ? c.users : null; const ids = c.client ? c.client.ids : null;
      const status = /\b(done|completed|finished|closed)\b/.test(q) ? 'done' : /\b(overdue|late|missed|behind)\b/.test(q) ? 'overdue' : 'open';
      const nextOnly = status === 'open' && /\b(next|upcoming|coming)\b/.test(q);
      const p = c.period && c.period.from ? c.period : null; const b = bounds(p);
      const where = ['t.status = ?']; const args = [status === 'done' ? 'done' : 'open'];
      if (who) { where.push(`t.assigned_to IN (${who.map(() => '?').join(',')})`); args.push(...who); }
      if (ids) { where.push(`t.contact_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
      if (status === 'overdue') { where.push('t.due_date < ?'); args.push(today); }
      else if (nextOnly) { where.push('t.due_date >= ?'); args.push(today); }
      if (p) { if (status === 'done') { where.push('t.completed_at BETWEEN ? AND ?'); args.push(b.from, b.to); } else { where.push('t.due_date BETWEEN ? AND ?'); args.push(p.from, p.to); } }
      const W = where.join(' AND ');
      const order = status === 'done' ? 't.completed_at DESC' : 't.due_date ASC';
      const base = ['t.status = ?', ...(who ? [`t.assigned_to IN (${who.map(() => '?').join(',')})`] : []), ...(ids ? [`t.contact_id IN (${ids.map(() => '?').join(',')})`] : [])].join(' AND ');
      const baseArgs = ['open', ...(who || []), ...(ids || [])];
      const [cnt, list, earlier] = await readBatch([
        [`SELECT COALESCE(t.assigned_to, '(unassigned)') AS who, COUNT(*) AS n, SUM(t.due_date < ?) AS overdue FROM crm_tasks t WHERE ${W} GROUP BY who ORDER BY n DESC`, [today, ...args]],
        [`SELECT t.title, t.due_date, t.completed_at, COALESCE(t.assigned_to, '(unassigned)') AS who, c.poc_name FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id WHERE ${W} ORDER BY ${order} LIMIT ?`, [...args, nextOnly ? 5 : 15]],
        // open tasks that were already due before this window — shown as a count so "this week" doesn't hide the backlog
        [`SELECT COUNT(*) AS n FROM crm_tasks t WHERE ${base} AND t.due_date < ?`, [...baseArgs, p ? p.from : today]],
      ]);
      const total = cnt.rows.reduce((a, r) => a + Number(r.n), 0), over = cnt.rows.reduce((a, r) => a + Number(r.overdue), 0), backlog = Number(earlier.rows[0].n);
      const label = ids ? c.client.label : who ? who.join(', ') : 'everyone';
      const first = list.rows[0];
      let summary;
      if (nextOnly) summary = first ? `Next follow-up${ids ? ` with ${c.client.label}` : ''}: ${E.fmtD(first.due_date)} — ${first.title} (${first.who}).` : `No upcoming follow-up${ids ? ` with ${c.client.label}` : ''} is scheduled${backlog ? `, but ${plural(backlog, 'task')} ${backlog === 1 ? 'is' : 'are'} overdue` : ''}.`;
      else if (status === 'done') summary = `${plural(total, 'task')} completed${p ? ` in ${p.label}` : ''}.`;
      else summary = `${plural(total, status === 'overdue' ? 'overdue task' : 'open task')}${p && status !== 'overdue' ? ` due in ${p.label}` : ''}${status === 'open' && !p ? ` · ${over} overdue` : ''}${p && status === 'open' && backlog ? ` · plus ${n(backlog)} still overdue from before` : ''}.${!who && !ids && cnt.rows.length > 1 ? ` By person: ${cnt.rows.map((r) => `${r.who} ${n(r.n)}`).join(', ')}.` : ''}`;
      return table({ title: `${status === 'done' ? 'Completed' : status === 'overdue' ? 'Overdue' : 'Open'} tasks — ${label}`, summary,
        columns: [col('due_date', status === 'done' ? 'Completed' : 'Due', 'date'), col('who', 'Assigned'), col('title', 'Task')],
        rows: list.rows.map((r) => ({ due_date: String(status === 'done' ? r.completed_at : r.due_date).slice(0, 10), who: r.who, title: r.poc_name ? `${r.poc_name} — ${r.title}` : r.title })), total, truncated: total > list.rows.length,
        note: status === 'done' ? 'Most recently completed first.' : 'Earliest due first.', link: { path: '/', label: 'Open Home' } });
    },
  },
  {
    key: 'clients_pipeline', label: 'Clients pipeline', entity: 'client', required: false,
    about: 'The CRM contacts/clients: counts per stage (new, contacted, qualified, customer, lost), the high-severity watch list, or the list of clients that were never contacted / not contacted for N days, "how many leads", "who is on the watch list", "which clients have we not contacted", "clients not contacted in 30 days".',
    keywords: ['clients', 'leads', 'pipeline', 'watch list', 'severity', 'contacts', 'conversion', 'not contacted', 'gone cold'],
    async run(c) {
      const q = c.question.toLowerCase(); const high = /\bhigh\b|watch|severity 3|critical/.test(q);
      const stageWord = (/\bqualified\b/.test(q) && 'qualified') || (/\blost\b/.test(q) && 'lost') || (/\bcontacted\b/.test(q) && !/\bnot\b|haven'?t|never|n't/.test(q) && 'contacted') || (/\bnew (clients?|leads?|contacts?)\b/.test(q) && 'new') || null;
      const notContacted = /\bnot (been )?(contacted|called|spoken|followed)|haven'?t (been )?(contacted|called|spoken|followed)|never (been )?(contacted|called)|untouched|gone (cold|quiet)|neglected|stale/.test(q);
      const dm = /(\d+)\s*(day|week|month)/.exec(q); const days = dm ? Number(dm[1]) * (dm[2] === 'week' ? 7 : dm[2] === 'month' ? 30 : 1) : null;
      const ids = c.client ? c.client.ids : null;
      const [stages, all] = await readBatch([
        ['SELECT status, COUNT(*) AS n FROM crm_contacts GROUP BY status', []],
        [`SELECT c.id, c.poc_name, co.name AS company, c.status, c.severity, (SELECT MAX(created_at) FROM crm_notes n WHERE n.contact_id = c.id) AS last_note,
            (SELECT MAX(completed_at) FROM crm_tasks t WHERE t.contact_id = c.id AND t.status = 'done') AS last_done, (SELECT COUNT(*) FROM crm_tasks t WHERE t.contact_id = c.id AND t.status = 'open') AS open_tasks
          FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id ORDER BY c.severity DESC, c.poc_name`, []],
      ]);
      const today = istDateString();
      let rows = all.rows.map((r) => { const last = [r.last_note, r.last_done].filter(Boolean).sort().pop(); return { ...r, last: last ? String(last).slice(0, 10) : null }; });
      if (ids) rows = rows.filter((r) => ids.includes(r.id));
      let rule = '';
      if (high) { rows = rows.filter((r) => r.severity === 3); rule = ' (high severity)'; }
      if (stageWord) { rows = rows.filter((r) => r.status === stageWord); rule = ` (stage: ${stageWord})`; }
      if (notContacted) {
        if (days) { rows = rows.filter((r) => r.status !== 'lost' && (!r.last || ST.daysBetween(r.last, today) > days)); rule = ` (no logged call or completed task for ${days}+ days)`; }
        else { rows = rows.filter((r) => !r.last && r.status !== 'lost'); rule = ' (no call note and no completed follow-up ever logged)'; }
      }
      const total = stages.rows.reduce((a, r) => a + Number(r.n), 0);
      const filtered = !!(ids || high || stageWord || notContacted);
      const stageSummary = `${plural(total, 'contact')}: ${stages.rows.map((r) => `${n(r.n)} ${r.status}`).join(', ')}.`;
      return table({ title: ids ? `Client — ${c.client.label}` : filtered ? `Clients${rule}` : 'Clients pipeline', summary: filtered ? `${plural(rows.length, 'contact')}${rule}.` : stageSummary,
        columns: [col('poc_name', 'Contact'), col('company', 'Company'), col('status', 'Status'), col('severity', 'Severity'), col('last', 'Last touch', 'date'), col('open_tasks', 'Open tasks', 'int')],
        rows: rows.slice(0, CAP).map((r) => ({ poc_name: r.poc_name, company: r.company || '—', status: r.status, severity: ['', 'Low', 'Medium', 'High'][r.severity] || r.severity, last: r.last || 'never', open_tasks: Number(r.open_tasks) })), total: rows.length, truncated: rows.length > CAP,
        note: 'Names, companies, stages and dates only (no emails or phone numbers). Last touch = latest call note or completed follow-up.', link: { path: '/clients', label: 'Open Clients' } });
    },
  },
  {
    key: 'client_notes', label: 'Client notes & call history', entity: 'client', required: true,
    about: 'The call notes and recent follow-up history logged for ONE named client or company, "show me notes on Rotomotive", "what did we discuss with Sansui", "last call with Gelco".',
    keywords: ['notes', 'discussed', 'last call', 'call history', 'spoke'],
    async run(c) {
      const ids = c.client.ids; const ph = ids.map(() => '?').join(',');
      const [notes, done] = await readBatch([
        [`SELECT n.body, n.created_by, n.created_at, c.poc_name FROM crm_notes n JOIN crm_contacts c ON c.id = n.contact_id WHERE n.contact_id IN (${ph}) ORDER BY n.created_at DESC LIMIT 10`, ids],
        [`SELECT t.title, t.completed_at, t.assigned_to, c.poc_name FROM crm_tasks t JOIN crm_contacts c ON c.id = t.contact_id WHERE t.contact_id IN (${ph}) AND t.status = 'done' ORDER BY t.completed_at DESC LIMIT 5`, ids],
      ]);
      const rows = [
        ...notes.rows.map((r) => ({ when: String(r.created_at).slice(0, 10), kind: 'Note', by: r.created_by || '—', text: `${c.client.ids.length > 1 ? `${r.poc_name}: ` : ''}${r.body}` })),
        ...done.rows.map((r) => ({ when: String(r.completed_at).slice(0, 10), kind: 'Done', by: r.assigned_to || '—', text: r.title })),
      ].sort((a, b) => b.when.localeCompare(a.when));
      return table({ title: `Notes — ${c.client.label}`, summary: notes.rows.length ? `${plural(notes.rows.length, 'note')} logged; latest ${notes.rows[0].created_at.slice(0, 10)} by ${notes.rows[0].created_by || 'unknown'}.` : `No call notes are logged for ${c.client.label}.`,
        columns: [col('when', 'When', 'date'), col('kind', 'Type'), col('by', 'By'), col('text', 'Note')], rows, link: { path: '/clients', label: 'Open Clients' } });
    },
  },
  {
    key: 'stock_cover', label: 'Days of stock cover', entity: 'item', required: false,
    about: 'How long current stock will last at the recent shipping rate (days of cover and an estimated run-out date), for ONE item or ranked across items, "will BLDC CARD run out soon", "which items will run out in 30 days", "how long will our stock last".',
    keywords: ['run out', 'last how long', 'days of stock', 'cover', 'runway', 'how long will', 'stock last', 'reorder soon'],
    async run(c) {
      const today = istDateString();
      const r = await ST.stockCover({ store: c.store, itemCode: c.item ? c.item.code : null, today });
      const fmt = (x) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
      const low = r.rows.filter((x) => x.orders > 0 && x.orders < 3).length;
      const note = `Estimate: stock ÷ average pieces shipped per day over the last ${r.days} days of shipments (history starts ${r.history} days ago). Shipments are lumpy, so treat it as a rough guide${c.item ? '' : '; items with fewer than 3 orders in the window are low-confidence'}.`;
      if (c.item) {
        const x = r.rows.find((y) => y.item_code === c.item.code);
        const store = c.store && c.store !== 'all' ? ` at ${E.STORE_NAME[c.store]}` : '';
        if (!x) return table({ title: `Stock cover — ${c.item.code}`, summary: `No stock of ${c.item.code}${store} and no shipments in the last ${r.days} days.`, columns: [], rows: [], note });
        const summary = x.stock === 0 ? `${c.item.code} is out of stock${store}.`
          : x.cover_days === null ? `${n(x.stock)} pcs of ${c.item.code} in stock${store}, but nothing shipped in the last ${r.days} days — no run-out estimate possible.`
          : `${n(x.stock)} pcs in stock${store}; at the recent rate (${fmt(x.per_day)} pcs/day from ${plural(x.orders, 'order')}) it lasts about ${n(Math.round(x.cover_days))} days — around ${E.fmtD(x.runout)}.${x.orders < 3 ? ' Few orders, so low confidence.' : ''}`;
        return table({ title: `Stock cover — ${c.item.code}`, summary, columns: [col('item_code', 'Item code'), col('stock', 'In stock', 'int'), col('shipped', `Shipped (${r.days}d)`, 'int'), col('orders', 'Orders', 'int'), col('per_day', 'Pcs/day', 'int'), col('cover', 'Days of cover', 'int')],
          rows: [{ item_code: x.item_code, stock: x.stock, shipped: x.shipped, orders: x.orders, per_day: fmt(x.per_day), cover: x.cover_days === null ? '—' : Math.round(x.cover_days) }], note, link: { path: '/reports/alerts', label: 'Open Dead & Low Stock' } });
      }
      const soon = r.rows.filter((x) => x.cover_days !== null && x.cover_days <= 90).sort((a, b) => a.cover_days - b.cover_days);
      const within30 = soon.filter((x) => x.stock > 0 && x.cover_days <= 30).length, already = soon.filter((x) => x.stock === 0).length;
      const shown = soon.slice(0, CAP);
      const desc = shown.length ? new Map((await queryAll(`SELECT item_code, description FROM items WHERE item_code IN (${shown.map(() => '?').join(',')})`, shown.map((x) => x.item_code))).map((d) => [d.item_code, d.description])) : new Map();
      return table({ title: `Items likely to run out — ${E.STORE_NAME[c.store || 'all']}`, summary: soon.length ? `${plural(within30, 'item')} would run out within 30 days at recent rates; ${plural(soon.length - already, 'item')} within 90 days${already ? `; ${plural(already, 'item')} that shipped recently ${already === 1 ? 'is' : 'are'} already out of stock` : ''}.` : 'No item is projected to run out within 90 days at recent shipping rates.',
        columns: [col('item_code', 'Item code'), col('description', 'Description'), col('stock', 'In stock', 'int'), col('per_day', 'Pcs/day', 'int'), col('cover', 'Days of cover', 'int'), col('runout', 'Runs out ~', 'date')],
        rows: shown.map((x) => ({ item_code: x.item_code, description: desc.get(x.item_code) || '', stock: x.stock, per_day: fmt(x.per_day), cover: Math.round(x.cover_days), runout: x.runout })), total: soon.length, truncated: soon.length > CAP,
        note: `${note}${low ? ` ${low} item${low === 1 ? '' : 's'} had fewer than 3 orders.` : ''}`, link: { path: '/reports/alerts', label: 'Open Dead & Low Stock' } });
    },
  },
  {
    key: 'customer_activity', label: 'Customer ordering pattern', entity: 'customer', required: false,
    about: 'Which customers have gone quiet or stopped ordering compared with their own usual reorder rhythm, or when one customer last ordered and how often, "which customers stopped ordering", "who has not ordered lately", "how often does Gelco order".',
    keywords: ['stopped ordering', 'not ordered', 'gone quiet', 'inactive', 'lapsed', 'churn', 'how often', 'reorder', 'quiet'],
    async run(c) {
      const today = istDateString();
      let rows = await ST.customerRhythm({ today });
      const quietOnly = /stop|quiet|lapse|inactive|not ordered|haven'?t ordered|no order|gone|churn|lost|dormant/.test(c.question.toLowerCase()) && !c.customer;
      if (c.customer) rows = rows.filter((r) => r.key === c.customer.key);
      const quiet = rows.filter((r) => r.status.startsWith('quiet'));
      if (quietOnly) rows = quiet;
      const map = (r) => ({ customer: r.customer, orders: r.orders, last_order: r.last_order, days_since: r.days_since, usual_gap: r.usual_gap === null ? '—' : Math.round(r.usual_gap), status: r.status });
      let summary;
      if (c.customer) { const r = rows[0]; summary = r ? `${r.customer}: ${plural(r.orders, 'order day')}, last on ${E.fmtD(r.last_order)} (${plural(r.days_since, 'day')} ago)${r.usual_gap !== null ? `; they usually reorder every ~${Math.round(r.usual_gap)} days → ${r.status}` : '; too few orders to know a pattern'}.` : `No shipments to ${c.customer.label} yet.`; }
      else summary = quietOnly ? (rows.length ? `${plural(rows.length, 'customer')} look quiet — no order for more than twice their usual gap.` : 'No customer looks quiet right now.') : `${plural(quiet.length, 'customer')} look quiet out of ${rows.length}.`;
      return table({ title: c.customer ? `Ordering pattern — ${c.customer.label}` : quietOnly ? 'Customers gone quiet' : 'Customer ordering pattern', summary,
        columns: [col('customer', 'Customer'), col('orders', 'Order days', 'int'), col('last_order', 'Last order', 'date'), col('days_since', 'Days since', 'int'), col('usual_gap', 'Usual gap (days)', 'int'), col('status', 'Status')], rows: rows.slice(0, CAP).map(map), total: rows.length, truncated: rows.length > CAP,
        note: 'Usual gap = median days between a customer\'s order days (needs 3+ order days). Quiet = no order for more than twice that gap (min 21 days); with fewer orders only 45+ days of silence is flagged. Shipment history starts in April 2026. Internal Gelco Stores movements are excluded.', link: { path: '/notifications', label: 'Open Notifications' } });
    },
  },
];

const BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key, t]));
module.exports = { TOOLS, BY_KEY };
