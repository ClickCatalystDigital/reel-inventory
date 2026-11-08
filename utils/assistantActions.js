// What Ohm AI (chat and MCP) may do, one entry per task. Each action is a plain description of an existing API route:
// the same request the screen sends, so the route's own checks (role, approvals for staff, store rules, the demo guard)
// decide, and nothing about permissions is written twice. utils/actionRunner.js runs them; the chat turns a message into a
// card (fill), MCP passes fields in (check). Every write is confirmed first: a card + Save in chat, propose/confirm in MCP.
// One registry drives Jev's choice (about), the card's fields, validation, the MCP schema and the log.
const E = require('./assistantEntities');
const { queryOne, queryAll, istDateString } = require('../db/schema');
const { ITEM_CATEGORIES } = require('./visibility');
const { PROC_STAGES } = require('./poStages');
const brand = require('./brand');

const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: false, ...extra });
const need = (f) => ({ ...f, required: true });
const ref = (name, label, kind, required = true) => ({ name, label, type: 'ref', ref: kind, required });
const enc = encodeURIComponent;

const partnerWord = brand.partnerStore.split(' ')[0].toLowerCase();
const STORE = { options: [
  { value: 'primary', label: brand.mainStore, words: new RegExp(`\\b(${brand.mainStore.split(' ')[0].toLowerCase()}|ls ?tech|main|primary)( stores?)?\\b`, 'i') },
  { value: 'secondary', label: brand.partnerStore, words: new RegExp(`\\b(${partnerWord}|partner)\\s+stores?\\b|\\bsecondary\\b`, 'i') }] };
const storeName = (v) => STORE.options.find((o) => o.value === v)?.label || v;
const STAGES = ['new', 'contacted', 'qualified', 'customer', 'lost'];
const CLIENT_STATUS = STAGES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), words: new RegExp(`\\b${s === 'customer' ? 'customer|won|converted' : s === 'lost' ? 'lost|dead|not interested' : s}\\b`, 'i') }));
const PROC_STAGE = PROC_STAGES.slice(0, -1).map((s) => ({ value: s, label: s, words: new RegExp(`\\b${{ EQ: 'eq|enquiry|enquired', 'RM Procurement': 'rm|raw material', 'Under Manufacturing': 'manufactur\\w*|production', 'Under QC': 'qc|quality|inspect\\w*', 'In Transit': 'transit|shipped|on the way|dispatched' }[s]}\\b`, 'i') }));
const CATEGORY = ITEM_CATEGORIES.map((c) => ({ value: c, label: c, words: new RegExp(`\\b${c.toLowerCase().replace(/ /g, '\\s+')}s?\\b`, 'i') }));

// "5 reels", "3000 per reel", "at 1.9"…: a field may name the words its number sits next to.
const num = (re) => ({ num: re });
const QTY = /\b(\d[\d,]{0,9})(?![\d.]|st\b|nd\b|rd\b|th\b)\s*(?:k\b)?\s*(?:pcs|pieces|nos|units|qty)?\s*(?:x|×|of)?\s*(?=[A-Z][A-Z0-9-]*\d|[a-z])/;
const PRICE = /(?:\bat|@|₹|\brs\.?|\bprice(?: of| is)?|\brate(?: of| is)?)\s*([\d,]+(?:\.\d+)?)/i;
const CODE = /\b(?!REEL-|BOX-|PRC-|SYS-)([A-Z0-9][A-Z0-9.]*[-/]?[A-Z0-9.-]*\d[A-Z0-9.-]*|[A-Z0-9]*\d[A-Z0-9-]*[A-Z][A-Z0-9-]*)\b/;
const INVOICE = /\b(?:inv(?:oice)?|bill)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]*\d[A-Z0-9/_-]*)/i;
const PO_NO = /\bpo\s*(?:no\.?|number|#)?\s*[:#]?\s*((?!SYS-)[A-Z0-9][A-Z0-9/_-]*\d[A-Z0-9/_-]*)/i;

const ACTIONS = [
  // ---- stock ----
  { key: 'inward_stock', about: 'Receive stock: new reels of an item came in (inward), optionally packed in boxes, at a store. Staff entries go for approval.', risk: 'create',
    fields: [ref('item', 'Item', 'item'), need(field('num_reels', 'Reels', 'number', num(/\b(\d{1,3})\s*(?:new\s+)?reels?\b/i))), field('num_boxes', 'Boxes', 'number', { ...num(/\b(\d{1,3})\s*box(?:es)?\b/i), default: 0 }),
      need(field('store', 'Store', 'enum', { ...STORE, default: 'primary' })), field('notes', 'Batch / notes', 'text', { fill: false })],
    request: (v) => ({ method: 'POST', path: '/api/inward', body: { item_code: v.item, num_reels: Number(v.num_reels), num_boxes: Number(v.num_boxes) || 0, notes: v.notes || '', store_code: v.store } }),
    summary: (v, l) => `Receive ${v.num_reels} reel${v.num_reels == 1 ? '' : 's'} of ${l.item}${Number(v.num_boxes) ? ` in ${v.num_boxes} box${v.num_boxes == 1 ? '' : 'es'}` : ''} at ${storeName(v.store)}`, link: () => '/inward' },

  { key: 'ship_reels', about: 'Ship (outward) reels or boxes to a customer against an invoice number, optionally on their purchase order. Staff entries go for approval.', risk: 'create',
    fields: [need(field('reels', 'Reels / boxes', 'units')), ref('customer', 'Customer', 'company'), need(field('invoice_number', 'Invoice no.', 'text', { pick: INVOICE })), ref('po', 'Customer PO', 'open_po', false), field('notes', 'Notes', 'text', { fill: false })],
    // One shipment per item, the way the Outward page sends a mixed cart: the same invoice on each.
    request: async (v) => {
      const reels = await expandUnits(v.reels);
      const rows = await queryAll(`SELECT reel_number, item_code FROM reels WHERE reel_number IN (${reels.map(() => '?').join(',')})`, reels);
      if (rows.length !== reels.length) throw new Error(`Not found: ${reels.filter((r) => !rows.some((x) => x.reel_number === r)).join(', ')}`);
      const co = await queryOne('SELECT name FROM crm_companies WHERE id = ?', [v.customer]);
      const byItem = {}; rows.forEach((r) => (byItem[r.item_code] ||= []).push(r.reel_number));
      return Object.entries(byItem).map(([item_code, reel_numbers]) => ({ method: 'POST', path: '/api/outward/grouped',
        body: { item_code, reel_numbers, customer_name: co.name, invoice_number: v.invoice_number, outward_type: 'Full', notes: v.notes || '', company_id: v.customer, po_id: v.po || null, store_code: 'primary' } }));
    },
    summary: (v, l) => `Ship ${v.reels} to ${l.customer}, invoice ${v.invoice_number}${l.po ? ` on ${l.po}` : ''}`, link: () => '/outward' },

  { key: 'transfer_stock', about: `Move (transfer) a reel or a whole box from one store to the other (${brand.mainStore} / ${brand.partnerStore}).`, risk: 'change',
    fields: [need(field('unit', 'Reel or box', 'unit')), need(field('to_store', 'To store', 'enum', STORE)), field('notes', 'Notes', 'text', { fill: false })],
    request: (v) => ({ method: 'POST', path: '/api/transfer', body: { kind: v.unit.startsWith('BOX-') ? 'box' : 'reel', number: v.unit, to_store: v.to_store, notes: v.notes || '' } }),
    summary: (v) => `Move ${v.unit} to ${storeName(v.to_store)}`, link: () => '/transfer' },

  { key: 'undo_transfer', about: 'Undo (reverse) a stock transfer made by mistake: the reel goes back to the store it came from.', risk: 'delete',
    fields: [ref('transfer', 'Transfer', 'transfer')],
    request: (v) => ({ method: 'POST', path: '/api/transfer/undo', body: { transfer_id: v.transfer } }),
    summary: (v, l) => `Undo transfer ${l.transfer}`, link: () => '/transfer' },

  { key: 'undo_outward', about: 'Undo (reverse) an outward / shipment entered by mistake: the reel comes back into stock.', risk: 'delete',
    fields: [ref('outward', 'Shipment', 'outward')],
    request: (v) => ({ method: 'POST', path: '/api/outward/undo', body: { outward_id: v.outward } }),
    summary: (v, l) => `Undo shipment ${l.outward}`, link: () => '/outward' },

  { key: 'approve_request', about: "Approve a staff member's pending inward, outward or transfer request (so it is carried out).", risk: 'change',
    fields: [ref('request', 'Request', 'request')],
    request: (v) => ({ method: 'POST', path: `/api/requests/${v.request}/approve`, body: {} }),
    summary: (v, l) => `Approve request ${l.request}`, link: () => '/requests' },

  { key: 'reject_request', about: "Reject (decline) a staff member's pending inward, outward or transfer request, with a reason.", risk: 'change',
    fields: [ref('request', 'Request', 'request'), field('reject_reason', 'Reason', 'text', { pick: /\b(?:because|reason:?|as|since)\s+(.+)$/i })],
    request: (v) => ({ method: 'POST', path: `/api/requests/${v.request}/reject`, body: { reject_reason: v.reject_reason || '' } }),
    summary: (v, l) => `Reject request ${l.request}`, link: () => '/requests' },

  { key: 'reserve_stock', about: "Reserve (set aside, allocate) free stock for a customer purchase order line, so it isn't shipped to anyone else.", risk: 'change',
    fields: [ref('line', 'PO line', 'po_line')],
    request: async (v) => ({ method: 'POST', path: `/api/orders/${(await queryOne('SELECT po_id FROM crm_po_items WHERE id = ?', [v.line])).po_id}/lines/${v.line}/reserve`, body: {} }),
    summary: (v, l) => `Reserve stock for ${l.line}`, link: () => '/orders' },

  { key: 'release_reservation', about: 'Release (un-reserve, free up) the stock reserved for a customer purchase order line.', risk: 'change',
    fields: [ref('line', 'PO line', 'po_line')],
    request: async (v) => ({ method: 'POST', path: `/api/orders/${(await queryOne('SELECT po_id FROM crm_po_items WHERE id = ?', [v.line])).po_id}/lines/${v.line}/release`, body: {} }),
    summary: (v, l) => `Release the reservation on ${l.line}`, link: () => '/orders' },

  // ---- catalog ----
  { key: 'add_item', about: 'Add a new item (part, component) to the catalog with its description and pieces per reel (SPQ).', risk: 'create',
    strip: /^(please )?(add|create|new)( a)?( new)? (item|part|component)( to the catalog(ue)?)?( called| named|:)?/i,
    fields: [need(field('item_code', 'Item code', 'text', { pick: CODE })), need(field('description', 'Description', 'text', { cut: true, drop: [CODE, /\b\d[\d,]*\s*(pcs|pieces)?\s*(per|\/|a|each)\s*reel\b/gi, /\bspq\s*(of|=|:)?\s*\d[\d,]*/gi] })),
      need(field('default_spq', 'Pieces per reel', 'number', num(/(\d[\d,]*)\s*(?:pcs|pieces)?\s*(?:per|\/|a|each)\s*reel|\bspq\s*(?:of|=|:)?\s*(\d[\d,]*)/i))), field('category', 'Category', 'enum', { options: CATEGORY })],
    request: (v) => ({ method: 'POST', path: '/api/items', body: { item_code: v.item_code, description: v.description, default_spq: Number(v.default_spq), category: v.category || null } }),
    summary: (v) => `Add item ${String(v.item_code || '').toUpperCase()}`, link: () => '/catalog' },

  { key: 'edit_item', about: "Change an item's description or pieces per reel (SPQ) in the catalog.", risk: 'change',
    fields: [ref('item', 'Item', 'item'), field('description', 'New description', 'text', { fill: false }), field('default_spq', 'Pieces per reel', 'number', num(/(\d[\d,]*)\s*(?:pcs|pieces)?\s*(?:per|\/|a|each)\s*reel|\b(?:to|=|is)\s+(\d[\d,]*)\b(?![.-])/i))],
    request: async (v) => {
      const it = await queryOne('SELECT * FROM items WHERE item_code = ?', [v.item]);
      return { method: 'PUT', path: `/api/items/${enc(v.item)}`, body: { item_code: it.item_code, description: v.description || it.description, default_spq: Number(v.default_spq) || it.default_spq } };
    },
    summary: (v, l) => `Update item ${l.item}`, link: () => '/catalog' },

  { key: 'set_item_price', about: "Set or change an item's selling rate (price per piece), its HSN code or its GST rate, used on invoices.", risk: 'change',
    fields: [ref('item', 'Item', 'item'), field('sale_rate', 'Rate per piece', 'money', num(/(?:\bat|@|₹|\brs\.?|\bto|\bis)\s*([\d,]+(?:\.\d+)?)\b(?![-\w])/i)), field('hsn_code', 'HSN', 'text', { pick: /\bhsn\s*(?:code)?\s*(?:is|to|:)?\s*(\d{4,8})/i }), field('gst_rate', 'GST %', 'number', num(/\b(\d{1,2})\s*%|\bgst\s*(?:of|to|at|is)?\s*(\d{1,2})/i))],
    request: async (v) => {
      const it = await queryOne('SELECT invoice_name, hsn_code, sale_rate, gst_rate FROM items WHERE item_code = ?', [v.item]);
      return { method: 'PUT', path: `/api/items/${enc(v.item)}/invoice`, body: { invoice_name: it.invoice_name, hsn_code: v.hsn_code || it.hsn_code, sale_rate: v.sale_rate ?? it.sale_rate, gst_rate: v.gst_rate ?? it.gst_rate } };
    },
    summary: (v, l) => `Set ${l.item}${v.sale_rate != null ? ` rate to ${v.sale_rate}` : ' invoice details'}`, link: () => '/catalog' },

  { key: 'archive_item', about: 'Archive (delete, remove) an item from the catalog.', risk: 'delete',
    fields: [ref('item', 'Item', 'item')],
    request: (v) => ({ method: 'DELETE', path: `/api/items/${enc(v.item)}`, body: {} }),
    summary: (v, l) => `Archive item ${l.item}`, link: () => '/catalog' },

  // ---- clients ----
  { key: 'add_client', about: 'Add a new client / lead (a contact person, optionally at a company) to the client list.', risk: 'create',
    strip: /^(please )?(add|create|new)( a)?( new)? (client|lead|contact|customer)(:| called| named)?/i,
    fields: [need(field('poc_name', 'Contact name', 'text', { cut: true })), field('company_name', 'Company', 'text', { pick: /\b(?:from|at|of)\s+([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,4})/ }), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'),
      field('status', 'Stage', 'enum', { options: CLIENT_STATUS, default: 'new' })],
    request: (v) => ({ method: 'POST', path: '/api/clients', body: { poc_name: v.poc_name, company_name: v.company_name || null, phone: v.phone || null, email: v.email || null, status: v.status || 'new' } }),
    summary: (v) => `Add client ${v.poc_name}${v.company_name ? ` (${v.company_name})` : ''}`, link: (r) => `/clients?open=${r.id}` },

  { key: 'log_client_note', about: 'Log a call, meeting or conversation with a client, or a note about what they said or agreed.', risk: 'create',
    strip: /^(please )?(log|note|record|add)( a)? (call|conversation|meeting|chat|note)( with| for| on)?/i,
    fields: [ref('client', 'Client', 'contact'), need(field('body', 'Note', 'longtext'))],
    request: (v) => ({ method: 'POST', path: `/api/clients/${v.client}/notes`, body: { body: v.body } }),
    summary: (v, l) => `Log a note on ${l.client}`, link: (r, v) => `/clients?open=${v.client}` },

  { key: 'set_client_stage', about: "Move a client to another pipeline stage (new, contacted, qualified, customer/won, lost), e.g. we lost a client, or a lead is now qualified.", risk: 'change',
    fields: [ref('client', 'Client', 'contact'), need(field('status', 'Stage', 'enum', { options: CLIENT_STATUS }))],
    request: async (v) => ({ method: 'PUT', path: `/api/clients/${v.client}`, body: { ...(await contactRow(v.client)), status: v.status } }),
    summary: (v, l) => `Move ${l.client} to ${v.status}`, link: (r, v) => `/clients?open=${v.client}` },

  { key: 'set_client_watch', about: "Put a client on (or take them off) the watch list: how worried we are about them (severity 1 normal, 2 keep an eye, 3 watch list).", risk: 'change',
    fields: [ref('client', 'Client', 'contact'), need(field('severity', 'Severity', 'enum', { options: [
      { value: 3, label: 'Watch list', words: /\bon (the )?watch ?list|\bworried|\bhigh\b|\bsevere\b|\b3\b/i },
      { value: 2, label: 'Keep an eye', words: /\bkeep an eye|\bmedium\b|\b2\b/i },
      { value: 1, label: 'Normal', words: /\boff (the )?watch ?list|\bremove\b|\bnormal\b|\bfine\b|\b1\b/i }] }))],
    request: async (v) => ({ method: 'PUT', path: `/api/clients/${v.client}`, body: { ...(await contactRow(v.client)), severity: Number(v.severity) } }),
    summary: (v, l) => `${Number(v.severity) === 3 ? 'Put' : 'Set'} ${l.client} ${Number(v.severity) === 3 ? 'on the watch list' : Number(v.severity) === 2 ? 'to keep an eye' : 'back to normal'}`, link: (r, v) => `/clients?open=${v.client}` },

  { key: 'edit_client', about: "Update a client's contact details: phone number, email or designation.", risk: 'change',
    fields: [ref('client', 'Client', 'contact'), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('designation', 'Designation', 'text', { fill: false })],
    request: async (v) => {
      const c = await contactRow(v.client);
      return { method: 'PUT', path: `/api/clients/${v.client}`, body: { ...c, phone: v.phone || c.phone, email: v.email || c.email, designation: v.designation || c.designation } };
    },
    summary: (v, l) => `Update ${l.client}'s details`, link: (r, v) => `/clients?open=${v.client}` },

  { key: 'delete_client', about: 'Delete a client profile permanently, with its notes and tasks.', risk: 'delete',
    fields: [ref('client', 'Client', 'contact')],
    request: (v) => ({ method: 'DELETE', path: `/api/clients/${v.client}`, body: {} }),
    summary: (v, l) => `Delete client ${l.client}`, link: () => '/clients' },

  // ---- tasks ----
  { key: 'add_task', about: 'Add a task or follow-up (to call, send, check something) with a due date, for yourself or a colleague, optionally about a client.', risk: 'create',
    strip: /^(please )?(add|create|set|make)( a)?( new)? (task|to-?do|follow[- ]?up|reminder)( to| for)?|^(please )?remind (me|\w+) to/i,
    fields: [need(field('title', 'Task')), need(field('due_date', 'Due', 'date', { when: 'future', default: 'today' })), ref('client', 'Client', 'contact', false), ref('assignee', 'For', 'user', false)],
    request: (v) => ({ method: 'POST', path: '/api/tasks', body: { title: v.title, due_date: v.due_date, contact_id: v.client || null, assigned_to: v.assignee || null } }),
    summary: (v) => `Add task “${v.title}” due ${v.due_date}`, link: () => '/' },

  { key: 'complete_task', about: 'Mark an open task or follow-up as done (completed).', risk: 'change',
    fields: [ref('task', 'Task', 'task')],
    request: (v) => ({ method: 'POST', path: `/api/tasks/${v.task}/done`, body: {} }),
    summary: (v, l) => `Mark “${l.task}” done`, link: () => '/' },

  { key: 'reopen_task', about: 'Reopen a task that was marked done by mistake.', risk: 'change',
    fields: [ref('task', 'Task', 'done_task')],
    request: (v) => ({ method: 'POST', path: `/api/tasks/${v.task}/reopen`, body: {} }),
    summary: (v, l) => `Reopen “${l.task}”`, link: () => '/' },

  { key: 'reschedule_task', about: 'Move (reschedule, postpone) an open task to another due date.', risk: 'change',
    fields: [ref('task', 'Task', 'task'), need(field('due_date', 'New due date', 'date', { when: 'future' }))],
    request: (v) => ({ method: 'PATCH', path: `/api/tasks/${v.task}`, body: { due_date: v.due_date } }),
    summary: (v, l) => `Move “${l.task}” to ${v.due_date}`, link: () => '/' },

  { key: 'assign_task', about: 'Give (assign, hand over) an open task to a colleague.', risk: 'change',
    fields: [ref('task', 'Task', 'task'), ref('assignee', 'To', 'user')],
    request: (v) => ({ method: 'POST', path: `/api/tasks/${v.task}/assign`, body: { assigned_to: v.assignee } }),
    summary: (v, l) => `Give “${l.task}” to ${l.assignee}`, link: () => '/' },

  { key: 'delete_task', about: 'Delete a task permanently.', risk: 'delete',
    fields: [ref('task', 'Task', 'task')],
    request: (v) => ({ method: 'DELETE', path: `/api/tasks/${v.task}`, body: {} }),
    summary: (v, l) => `Delete task “${l.task}”`, link: () => '/' },

  // ---- customer purchase orders ----
  { key: 'create_po', about: "Record a new purchase order (PO) received from a customer, optionally with its first line (item, quantity, price).", risk: 'create',
    fields: [ref('customer', 'Customer', 'company'), field('po_number', 'PO number (blank = next SYS number)', 'text', { pick: PO_NO }), ref('item', 'Item', 'item', false),
      field('qty', 'Quantity', 'number', num(QTY)), field('unit_price', 'Unit price', 'money', num(PRICE)), field('expected_dispatch_date', 'Dispatch by', 'date', { when: 'future' })],
    request: (v) => ({ method: 'POST', path: '/api/po', body: { company_id: v.customer, po_number: v.po_number || undefined, generate_number: !v.po_number,
      expected_dispatch_date: v.expected_dispatch_date || null, order_date: istDateString(), items: v.item && v.qty ? [{ item_code: v.item, quantity_ordered: Number(v.qty), unit_price: v.unit_price ?? null }] : [] } }),
    summary: (v, l) => `New PO ${v.po_number || '(next SYS number)'} from ${l.customer}${v.item && v.qty ? `: ${v.qty} × ${l.item}` : ''}`, link: () => '/orders' },

  { key: 'add_po_line', about: 'Add an item with a quantity (and price) to an existing customer purchase order, e.g. add 3000 of an item to SYS-5.', risk: 'create',
    fields: [ref('po', 'PO', 'open_po'), ref('item', 'Item', 'item'), need(field('qty', 'Quantity', 'number', num(QTY))), field('unit_price', 'Unit price', 'money', num(PRICE))],
    request: (v) => ({ method: 'POST', path: `/api/po/${v.po}/items`, body: { item_code: v.item, quantity_ordered: Number(v.qty), unit_price: v.unit_price ?? null } }),
    summary: (v, l) => `Add ${v.qty} × ${l.item} to ${l.po}`, link: () => '/orders' },

  { key: 'confirm_po', about: 'Confirm a draft customer purchase order (it has been checked and accepted).', risk: 'change',
    fields: [ref('po', 'PO', 'draft_po')],
    request: (v) => ({ method: 'POST', path: `/api/po/${v.po}/confirm`, body: {} }),
    summary: (v, l) => `Confirm ${l.po}`, link: () => '/orders' },

  { key: 'dispatch_po', about: 'Mark a confirmed customer purchase order as dispatched (fully shipped / delivered).', risk: 'change',
    fields: [ref('po', 'PO', 'confirmed_po'), need(field('dispatch_date', 'Dispatched on', 'date', { default: 'today' }))],
    request: (v) => ({ method: 'POST', path: `/api/po/${v.po}/dispatch`, body: { dispatch_date: v.dispatch_date } }),
    summary: (v, l) => `Mark ${l.po} dispatched on ${v.dispatch_date}`, link: () => '/orders' },

  { key: 'set_po_dispatch_date', about: 'Change the expected dispatch date (delivery date, deadline) of a customer purchase order.', risk: 'change',
    fields: [ref('po', 'PO', 'open_po'), need(field('expected_dispatch_date', 'Dispatch by', 'date', { when: 'future' }))],
    request: async (v) => {
      const p = await queryOne('SELECT company_id, contact_id, order_date, notes FROM crm_purchase_orders WHERE id = ?', [v.po]);
      return { method: 'PATCH', path: `/api/po/${v.po}`, body: { ...p, expected_dispatch_date: v.expected_dispatch_date } };
    },
    summary: (v, l) => `Set ${l.po} dispatch date to ${v.expected_dispatch_date}`, link: () => '/orders' },

  { key: 'add_dispatch_lot', about: 'Plan or record a dispatch lot: a quantity of one item on a customer PO going out on a date (part delivery).', risk: 'create',
    fields: [ref('line', 'PO line', 'po_line'), need(field('qty', 'Quantity', 'number', num(QTY))), field('dispatch_date', 'Dispatch date', 'date', { when: 'future', default: 'today' })],
    request: async (v) => {
      const l = await queryOne('SELECT po_id, item_code FROM crm_po_items WHERE id = ?', [v.line]);
      return { method: 'POST', path: '/api/orders/dispatches', body: { po_id: l.po_id, item_code: l.item_code, quantity: Number(v.qty), dispatch_date: v.dispatch_date || null } };
    },
    summary: (v, l) => `Dispatch lot: ${v.qty} of ${l.line}`, link: () => '/orders' },

  { key: 'cancel_po', about: 'Cancel a customer purchase order that will not go ahead (releases its reserved stock).', risk: 'delete',
    fields: [ref('po', 'PO', 'open_po')],
    request: (v) => ({ method: 'POST', path: `/api/po/${v.po}/cancel`, body: {} }),
    summary: (v, l) => `Cancel ${l.po}`, link: () => '/orders' },

  // ---- procurement (buying from suppliers) ----
  { key: 'create_procurement', about: 'Order stock from a supplier: a new procurement (purchase) order for an item and quantity, as a draft.', risk: 'create',
    fields: [need(field('supplier', 'Supplier', 'text', { pick: /\b(?:from|with)\s+([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,4})/ })), ref('item', 'Item', 'item'), need(field('qty', 'Quantity', 'number', num(QTY))),
      field('unit_cost', 'Unit cost', 'money', num(PRICE)), field('expected_date', 'Expected by', 'date', { when: 'future' })],
    request: (v) => ({ method: 'POST', path: '/api/procurement', body: { supplier: v.supplier, expected_date: v.expected_date || null, items: [{ item_code: v.item, qty: Number(v.qty), unit_cost: v.unit_cost ?? null }] } }),
    summary: (v, l) => `Order ${v.qty} × ${l.item} from ${v.supplier}`, link: () => '/orders#procurement' },

  { key: 'set_procurement_stage', about: 'Update the stage of an item on a procurement order from the supplier (enquiry, raw material, manufacturing, QC, in transit).', risk: 'change',
    fields: [ref('proc_item', 'Procurement item', 'proc_item'), need(field('stage', 'Stage', 'enum', { options: PROC_STAGE }))],
    request: async (v) => ({ method: 'PUT', path: `/api/procurement/${(await queryOne('SELECT proc_id FROM procurement_items WHERE id = ?', [v.proc_item])).proc_id}/items/${v.proc_item}/stage`, body: { stage: v.stage } }),
    summary: (v, l) => `Set ${l.proc_item} to ${v.stage}`, link: () => '/orders#procurement' },

  { key: 'cancel_procurement', about: 'Cancel a procurement (supplier purchase) order that will not go ahead.', risk: 'delete',
    fields: [ref('proc', 'Procurement order', 'proc')],
    request: (v) => ({ method: 'POST', path: `/api/procurement/${v.proc}/cancel`, body: {} }),
    summary: (v, l) => `Cancel ${l.proc}`, link: () => '/orders#procurement' },

  // ---- documents (supplier bills read by AI, waiting for review) ----
  { key: 'approve_document', about: 'Approve a supplier bill or document (purchase invoice, bill of entry, freight bill) waiting for review, so it is posted to the accounts.', risk: 'change',
    fields: [ref('doc', 'Document', 'document'), field('notes', 'Note', 'text', { fill: false })],
    request: (v) => ({ method: 'POST', path: `/api/invoices/${v.doc}/approve`, body: { notes: v.notes || '' } }),
    summary: (v, l) => `Approve ${l.doc}`, link: () => '/docs' },

  { key: 'reject_document', about: 'Reject a supplier bill or document (purchase invoice, bill of entry, freight bill) waiting for review.', risk: 'change',
    fields: [ref('doc', 'Document', 'document'), field('notes', 'Reason', 'text', { pick: /\b(?:because|reason:?|as|since)\s+(.+)$/i })],
    request: (v) => ({ method: 'POST', path: `/api/invoices/${v.doc}/reject`, body: { notes: v.notes || '' } }),
    summary: (v, l) => `Reject ${l.doc}`, link: () => '/docs' },
];
const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));

// ---------- finding records in the words ----------
async function contactRow(id) {
  const c = await queryOne('SELECT poc_name, designation, email, phone, status, product_id, severity FROM crm_contacts WHERE id = ?', [id]);
  if (!c) throw new Error('That client no longer exists');
  return c;
}
// Rank rows by the question's distinctive words, weighted by rarity; a prefix match ("bansal" / "bansals") counts.
function rank(question, rows, text) {
  const toks = [...new Set(E.distinctive(question).filter((t) => t.length >= 2))];
  if (!toks.length || !rows.length) return [];
  const hay = rows.map((r) => ({ r, w: new Set(E.words(text(r))) }));
  const match = (w, t) => w.has(t) || (t.length >= 4 && [...w].some((x) => x.length >= 4 && (x.startsWith(t) || t.startsWith(x))));
  const N = rows.length;
  const idf = new Map(toks.map((t) => [t, Math.log((N + 1) / ((hay.filter((h) => match(h.w, t)).length) || N + 1)) + 1]));
  return hay.map((h) => ({ r: h.r, score: toks.reduce((a, t) => a + (match(h.w, t) ? idf.get(t) : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}
const top5 = (ranked, label, id = (r) => r.id) => ranked.slice(0, 5).map((x) => ({ id: id(x.r), label: label(x.r), score: x.score }));
const hashNo = (q, word) => (new RegExp(`(?:\\b${word}\\s*(?:no\\.?|number)?\\s*#?|#)(\\d{1,6})\\b`, 'i').exec(q) || [])[1];
const byNumber = (rows, n, label) => { const r = n && rows.find((x) => x.id === Number(n)); return r ? [{ id: r.id, label: label(r), score: 99 }] : null; };
const poLabel = (r) => `${r.po_number} · ${r.company || '—'} (${r.status})`;
const PO_SQL = (where) => `SELECT p.id, p.po_number, p.status, co.name AS company FROM crm_purchase_orders p LEFT JOIN crm_companies co ON co.id = p.company_id WHERE ${where} ORDER BY p.id DESC`;
const poFinder = (where) => async (q) => {
  const rows = await queryAll(PO_SQL(where));
  const exact = (await E.poCandidates(q)).filter((c) => rows.some((r) => r.id === c.id));
  if (exact.length) return exact.map((c) => ({ id: c.id, label: poLabel(rows.find((r) => r.id === c.id)), score: 50 }));
  return top5(rank(q, rows, (r) => `${r.po_number} ${r.company || ''}`), poLabel);
};
const taskFinder = (status) => async (q) => {
  const rows = await queryAll(`SELECT t.id, t.title, t.due_date, t.assigned_to, co.name AS company, c.poc_name FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id
    LEFT JOIN crm_companies co ON co.id = c.company_id WHERE t.status = ? ORDER BY t.due_date`, [status]);
  return top5(rank(q, rows, (r) => `${r.title} ${r.company || ''} ${r.poc_name || ''}`), (r) => `${r.title}${r.company && !r.title.includes(r.company) ? ` · ${r.company}` : ''} (${r.due_date})`);
};
const unitOf = (q) => { const r = E.reelBox(q); return r.reel || r.box; };

const FIND = {
  item: async (q) => {
    const c = await E.itemCandidates(q);
    // a word that IS an item code wins outright ("6 reels of BC857B": the 6 and 2 also hit codes)
    const ws = new Set(E.words(q).map((w) => w.toUpperCase()));
    const exact = c.filter((x) => ws.has(x.code.toUpperCase()));
    return (exact.length === 1 ? exact : c).map((x) => ({ id: x.code, label: `${x.code} — ${x.label}`, score: x.score }));
  },
  company: async (q) => top5(rank(q, await queryAll('SELECT id, name FROM crm_companies'), (r) => E.normalizeCustomer(r.name)), (r) => r.name),
  contact: async (q) => top5(rank(q, await queryAll('SELECT c.id, c.poc_name, co.name AS company FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id'),
    (r) => `${r.poc_name} ${E.normalizeCustomer(r.company || '')}`), (r) => `${r.poc_name}${r.company ? ` · ${r.company}` : ''}`),
  user: async (q) => {
    const users = await queryAll("SELECT username FROM users WHERE role IN ('admin', 'manager', 'user')");
    const w = new Set(E.words(q));
    return users.filter((u) => w.has(u.username.toLowerCase())).map((u) => ({ id: u.username, label: u.username, score: 10 }));
  },
  task: taskFinder('open'),
  done_task: taskFinder('done'),
  open_po: poFinder("p.status NOT IN ('dispatched', 'cancelled')"),
  draft_po: poFinder("p.status = 'draft'"),
  confirmed_po: poFinder("p.status = 'confirmed'"),
  po_line: async (q) => {
    const rows = await queryAll(`SELECT pi.id, pi.item_code, pi.quantity_ordered, p.po_number, co.name AS company FROM crm_po_items pi JOIN crm_purchase_orders p ON p.id = pi.po_id
      LEFT JOIN crm_companies co ON co.id = p.company_id WHERE p.status NOT IN ('dispatched', 'cancelled', 'draft')`);
    const pos = (await E.poCandidates(q)).map((c) => c.po_number);
    const code = (await E.itemCandidates(q))[0];
    const pool = pos.length ? rows.filter((r) => pos.includes(r.po_number)) : rows;
    const label = (r) => `${r.item_code} × ${r.quantity_ordered} on ${r.po_number} · ${r.company || '—'}`;
    const exact = code ? pool.filter((r) => r.item_code === code.code) : [];
    if (exact.length) return exact.map((r) => ({ id: r.id, label: label(r), score: 50 }));
    return top5(rank(q, pool, (r) => `${r.po_number} ${r.item_code} ${E.normalizeCustomer(r.company || '')}`), label);
  },
  request: async (q) => {
    const rows = await queryAll("SELECT id, type, created_by, payload FROM requests WHERE status = 'pending' ORDER BY id");
    const label = (r) => { const p = JSON.parse(r.payload || '{}'); return `#${r.id} ${r.type} ${p.item_code || p.number || ''}${p.num_reels ? ` × ${p.num_reels} reels` : p.reel_numbers ? ` × ${p.reel_numbers.length} reels` : ''} · ${r.created_by}`.replace(/\s+/g, ' '); };
    const n = byNumber(rows, hashNo(q, 'request'), label);
    if (n) return n;
    const ranked = top5(rank(q, rows, (r) => { const p = JSON.parse(r.payload || '{}'); return `${r.type} ${r.type}s ${r.type === 'outward' ? 'shipment ship' : r.type === 'inward' ? 'receipt receive' : 'move'} ${r.created_by} ${p.item_code || ''} ${p.number || ''} ${p.customer_name || ''} ${(p.reel_numbers || []).join(' ')}`; }), label);
    // "approve the pending request" with only one waiting: that one
    return ranked.length ? ranked : rows.length === 1 && /\brequest\b/i.test(q) ? [{ id: rows[0].id, label: label(rows[0]), score: 1 }] : [];
  },
  transfer: async (q) => {
    const u = unitOf(q);
    const label = (r) => `#${r.id} ${r.reel_number || r.box_number} → ${storeName(r.to_store)} (${String(r.transferred_at).slice(0, 10)})`;
    const rows = u ? await queryAll('SELECT * FROM stock_transfers WHERE reel_number = ? OR box_number = ? ORDER BY id DESC LIMIT 5', [u, u])
      : await queryAll('SELECT * FROM stock_transfers ORDER BY id DESC LIMIT 200');
    const n = byNumber(rows, hashNo(q, 'transfer'), label);
    if (n) return n;
    return u ? rows.map((r, i) => ({ id: r.id, label: label(r), score: 10 - i * 5 })) : [];
  },
  outward: async (q) => {
    const u = unitOf(q);
    const label = (r) => `#${r.id} ${r.reel_number} → ${r.customer_name}, ${r.invoice_number} (${String(r.outward_date).slice(0, 10)})`;
    if (!u) { const n = hashNo(q, 'outward|shipment'); const r = n && await queryOne('SELECT * FROM outwards WHERE id = ?', [Number(n)]); return r ? [{ id: r.id, label: label(r), score: 99 }] : []; }
    const rows = await queryAll('SELECT * FROM outwards WHERE reel_number = ? ORDER BY id DESC LIMIT 5', [u]);
    return rows.map((r, i) => ({ id: r.id, label: label(r), score: 10 - i * 5 }));
  },
  proc: async (q) => {
    const rows = await queryAll(`SELECT o.id, o.number, o.supplier, GROUP_CONCAT(i.item_code, ' ') AS items FROM procurement_orders o LEFT JOIN procurement_items i ON i.proc_id = o.id
      WHERE o.status NOT IN ('cancelled', 'closed') GROUP BY o.id`);
    return top5(rank(q.replace(/\bPRC-(\d+)/gi, 'prc $1'), rows, (r) => `${r.number.replace('-', ' ')} ${r.supplier} ${r.items || ''}`), (r) => `${r.number} · ${r.supplier} · ${r.items || ''}`);
  },
  proc_item: async (q) => {
    const rows = await queryAll(`SELECT i.id, i.item_code, i.qty_ordered, i.stage, o.number, o.supplier FROM procurement_items i JOIN procurement_orders o ON o.id = i.proc_id
      WHERE i.stage != 'Received' AND o.status NOT IN ('cancelled', 'closed')`);
    const label = (r) => `${r.item_code} × ${r.qty_ordered} on ${r.number} (${r.stage}) · ${r.supplier}`;
    const code = (await E.itemCandidates(q))[0];
    const exact = code ? rows.filter((r) => r.item_code === code.code) : [];
    if (exact.length) return exact.map((r) => ({ id: r.id, label: label(r), score: 50 }));
    return top5(rank(q.replace(/\bPRC-(\d+)/gi, 'prc $1'), rows, (r) => `${r.number.replace('-', ' ')} ${r.item_code} ${r.supplier}`), label);
  },
  document: async (q) => {
    const rows = await queryAll("SELECT id, doc_type, invoice_no, party_name FROM crm_invoices WHERE status IN ('pending', 'under_review') AND deleted_at IS NULL");
    const label = (r) => `${r.doc_type.replace(/_/g, ' ')} ${r.invoice_no || `#${r.id}`} · ${r.party_name || '—'}`;
    const ranked = top5(rank(q, rows, (r) => `${r.doc_type.replace(/_/g, ' ')} ${r.invoice_no || ''} ${r.party_name || ''} bill`), label);
    return ranked;
  },
};
// The label of a record by its id (refs passed as an id, from a card or MCP); null if there is no such record.
const LABEL = {
  item: async (v) => { const r = await queryOne("SELECT item_code, description FROM items WHERE item_code = ? AND status != 'Deleted'", [String(v)]); return r && `${r.item_code} — ${r.description}`; },
  company: async (v) => (await queryOne('SELECT name FROM crm_companies WHERE id = ?', [v]))?.name,
  contact: async (v) => { const r = await queryOne('SELECT c.poc_name, co.name AS company FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = ?', [v]); return r && `${r.poc_name}${r.company ? ` · ${r.company}` : ''}`; },
  user: async (v) => (await queryOne("SELECT username FROM users WHERE username = ? AND role IN ('admin', 'manager', 'user')", [String(v)]))?.username,
  task: async (v) => (await queryOne("SELECT title FROM crm_tasks WHERE id = ? AND status = 'open'", [v]))?.title,
  done_task: async (v) => (await queryOne("SELECT title FROM crm_tasks WHERE id = ? AND status = 'done'", [v]))?.title,
  open_po: async (v) => { const r = await queryOne(`${PO_SQL("p.id = ? AND p.status NOT IN ('dispatched', 'cancelled')")}`, [v]); return r && poLabel(r); },
  draft_po: async (v) => { const r = await queryOne(PO_SQL("p.id = ? AND p.status = 'draft'"), [v]); return r && poLabel(r); },
  confirmed_po: async (v) => { const r = await queryOne(PO_SQL("p.id = ? AND p.status = 'confirmed'"), [v]); return r && poLabel(r); },
  po_line: async (v) => { const r = await queryOne('SELECT pi.item_code, pi.quantity_ordered, p.po_number FROM crm_po_items pi JOIN crm_purchase_orders p ON p.id = pi.po_id WHERE pi.id = ?', [v]); return r && `${r.item_code} × ${r.quantity_ordered} on ${r.po_number}`; },
  request: async (v) => { const r = await queryOne("SELECT id, type FROM requests WHERE id = ? AND status = 'pending'", [v]); return r && `#${r.id} ${r.type}`; },
  transfer: async (v) => { const r = await queryOne('SELECT id, reel_number, box_number, to_store FROM stock_transfers WHERE id = ?', [v]); return r && `#${r.id} ${r.reel_number || r.box_number} → ${storeName(r.to_store)}`; },
  outward: async (v) => { const r = await queryOne('SELECT id, reel_number, customer_name FROM outwards WHERE id = ?', [v]); return r && `#${r.id} ${r.reel_number} → ${r.customer_name}`; },
  proc: async (v) => { const r = await queryOne("SELECT number, supplier FROM procurement_orders WHERE id = ? AND status NOT IN ('cancelled', 'closed')", [v]); return r && `${r.number} · ${r.supplier}`; },
  proc_item: async (v) => { const r = await queryOne("SELECT i.item_code, o.number FROM procurement_items i JOIN procurement_orders o ON o.id = i.proc_id WHERE i.id = ? AND i.stage != 'Received'", [v]); return r && `${r.item_code} on ${r.number}`; },
  document: async (v) => { const r = await queryOne("SELECT doc_type, invoice_no, party_name FROM crm_invoices WHERE id = ? AND status IN ('pending', 'under_review')", [v]); return r && `${r.doc_type.replace(/_/g, ' ')} ${r.invoice_no || `#${v}`} · ${r.party_name || '—'}`; },
};
const NUMERIC_REF = (kind) => !['item', 'user'].includes(kind);

// "REEL-10031, REEL-10032 and BOX-1004" → every reel; a box stands for its reels still in stock.
const UNIT_RE = /\b(reel|box)[-\s]?(\d{3,6})\b/gi;
const units = (s) => [...String(s || '').matchAll(UNIT_RE)].map((m) => `${m[1].toUpperCase()}-${m[2]}`);
async function expandUnits(s) {
  const out = [];
  for (const u of units(s)) {
    if (u.startsWith('REEL-')) out.push(u);
    else out.push(...(await queryAll("SELECT reel_number FROM reels WHERE box_number = ? AND status = 'In Stock' ORDER BY reel_number", [u])).map((r) => r.reel_number));
  }
  if (!out.length) throw new Error('No reels to ship: give reel numbers (REEL-10031) or a box (BOX-1004) with stock');
  return [...new Set(out)];
}

const MONEY = /(?:₹|rs\.?|inr|\$|usd)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lac|l)?\b|\b([\d,]+(?:\.\d+)?)\s*(k|lakh|lac|rupees|dollars)\b/i;
function money(q) {
  const m = MONEY.exec(q);
  if (!m) return null;
  const n = Number((m[1] || m[3]).replace(/,/g, '')), u = (m[2] || m[4] || '').toLowerCase();
  return u === 'k' ? n * 1000 : ['lakh', 'lac', 'l'].includes(u) ? n * 100000 : n;
}
const tidy = (t) => { const x = String(t || '').replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;!?-]+$/g, ''); return x.charAt(0).toUpperCase() + x.slice(1); };
const PHONE = /(\+?\d[\d\s-]{8,13}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const WD = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'];
const DATE_WORDS = /\b(today|tomorrow|yesterday|(on|by|next|this) (sun|mon|tues|wednes|thurs|fri|satur)day|(sun|mon|tues|wednes|thurs|fri|satur)day|in \d{1,3} (days?|weeks?)|next week|by the \d{1,2}(st|nd|rd|th)?|on the \d{1,2}(st|nd|rd|th)?)\b/gi;

function futureDate(q, day) {
  if (/\btomorrow\b/i.test(q)) return E.add(day, 1);
  if (/\btoday\b/i.test(q)) return day;
  const wd = /\b(sun|mon|tues|wednes|thurs|fri|satur)day\b/i.exec(q);
  if (wd) { const want = WD.indexOf(wd[1].toLowerCase()); const now = new Date(`${day}T00:00:00Z`).getUTCDay(); return E.add(day, ((want - now + 7) % 7) || 7) ; }
  const n = /\bin (\d{1,3}) (day|week)s?\b/i.exec(q);
  if (n) return E.add(day, Number(n[1]) * (n[2].toLowerCase() === 'week' ? 7 : 1));
  if (/\bnext week\b/i.test(q)) return E.add(day, 7);
  const th = /\b(?:by|on) the (\d{1,2})(?:st|nd|rd|th)?\b/i.exec(q);
  if (th) { const d = Number(th[1]); const [y, m] = day.split('-').map(Number); const iso = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`; const here = iso(y, m); return here >= day ? here : m === 12 ? iso(y + 1, 1) : iso(y, m + 1); }
  const p = E.parsePeriod(q, day);
  if (p?.from && p.from >= day) return p.from;
  return null;
}

// One field's value from the person's own words. Refs: a clear winner is picked; otherwise the card offers the top three.
async function fillOne(f, q, day, action) {
  if (f.type === 'ref') {
    const c = await FIND[f.ref](q);
    const win = c[0] && (!c[1] || c[0].score >= 1.4 * c[1].score) ? c[0] : null;
    return win ? { value: win.id, display: win.label } : { value: null, options: c.slice(0, 3).map((x) => ({ value: x.id, label: x.label })) };
  }
  if (f.type === 'date') {
    const d = f.when === 'future' ? futureDate(q, day) : (() => { if (/\byesterday\b/i.test(q)) return E.add(day, -1); const p = E.parsePeriod(q, day); return p?.from && p.from === p.to ? p.from : null; })();
    return { value: d || (f.default === 'today' ? day : null) };
  }
  if (f.type === 'units') { const u = units(q); return { value: u.length ? u.join(', ') : null }; }
  if (f.type === 'unit') return { value: unitOf(q) || null };
  if (f.num) { const m = f.num.exec(q); const raw = m && (m.slice(1).find((x) => x != null)); return { value: raw ? Number(raw.replace(/,/g, '')) * (/\d\s*k\b/i.test(m[0]) ? 1000 : 1) : f.default ?? null }; }
  if (f.type === 'money') return { value: money(q) };
  if (f.type === 'number') { const m = /\b(\d{1,6})\b/.exec(q.replace(UNIT_RE, '')); return { value: m ? Number(m[1]) : f.default ?? null }; }
  if (f.type === 'phone') return { value: PHONE.exec(q)?.[1]?.replace(/[\s-]+/g, '') || null };
  if (f.type === 'email') return { value: EMAIL.exec(q)?.[0] || null };
  if (f.type === 'enum') return { value: f.options.find((o) => o.words.test(q))?.value ?? f.default ?? null };
  if (f.pick) { const m = f.pick.exec(q); const v = m ? (m[1] ?? m[0]) : null; return { value: v ? (f.name === 'item_code' ? v.toUpperCase() : tidy(v).slice(0, 200)) : null }; }
  if (f.fill === false) return { value: f.default ?? null };
  // Free text: the message without its command words, phone, email, dates and record numbers (edited on the card if need be).
  let t = q.replace(/^\s*(hey|please|can you|could you|kindly)[\s,]*/i, '');
  if (action.strip) t = t.replace(action.strip, '');
  t = t.replace(PHONE, '').replace(EMAIL, '').replace(DATE_WORDS, '');
  for (const d of f.drop || []) t = t.replace(d, '');
  if (f.cut) t = t.split(/,|;|\bwho\b|\bfrom\b|\bat\b|\bphone\b|\bemail\b|\bmobile\b/i)[0];
  if (action.key === 'log_client_note') t = t.replace(/^[^:]*:\s*/, (m) => (m.length < 60 ? '' : m)); // "a call with Neha: wants…" → "wants…"
  return { value: tidy(t).slice(0, f.type === 'longtext' ? 1000 : 200) || null };
}

// Chat: the message → a card's fields.
async function fill(key, question, day = istDateString()) {
  const a = ACTION_BY_KEY[key];
  const fields = [];
  for (const f of a.fields) fields.push({ ...publicField(f), ...(await fillOne(f, question, day, a)) });
  return card(a, fields);
}

// MCP and the card's Save: fields given directly (refs as an id or a name) → checked values, or what is missing.
async function check(key, given = {}, day = istDateString()) {
  const a = ACTION_BY_KEY[key];
  if (!a) throw new Error(`Unknown action: ${key}`);
  const fields = [];
  for (const f of a.fields) {
    let v = given?.[f.name];
    if (v === '' || v === undefined) v = null;
    let out = { value: v };
    if (f.type === 'ref' && v != null) {
      const id = NUMERIC_REF(f.ref) && /^\d+$/.test(String(v)) ? Number(v) : v;
      const label = await LABEL[f.ref](id);
      if (label) out = { value: id, display: label };
      else if (NUMERIC_REF(f.ref) && typeof id === 'number') out = { value: null, error: `No ${f.label.toLowerCase()} with id ${v} (or it is closed)` };
      else { out = await fillOne(f, String(v), day, a); if (out.value == null) out.error = `${f.label}: no match for “${v}”`; }
    } else if (f.type === 'enum' && v != null && !f.options.some((o) => String(o.value) === String(v))) {
      const hit = f.options.find((o) => o.words.test(String(v)) || o.label.toLowerCase() === String(v).toLowerCase());
      out = hit ? { value: hit.value } : { value: null, error: `${f.label} must be one of: ${f.options.map((o) => o.value).join(', ')}` };
    } else if (f.type === 'enum' && v != null) out = { value: f.options.find((o) => String(o.value) === String(v)).value };
    else if (v == null && f.default != null) out = { value: f.default === 'today' ? day : f.default };
    else if (['money', 'number'].includes(f.type) && v != null && (!Number.isFinite(Number(v)) || Number(v) < 0)) out = { value: null, error: `${f.label} must be a number` };
    else if (['money', 'number'].includes(f.type) && v != null) out = { value: Number(v) };
    else if (f.type === 'date' && v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out = { value: null, error: `${f.label} must be a date (YYYY-MM-DD)` };
    else if (f.type === 'unit' && v != null) { const u = unitOf(String(v)); out = u ? { value: u } : { value: null, error: `${f.label} must be a reel or box number (REEL-10031 / BOX-1004)` }; }
    else if (f.type === 'units' && v != null) { const u = units(String(v)); out = u.length ? { value: u.join(', ') } : { value: null, error: `${f.label} must list reel or box numbers (REEL-10031, BOX-1004)` }; }
    else if (v != null) out = { value: String(v).trim().slice(0, f.type === 'longtext' ? 1000 : 200) };
    fields.push({ ...publicField(f), ...out });
  }
  return card(a, fields);
}

const publicField = ({ name, label, type, required, ref: r, options }) => ({ name, label, type, required, ...(r ? { ref: r } : {}),
  ...(options ? { options: options.map((o) => ({ value: o.value, label: o.label })) } : {}) });

function card(a, fields) {
  const values = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  // What the summary says for each field: a record's name for refs (the part before " — " / " (" for readability), the value otherwise.
  const labels = Object.fromEntries(fields.map((f) => [f.name, f.type === 'ref' ? String(f.display || '').split(' — ')[0].split(' · ')[0].replace(/ \([^)]*\)$/, '') : f.value]));
  const missing = fields.filter((f) => f.required && (f.value == null || f.value === '')).map((f) => f.name);
  const errors = fields.filter((f) => f.error).map((f) => f.error);
  let summary = a.key;
  try { summary = a.summary(values, labels); } catch { /* fields still missing */ }
  return { action: a.key, risk: a.risk, about: a.about, summary: brand.text(summary), fields, values, missing, errors, ready: !missing.length && !errors.length };
}

module.exports = { ACTIONS, ACTION_BY_KEY, fill, check, FIND };
