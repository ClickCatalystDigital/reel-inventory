-- Production table layout (structure only, no data), read from the live database's sqlite_master on 2026-10-13.
-- The crm_* tables are owned by ls_crm; the demo database needs them too. Applied by scripts/demo/seed.mjs.

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    updated_at TEXT
  );

CREATE TABLE assistant_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asked_by TEXT,
    at TEXT,
    question TEXT,
    kind TEXT,
    tool TEXT,
    ok INTEGER,
    ms INTEGER,
    cost REAL
  );

CREATE TABLE assistant_usage (
    day TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    reel_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , store_code TEXT NOT NULL DEFAULT 'primary');

CREATE TABLE counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 10000
  );

CREATE TABLE crm_bank_accounts (
  account_no  TEXT PRIMARY KEY,
  bank_ledger TEXT NOT NULL,
  label       TEXT
);

CREATE TABLE crm_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT,
    industry TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE crm_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES crm_companies(id) ON DELETE CASCADE,
    poc_name TEXT NOT NULL,
    designation TEXT,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    product_id INTEGER REFERENCES crm_products(id) ON DELETE SET NULL,
    owner TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , severity INTEGER NOT NULL DEFAULT 1);

CREATE TABLE crm_invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    uploaded_by      TEXT,
    original_filename TEXT,
    doc_type         TEXT DEFAULT 'freight_invoice',
    invoice_no       TEXT,
    invoice_date     TEXT,
    party_name       TEXT,
    party_gstin      TEXT,
    buyer_gstin      TEXT,
    place_of_supply  TEXT,
    mawb_no          TEXT,
    flight_no        TEXT,
    commodity        TEXT,
    origin_airport   TEXT,
    dest_airport     TEXT,
    gross_weight     REAL,
    supplier_ref     TEXT,
    taxable_value    REAL,
    cgst             REAL,
    sgst             REAL,
    igst             REAL,
    total_tax        REAL,
    net_amount       REAL,
    line_items       TEXT DEFAULT '[]',
    tally_xml        TEXT,
    status           TEXT DEFAULT 'pending',
    review_notes     TEXT,
    task_id          INTEGER,
    approved_at      DATETIME,
    pushed_at        DATETIME
  , deleted_at DATETIME, push_error TEXT, extract_error TEXT, purchase_ledger TEXT, bank_ledger TEXT, delivery_date TEXT, account_no TEXT, statement_from TEXT, statement_to TEXT, opening_balance REAL, closing_balance REAL, total_debit REAL, total_credit REAL, file_url TEXT, tally_masterid TEXT, verified_in_tally_at DATETIME);

CREATE TABLE crm_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE "crm_po_items" (
  id               INTEGER PRIMARY KEY,
  po_id            INTEGER NOT NULL,
  item_code        TEXT,
  quantity_ordered INTEGER NOT NULL,
  unit_price       REAL,
  notes            TEXT
);

CREATE TABLE crm_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    product_type TEXT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE crm_purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT NOT NULL UNIQUE,
    po_source TEXT NOT NULL DEFAULT 'manual',
    company_id INTEGER NOT NULL REFERENCES crm_companies(id) ON DELETE RESTRICT,
    contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    order_date DATE,
    expected_dispatch_date DATE,
    dispatch_date DATE,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , file_url TEXT);

CREATE TABLE crm_tally_bank_txns (
    voucher_no    TEXT    PRIMARY KEY,
    voucher_type  TEXT,
    date          TEXT,
    party_name    TEXT,
    amount        REAL,
    narration     TEXT,
    bill_refs     TEXT    DEFAULT '[]',
    synced_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  , bank_ledger TEXT, ledger_lines TEXT DEFAULT '[]');

CREATE TABLE crm_tally_ledgers (
    name        TEXT PRIMARY KEY,
    parent      TEXT,
    closing_balance TEXT,
    synced_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE crm_tally_outstanding (
    party_name    TEXT    NOT NULL,
    bill_ref      TEXT    NOT NULL,
    voucher_no    TEXT,
    bill_date     TEXT,
    original_amt  REAL,
    settled_amt   REAL    DEFAULT 0,
    pending_amt   REAL,
    credit_days   INTEGER DEFAULT 0,
    due_date      TEXT,
    overdue_days  INTEGER DEFAULT 0,
    synced_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (party_name, bill_ref)
  );

CREATE TABLE crm_tally_purchase_outstanding (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    party_name   TEXT    NOT NULL,
    bill_ref     TEXT    NOT NULL,
    voucher_no   TEXT    DEFAULT '',
    bill_date    TEXT,
    original_amt REAL    DEFAULT 0.0,
    settled_amt  REAL    DEFAULT 0.0,
    pending_amt  REAL    DEFAULT 0.0,
    credit_days  INTEGER DEFAULT 0,
    due_date     TEXT,
    overdue_days INTEGER DEFAULT 0,
    synced_at    TEXT
);

CREATE TABLE crm_tally_purchase_vouchers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_no       TEXT    NOT NULL UNIQUE,
    date             TEXT,
    party_name       TEXT,
    amount           REAL    DEFAULT 0.0,
    narration        TEXT,
    ledger_lines     TEXT,    -- JSON: [{ledger, amount, dr_cr}, ...]
    bill_refs        TEXT,    -- JSON: []  (populated once Tally returns BILLALLOCATIONS)
    inventory_lines  TEXT,    -- JSON: [{item, actual_qty, billed_qty, rate, amount}, ...]
    synced_at        TEXT
);

CREATE TABLE crm_tally_sales_vouchers (
    voucher_no    TEXT    PRIMARY KEY,
    date          TEXT,
    party_name    TEXT,
    amount        REAL,
    narration     TEXT,
    ledger_lines  TEXT    DEFAULT '[]',
    bill_refs     TEXT    DEFAULT '[]',
    synced_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  , inventory_lines TEXT, payment_reminder_date TEXT);

CREATE TABLE crm_tally_stock_items (
  name        TEXT PRIMARY KEY,
  parent      TEXT,
  base_units  TEXT,
  closing_qty TEXT,
  closing_rate TEXT,
  synced_at   DATETIME DEFAULT CURRENT_TIMESTAMP
, hsn_code TEXT, gst_applicable TEXT);

CREATE TABLE crm_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    completed_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , assigned_to TEXT, invoice_id INTEGER REFERENCES crm_invoices(id) ON DELETE SET NULL);

CREATE TABLE daily_gate_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_code TEXT NOT NULL,
    gate_date TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_code, gate_date)
  );

CREATE TABLE gelco_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , store_code TEXT NOT NULL DEFAULT 'secondary');

CREATE TABLE item_visibility (
    item_code TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    PRIMARY KEY (item_code, company_id)
  );

CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    default_spq INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , status TEXT NOT NULL DEFAULT 'active', category TEXT);

CREATE TABLE outwards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    quantity_shipped INTEGER NOT NULL,
    outward_type TEXT NOT NULL DEFAULT 'Full',
    outward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  , po_id INTEGER REFERENCES crm_purchase_orders(id) ON DELETE SET NULL, company_id INTEGER REFERENCES crm_companies(id) ON DELETE SET NULL, store_code TEXT NOT NULL DEFAULT 'primary');

CREATE TABLE reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_number TEXT UNIQUE NOT NULL,
    item_code TEXT NOT NULL,
    box_number TEXT,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'In Stock',
    inward_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  , store_code TEXT NOT NULL DEFAULT 'primary');

CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    reject_reason TEXT,
    payload TEXT NOT NULL
  );

CREATE TABLE stock_transfers (
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
  );

CREATE TABLE stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE user_companies (
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, company_id)
  );

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE INDEX idx_bank_txns_date  ON crm_tally_bank_txns(date);

CREATE INDEX idx_bank_txns_type  ON crm_tally_bank_txns(voucher_type);

CREATE INDEX idx_boxes_store ON boxes(store_code);

CREATE INDEX idx_contacts_company ON crm_contacts(company_id);

CREATE INDEX idx_contacts_status ON crm_contacts(status);

CREATE INDEX idx_invoices_date ON crm_invoices(invoice_date);

CREATE INDEX idx_invoices_status ON crm_invoices(status);

CREATE INDEX idx_ledgers_parent ON crm_tally_ledgers(parent);

CREATE INDEX idx_notes_contact ON crm_notes(contact_id);

CREATE INDEX idx_outstanding_due     ON crm_tally_outstanding(due_date);

CREATE INDEX idx_outstanding_overdue ON crm_tally_outstanding(overdue_days);

CREATE INDEX idx_outstanding_party   ON crm_tally_outstanding(party_name);

CREATE INDEX idx_outwards_company ON outwards(company_id);

CREATE INDEX idx_outwards_date ON outwards(outward_date);

CREATE INDEX idx_outwards_po ON outwards(po_id);

CREATE INDEX idx_outwards_reel ON outwards(reel_number);

CREATE INDEX idx_po_company ON crm_purchase_orders(company_id);

CREATE INDEX idx_po_items_po ON crm_po_items(po_id);

CREATE INDEX idx_po_status ON crm_purchase_orders(status);

CREATE INDEX idx_reels_box ON reels(box_number);

CREATE INDEX idx_reels_inward_date ON reels(inward_date);

CREATE INDEX idx_reels_item_store_status ON reels(item_code, store_code, status);

CREATE INDEX idx_reels_store ON reels(store_code);

CREATE INDEX idx_requests_status ON requests(status);

CREATE INDEX idx_sales_vch_date  ON crm_tally_sales_vouchers(date);

CREATE INDEX idx_sales_vch_party ON crm_tally_sales_vouchers(party_name);

CREATE INDEX idx_stock_parent ON crm_tally_stock_items(parent);

CREATE INDEX idx_tasks_contact ON crm_tasks(contact_id);

CREATE INDEX idx_tasks_due ON crm_tasks(due_date, status);

CREATE INDEX idx_tasks_invoice ON crm_tasks(invoice_id);

CREATE INDEX idx_transfers_from_reel ON stock_transfers(from_store, reel_number);