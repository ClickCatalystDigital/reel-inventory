// LS AI — the read-only look-ups. Each tool: { key, label, about (what Jev reads to choose it), entity, run(ctx) }.
// The model only CHOOSES a tool; every value used in SQL is a bound parameter resolved by code (utils/assistantEntities.js).
// Data quirks encoded here, not left to a model: Deleted reels excluded; reels.quantity is 0 once Outwarded/Deleted (shipped qty
// comes from outwards.quantity_shipped); primary = LS Tech Stores, secondary = Gelco Stores; low stock = fewer than 5 in-stock
// reels; dead stock = no outward in 30 days; customer spellings are merged by normalizeCustomer(); IST naive timestamps and
// string date bounds only (never SQLite date()).
const { queryAll, queryOne, readBatch, istDateString, istDayBounds } = require('../db/schema');
const { getDailyReportData } = require('./dailyReport');
const E = require('./assistantEntities');

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
    key: 'inward_history', label: 'Stock received (inward)', entity: 'item', required: false, period: true,
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
    key: 'outward_by_customer', label: 'Shipments to customers', entity: 'customer', required: false, period: true,
    about: 'What was shipped (outward) to customers in a period, per customer or for one named customer, "what did we ship to Gelco Electronics in September", "top customers this year", "last shipment to Sansui".',
    keywords: ['shipped', 'shipments', 'outward', 'sold', 'sent to', 'customer', 'dispatched to', 'delivered'],
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
    key: 'stock_transfers', label: 'Stock transfers between stores', entity: 'item', required: false, period: true,
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
    about: 'The daily activity numbers for one day (inward, outward, transfers, pending approvals), "today\'s numbers", "what happened yesterday", "daily report for 2 Oct".',
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
    key: 'pending_requests', label: 'Approval requests', entity: null,
    about: 'Requests from staff waiting for approval, or approved/rejected ones, "any approvals waiting", "what did sahil submit", "rejected requests".',
    keywords: ['approval', 'approvals', 'pending request', 'requests', 'waiting for approval', 'rejected'],
    async run(c) {
      const q = c.question.toLowerCase(); const status = /\brejected\b/.test(q) ? 'rejected' : /\bapproved\b/.test(q) ? 'approved' : 'pending';
      const rows = await queryAll('SELECT id, type, created_by, created_at, payload FROM requests WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, CAP]);
      const out = rows.map((r) => {
        let p = {}; try { p = JSON.parse(r.payload); } catch { /* keep empty */ }
        const what = r.type === 'inward' ? `${p.num_reels || '?'} reels of ${p.item_code}` : r.type === 'outward' ? `${(p.reel_numbers || [p.reel_number]).filter(Boolean).length} reel(s) to ${p.customer_name || '?'}` : `${p.kind || ''} ${p.number || ''} → ${E.STORE_NAME[p.to_store] || p.to_store || ''}`;
        return { id: r.id, type: r.type, by: r.created_by, what, at: String(r.created_at).slice(0, 16) };
      });
      return table({ title: `Requests — ${status}`, summary: out.length ? `${plural(out.length, status + ' request')}.` : `No ${status} requests.`, columns: [col('id', '#', 'int'), col('type', 'Type'), col('by', 'By'), col('what', 'What'), col('at', 'When', 'date')], rows: out, link: { path: '/requests', label: 'Open Requests' } });
    },
  },
  {
    key: 'purchase_orders', label: 'Purchase orders', entity: 'po', required: false,
    about: 'Customer purchase orders: by status (draft, confirmed, dispatched, cancelled), for a customer, or one PO by number with its lines and how much has shipped, "which POs are confirmed but not dispatched", "status of PO P0055838".',
    keywords: ['purchase order', 'purchase orders', 'po status', 'confirmed po', 'dispatched po', 'open po'],
    async run(c) {
      if (c.po) {
        const [items, shipped] = await readBatch([
          ['SELECT item_code, quantity_ordered FROM crm_po_items WHERE po_id = ?', [c.po.id]],
          ['SELECT r.item_code, SUM(o.quantity_shipped) AS qty FROM outwards o JOIN reels r ON r.reel_number = o.reel_number WHERE o.po_id = ? GROUP BY r.item_code', [c.po.id]],
        ]);
        const sh = new Map(shipped.rows.map((r) => [r.item_code, Number(r.qty)]));
        const rows = items.rows.map((i) => ({ item_code: i.item_code || '(unmatched line)', ordered: Number(i.quantity_ordered) || 0, shipped: sh.get(i.item_code) || 0 }));
        return table({ title: `PO ${c.po.po_number}`, summary: `${c.po.po_number} — ${c.po.status}${c.po.company ? ` — ${c.po.company}` : ''}; ${plural(rows.length, 'line')}.`, columns: [col('item_code', 'Item code'), col('ordered', 'Ordered', 'int'), col('shipped', 'Shipped', 'int')], rows, note: 'Shipped = outwards tied to this PO.' });
      }
      const q = c.question.toLowerCase(); const status = ['draft', 'confirmed', 'dispatched', 'cancelled'].find((s) => q.includes(s)) || (/\bopen\b|\bnot dispatched\b|\bpending\b/.test(q) ? 'confirmed' : null);
      const cust = c.customer ? ` AND co.name IN (${c.customer.variants.map(() => '?').join(',')})` : '';
      const rows = await queryAll(`SELECT p.po_number, p.status, co.name AS company, p.order_date, p.expected_dispatch_date, (SELECT COUNT(*) FROM crm_po_items i WHERE i.po_id = p.id) AS lines
        FROM crm_purchase_orders p LEFT JOIN crm_companies co ON co.id = p.company_id WHERE 1=1${status ? ' AND p.status = ?' : ''}${cust} ORDER BY p.id DESC LIMIT ?`, [...(status ? [status] : []), ...(c.customer ? c.customer.variants : []), CAP]);
      const counts = await queryAll('SELECT status, COUNT(*) AS n FROM crm_purchase_orders GROUP BY status');
      return table({ title: `Purchase orders${status ? ` — ${status}` : ''}`, summary: `${plural(rows.length, 'PO')} shown. All POs: ${counts.map((r) => `${n(r.n)} ${r.status}`).join(', ')}.`,
        columns: [col('po_number', 'PO'), col('status', 'Status'), col('company', 'Customer'), col('order_date', 'Ordered', 'date'), col('expected_dispatch_date', 'Dispatch by', 'date'), col('lines', 'Lines', 'int')],
        rows: rows.map((r) => ({ ...r, lines: Number(r.lines), order_date: r.order_date || '—', expected_dispatch_date: r.expected_dispatch_date || '—', company: r.company || '—' })), link: { path: '/outward', label: 'Open Outward' } });
    },
  },
  {
    key: 'tasks', label: 'Tasks', entity: 'user', required: false,
    about: 'Follow-up tasks: overdue or open tasks, for a person or for everyone, "what is overdue", "what is on zakir\'s plate", "my tasks".',
    keywords: ['task', 'tasks', 'overdue', 'follow up', 'follow-up', 'to do', 'plate'],
    async run(c) {
      const today = istDateString(); const who = c.users && c.users.length ? c.users : null;
      const whereWho = who ? ` AND t.assigned_to IN (${who.map(() => '?').join(',')})` : '';
      const [cnt, list] = await readBatch([
        [`SELECT COALESCE(t.assigned_to, '(unassigned)') AS who, COUNT(*) AS n, SUM(t.due_date < ?) AS overdue FROM crm_tasks t WHERE t.status = 'open'${whereWho} GROUP BY who ORDER BY n DESC`, [today, ...(who || [])]],
        [`SELECT t.title, t.due_date, COALESCE(t.assigned_to, '(unassigned)') AS who, c.poc_name FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id WHERE t.status = 'open'${whereWho} ORDER BY t.due_date ASC LIMIT ?`, [...(who || []), 15]],
      ]);
      const total = cnt.rows.reduce((a, r) => a + Number(r.n), 0), over = cnt.rows.reduce((a, r) => a + Number(r.overdue), 0);
      return table({ title: `Open tasks${who ? ` — ${who.join(', ')}` : ''}`, summary: `${plural(total, 'open task')} · ${over} overdue.${!who && cnt.rows.length ? ` By person: ${cnt.rows.map((r) => `${r.who} ${n(r.n)}`).join(', ')}.` : ''}`,
        columns: [col('due_date', 'Due', 'date'), col('who', 'Assigned'), col('title', 'Task')], rows: list.rows.map((r) => ({ due_date: r.due_date, who: r.who, title: r.poc_name ? `${r.poc_name} — ${r.title}` : r.title })), note: 'Oldest due first (15 shown).', link: { path: '/', label: 'Open Home' } });
    },
  },
  {
    key: 'clients_pipeline', label: 'Clients pipeline', entity: null,
    about: 'The CRM contacts/clients: how many at each stage (new, contacted, qualified, customer, lost), the high-severity watch list, "how many leads", "who is on the watch list", "clients by stage".',
    keywords: ['clients', 'leads', 'pipeline', 'watch list', 'severity', 'contacts', 'conversion'],
    async run(c) {
      const q = c.question.toLowerCase(); const high = /\bhigh\b|watch|severity 3|critical/.test(q);
      const [stages, list] = await readBatch([
        ['SELECT status, COUNT(*) AS n FROM crm_contacts GROUP BY status', []],
        [`SELECT c.poc_name, co.name AS company, c.status, c.severity FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id${high ? ' WHERE c.severity = 3' : ''} ORDER BY c.severity DESC, c.poc_name LIMIT 15`, []],
      ]);
      const total = stages.rows.reduce((a, r) => a + Number(r.n), 0);
      return table({ title: high ? 'High-severity clients' : 'Clients pipeline', summary: `${plural(total, 'contact')}: ${stages.rows.map((r) => `${n(r.n)} ${r.status}`).join(', ')}.`,
        columns: [col('poc_name', 'Contact'), col('company', 'Company'), col('status', 'Status'), col('severity', 'Severity')], rows: list.rows.map((r) => ({ poc_name: r.poc_name, company: r.company || '—', status: r.status, severity: ['', 'Low', 'Medium', 'High'][r.severity] || r.severity })),
        note: 'Names, companies and stages only (no emails or phone numbers).', link: { path: '/clients', label: 'Open Clients' } });
    },
  },
];

const BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key, t]));
module.exports = { TOOLS, BY_KEY };
