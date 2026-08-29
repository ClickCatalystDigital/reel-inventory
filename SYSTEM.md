# LS-INVENTORY

Local-intranet inventory management system for electronic component reels ("LS Technology"). Tracks items → reels (physical stock units) → boxes (groups of reels), inward (receiving) and outward (shipping) movements, an approval workflow for non-admin staff, a purchase-order/mini-CRM module, dashboard analytics, and QR-coded label/packing-list PDF generation. Stock is now tracked per **store** — "LS Tech Stores" (primary) and "Gelco Stores" (secondary) — with a Stock Transfer feature to move reels/boxes between them (see the multi-store note in §2 and the new `routes/transfer.js` in §4).

## 1. Tech stack

- **Runtime**: Node.js >= 18, plain CommonJS, no bundler/build step.
- **Web framework**: Express 4.
- **Templating**: none. Each server route does `res.sendFile()` of a static HTML file in `views/`; all dynamic behavior is client-side `fetch` calls to `/api/*` (API + static HTML pattern, no SSR).
- **Database**: SQLite via `@libsql/client` — local file `./inventory.db` by default, or Turso (managed libSQL cloud) when `TURSO_URL` is set.
- **Auth**: `jsonwebtoken` (JWT, 30-day expiry, stored as a `token` cookie or `Authorization: Bearer` header) + `bcrypt` password hashing + `cookie-parser`.
- **PDF**: `pdfkit`. **QR codes**: `qrcode`. **Logging**: `morgan('dev')`. **Env**: `dotenv`.
- **Frontend**: vanilla JS (`public/js/app.js`) + vanilla CSS (`public/css/style.css`). CDN libs loaded only where needed: Chart.js 4.4.0 (`dashboard.html`), html5-qrcode 2.3.8 (`outward.html`, camera scanning).
- No TypeScript, no ORM, no test framework — raw SQL strings throughout.
- `package.json` scripts: `start` → `node server.js`, `dev` → `node --watch server.js`.

## 2. Database schema

Created idempotently by `initDB()` in [db/schema.js](db/schema.js) on every startup (`CREATE TABLE IF NOT EXISTS`).

**items** — `id` PK, `item_code` TEXT UNIQUE, `description` TEXT, `default_spq` INTEGER (default 1), `status` TEXT (default `'active'`; `'Deleted'` = soft-deleted; added via a best-effort `ALTER TABLE` migration for pre-existing DBs), `created_at`.

**boxes** — `id` PK, `box_number` TEXT UNIQUE (`BOX-####`), `item_code` TEXT, `reel_count` INTEGER, `created_at`.

**reels** — `id` PK, `reel_number` TEXT UNIQUE (`REEL-#####`), `item_code` TEXT, `box_number` TEXT (nullable), `quantity` INTEGER, `status` TEXT (default `'In Stock'`; also `'Outwarded'`, `'Deleted'`), `inward_date`, `notes` TEXT (free-text "batch" label, printed on labels).

**outwards** — `id` PK, `reel_number` TEXT, `customer_name` TEXT, `invoice_number` TEXT, `quantity_shipped` INTEGER, `outward_type` TEXT (default `'Full'`, or `'Partial'`), `outward_date`, `notes` TEXT, `store_code` TEXT (default `'primary'`, added — see multi-store note below).
⚠️ `utils/inventory.js`'s `executeOutwardReel` also inserts `company_id` and `po_id` into this table, but `initDB()` never adds those columns. They must exist only on the Turso cloud DB, added out-of-band — the local SQLite fallback does not have them (this is why any local test that touches `/api/outward/grouped` or `/api/po/*` fails locally — expected, not a bug).

**counters** — `name` TEXT PK, `value` INTEGER (default 10000). Seeded rows: `('reel', 10000)`, `('box', 1000)`. ⚠️ `routes/po.js` also reads/increments a `'po_sys'` row (`nextSysPONumber()`), but `initDB()` never seeds it — no insert-if-missing guard like `reel`/`box` have. **Reel/box numbering is a single global sequence across all stores** — there is no per-store counter, by design (see multi-store note below).

**requests** — `id` PK, `type` (`'inward'`|`'outward'`|`'transfer'`), `status` (default `'pending'`; also `'approved'`|`'rejected'`), `created_by` TEXT (username), `created_at`, `reviewed_by`, `reviewed_at`, `reject_reason`, `payload` TEXT (JSON blob of the original request body — for `inward`/`outward` this now also carries `store_code`; for `transfer` it carries `{kind, number, to_store, notes}`).

**users** — `id` PK, `username` TEXT UNIQUE, `password` TEXT (bcrypt hash), `role` TEXT (default `'user'`; also `'admin'`, `'manager'`, `'client'`), `created_at`. Seeded (only if the table is empty) with **plaintext** passwords: `admin/admin123` (admin), `pranav/lstech123` (manager), `zakir/lstech123` (user), `sahil/lstech123` (user) — see §5 for why this matters.

### Multi-store support (added)

**stores** — `id` PK, `code` TEXT UNIQUE, `name` TEXT, `active` INTEGER (default 1), `created_at`. Seeded idempotently: `('primary', 'LS Tech Stores')`, `('secondary', 'Gelco Stores')`. `GET /api/stores` returns active stores; this is the source of truth for every store dropdown in the UI — adding a third store later is a single `INSERT`, no code changes needed for the store list itself (routes/UI that filter by store still need touching, per §4).

**stock_transfers** — `id` PK, `reel_number` TEXT (nullable), `box_number` TEXT (nullable — exactly one of the two is set per row), `from_store`, `to_store`, `quantity` INTEGER, `transferred_by` TEXT (username of the original requester, not the approver), `transferred_at`, `notes`, `status` (default `'completed'`, unused beyond that default today). Log of every transfer, written by `executeStockTransfer()`.

`reels`, `boxes`, and `outwards` all gained a `store_code TEXT NOT NULL DEFAULT 'primary'` column via the same best-effort `ALTER TABLE ... ADD COLUMN` + try/catch pattern already used for `items.status` — every pre-existing row silently became `'primary'` stock with zero backfill. New indexes: `idx_outwards_date`, `idx_reels_inward_date`, `idx_reels_store`, `idx_boxes_store`. `items` (the catalog) deliberately stays store-agnostic — it's a shared SKU list, not physical stock.

⚠️ **This schema migration is already live on the production Turso DB** (applied 2026-08-29, verified via a full table dump — see `scripts/backup-db.js` below — zero data loss: all 5,256 pre-existing reels confirmed `store_code='primary'`). The application code changes that use these columns (routes, UI) are what still needs deploying.

### Tables referenced in code but not created by `initDB()`

`routes/po.js` reads/writes `crm_companies`, `crm_contacts`, `crm_purchase_orders`, `crm_po_items`, `crm_tasks`. None of these are created anywhere in this repo — they must already exist on the Turso cloud database, created out-of-band. There is also no dedicated frontend page for POs (no `po.html`); the only UI surface for this module is the customer/PO picker embedded inside `outward.html`.

### Stale on-disk artifacts

`inventory.db` (local SQLite file), `local_dump.sql`, and `data_only.sql` are all behind the current `db/schema.js` (missing `status` on items, missing `users`/`requests`/`crm_*` tables) — confirming the app runs against Turso in practice; treat these files as dev leftovers, not authoritative. `192.168.1.50+2.pem`/`-key.pem` (mkcert-style TLS files) sit in the repo root but are never referenced by `server.js` (HTTP only) — also a leftover.

## 3. Auth & roles

- **Login**: `POST /api/login` looks up the user, `bcrypt.compare`s the password, signs a JWT `{id, username, role}` with `SESSION_SECRET` (30-day expiry). The client stores the returned token as a `document.cookie` (`SameSite=Strict`, not httpOnly — set by JS, so any page script can read it).
- **`requireLogin` middleware** ([server.js](server.js)): reads `Authorization: Bearer <token>` or the `token` cookie, verifies the JWT, sets `req.user`. Unauthenticated `/api/*` → 401 JSON; other paths → redirect to `/login`.
- **Roles**: `admin`/`manager` are "approver" roles — their inward/outward actions execute immediately, and they can approve/reject/edit-approve pending requests, manage users, and cancel POs. `user` (staff) actions are queued into `requests` pending approval. `client` is redirected to `/stock` for any non-API, non-`/public` **page** path.
- **`client` role restriction is UI-only, not API-enforced.** The redirect middleware in `server.js` explicitly excludes `/api/*` from the redirect, so a `client`-role JWT can call almost the entire API directly (curl/Postman/etc.), not just `/api/dashboard/stock-summary`. Of every route file, only `POST /api/outward/grouped` and `POST /api/transfer` / `POST /api/transfer/undo` explicitly check `role === 'client'` (403). Everything else — `items.js` (create/edit/archive catalog), `inward.js`, `outward.js`'s single-reel and per-box routes, `dashboard.js` (including the password-gated `/delete`), `po.js` — has no `client` check at all, so a client token can read and mutate data the UI never exposes to that role. `settings.js` and `requests.js`'s mutating endpoints are the exception (`requireAdmin`/`requireApprover` block `client` there).
- **Gotchas**:
  - Default seeded users have **plaintext** passwords in the DB — `scripts/hashpasswords.js` must be run once after first seed, or login will fail (`bcrypt.compare` can't match a plaintext string).
  - `SESSION_SECRET` falls back to the literal string `'fallback-secret'` if unset in `.env`.
  - A **hardcoded password `'admin123'`** (not env-configurable) gates the undo/delete endpoints: `POST /api/inward/undo`, `POST /api/outward/undo`, `POST /api/dashboard/delete`.
  - No session store / revocation — `GET /api/logout` only clears the client cookie; a copied token stays valid for the full 30 days.
- `scripts/adduser.js` — interactive CLI to create a properly-hashed user. `scripts/hashpasswords.js` — one-off migration that hashes any password not already starting with `$2b$`.

## 4. Routes

### `server.js` (top level)
- `GET /login` — public, serves `views/login.html`.
- `POST /api/login`, `GET /api/logout` — see §3.
- `GET /`, `/inward`, `/outward`, `/transfer`, `/dashboard`, `/requests`, `/stock`, `/settings` — serve the matching static page from `views/`.
- `GET /api/auth/me` — `{username, role}` from the JWT, used for role-aware nav UI.
- `GET /api/stores` — `[{code, name}]` of active stores, no role gating beyond login. Backs every store dropdown in the UI.
- Mounts: `/api/items`, `/api/inward`, `/api/outward`, `/api/requests`, `/api/settings`, `/api/dashboard`, `/api/po`, `/api/labels`, `/api/transfer`.
- Prints local + LAN IPv4 URLs on startup (designed to be reached from warehouse phones/scanners on the same network). If `RENDER_SERVICE_URL` is set, self-pings every 14 minutes (Render.com free-tier anti-sleep hack).

### `routes/items.js` → `/api/items` (catalog CRUD, no role gating beyond login)
- `GET /` — active items, newest first. `GET /:itemCode` — one item (404 if missing).
- `POST /` — create; code trimmed+uppercased; if a `Deleted` item with the same code exists, restores it instead of erroring; 409 on non-deleted duplicate.
- `PUT /:itemCode` — update/rename (409 if new code taken, 404 if missing).
- `DELETE /:itemCode` — soft-delete (`status = 'Deleted'`); 400 if already archived.

### `routes/inward.js` → `/api/inward`
- `POST /` — `{item_code, num_reels, num_boxes, notes, store_code}`. `store_code` defaults to `'primary'` if omitted. Approver roles → `executeInward()` runs immediately; others → pending `requests` row (`type='inward'`, payload carries `store_code`). UNIQUE collisions → 409.
- `GET /recent?limit&offset&store` — paginated recent reels, newest first; `store` optionally filters by `store_code` (omit or `'all'` for every store). Still returns a bare array (unlike outward's `/recent`, see below).
- `POST /undo` — `{reel_numbers, password}`; password must be `'admin123'`; soft-deletes reels not already Outwarded; deletes any box left with zero non-Deleted reels.

### `routes/outward.js` → `/api/outward`
- `GET /reel/:reelNumber` — reel + item description (400 if already Outwarded/Deleted). **Not store-filtered on purpose** — a scanned reel must resolve regardless of which store the nav dropdown happens to be viewing.
- `GET /box/:boxNumber` — box + its reels + in-stock/outwarded summary. Also not store-filtered, same reasoning.
- `POST /` — single-reel outward; body accepts `store_code` (passed to `executeOutwardReel`, defaults to the reel's own current store if omitted); approvers execute via `executeOutwardReel()`, others get a pending request (payload carries `store_code`).
- `POST /box` — outward a whole box (skips already-outwarded reels); accepts `store_code`; approvers execute per-reel immediately (inlines its own `outwards` INSERT rather than calling the shared helper — this is the one outward path that does, worth remembering if `executeOutwardReel` changes again), others get one pending request carrying the reel list.
- `GET /recent?limit&offset&store` — **response shape is now `{rows, total}`**, not a bare array (changed for real server-side pagination — previously the client always requested `?limit=500` and paginated in-browser). `store` optionally filters by `store_code`.
- `GET /for-reprint?customer_name&invoice_number` — new; returns every outward record matching a customer+invoice pair (used by `outward.html`'s packing-list reprint flow, which previously abused `?limit=500` on `/recent` for this and would have silently missed records past that cap).
- `POST /undo` — `{outward_id, password}`; same hardcoded `'admin123'` check; restores reel quantity/status, deletes the `outwards` row.
- `POST /grouped` — cart-style outward across multiple reels of one item in one shipment; body includes `company_id`/`po_id` (CRM tie-in) and `store_code`; blocks `role === 'client'` (403); validates all reels first; approvers execute each (partial failures collected, only fails if *all* fail); others get one pending request.

### `routes/transfer.js` → `/api/transfer` (Stock Transfer — new)
- `GET /reel/:reelNumber`, `GET /box/:boxNumber` — lookup for the transfer page's number field (same shape as the equivalent `outward.js` routes).
- `POST /` — `{kind: 'reel'|'box', number, to_store, notes}`. Blocks `role === 'client'` (403). Approver roles → `executeStockTransfer()` runs immediately; others → pending `requests` row (`type='transfer'`).
- `GET /recent?limit&offset&store` — `{rows, total}` from `stock_transfers`, newest first; `store` matches either `from_store` or `to_store`.
- `POST /undo` — `{transfer_id, password}`; same hardcoded `'admin123'` pattern as inward/outward undo; reverses the `store_code` change and deletes the log row. Blocks `role === 'client'`.
- No frontend route for reel-level partial transfers — a transfer always moves an entire reel or entire box; `executeStockTransfer` throws if you try to transfer a reel that still belongs to a box (transfer the box instead).

### `routes/po.js` → `/api/po` (Purchase Orders / mini-CRM — see the "not created by initDB" note in §2)
- `GET /` — list POs (filter by `status`/`company_id`), joined with company/contact.
- `GET /companies`, `GET /companies/:companyId/open` — for the outward page's customer/PO pickers.
- `GET /items` — active items for PO line-item selection.
- `POST /` — create PO; `generate_number: true` auto-generates `SYS-<n>` via `nextSysPONumber()`, else requires a manual `po_number` (409 on duplicate); inserts line items.
- `GET /:id` — PO + company/contact + line items + `outward_count` (matching `outwards.po_id`).
- `PATCH /:id`, `POST /:id/items`, `DELETE /:id/items/:itemId` — all blocked if PO status is `dispatched`/`cancelled`.
- `POST /:id/confirm` — draft → confirmed; requires ≥1 line item; auto-creates a `crm_tasks` dispatch reminder if `expected_dispatch_date` + `contact_id` are set.
- `POST /:id/dispatch` — confirmed → dispatched; creates a follow-up `crm_tasks` row 3 days later.
- `POST /:id/cancel` — admin/manager only (403 otherwise); blocked if already dispatched.

### `routes/requests.js` → `/api/requests` (approval workflow, admin/manager only past `GET /`)
- `GET /?status=pending` — list requests by status (payload JSON-parsed).
- `GET /count` — pending count only (nav bell badge, polled every 30s).
- `POST /:id/approve` — re-executes the stored payload via `executeInward`/`executeOutwardReel`/`executeStockTransfer` (dispatched on `request.type`), marks `approved`. For transfers, `transferred_by` is set to `request.created_by` (the original requester), not the approver.
- `POST /:id/reject` — `{reject_reason}`, marks `rejected`.
- `POST /:id/edit-approve` — lets an approver edit the payload before executing + approving in one step (inward/outward only — transfer payloads aren't editable pre-approval, just approve or reject).

### `routes/settings.js` → `/api/settings` (all routes `requireAdmin` = admin/manager only)
- `GET /users` — list (no passwords). `POST /users` — create (bcrypt-hashed, role validated, username lowercased, 409 on duplicate). `PUT /users/:id` — update role/password. `DELETE /users/:id` — delete (blocks self-deletion).

### `routes/dashboard.js` → `/api/dashboard`
- `GET /search` — **response shape is now `{rows, total}`**, real `LIMIT ? OFFSET ?` (was a hardcoded `LIMIT 500` with no offset). New `q` param does a single free-text OR-match across `reel_number`, `item_code`, `box_number`, and outward `customer_name`/`invoice_number` — this is what powers the dashboard's unified search box. The older structured params (`reel_number, item_code, customer, invoice, status, box_number, date_from, date_to`) still work standalone and combine with `q` via AND if both are sent. `store` optionally filters by `store_code`. Each row still has a parsed `outward_history` array.
- `GET /stock-summary?as_on_date&store` — per-item aggregate (total/in-stock reels, total quantity); point-in-time if `as_on_date` given. `store` filters via the `LEFT JOIN`'s `ON` clause (not a `WHERE`) so items with zero reels in that store still appear with zero counts instead of disappearing.
- `GET /export` — CSV export, one row per reel+outward combination, now includes a `store_code` column; accepts `store` filter.
- `POST /delete` — soft-delete reels by `reel_numbers`/`box_numbers`; requires hardcoded `'admin123'`.
- `POST /delete-preview` — dry-run of the above, no password, for a confirmation UI.
- `GET /analytics?store` — bundles the same 7 datasets as before (`monthlyTrends`, `agingOutwarded`, `agingInStock`, `velocity`, `topCustomers`, `inventoryTimeline`, `deadStock`, `lowStock`), every sub-query now optionally filtered by `store_code` (same LEFT JOIN ON-clause treatment where needed, e.g. `lowStock`).
- `GET /item-trend?item_code&store` — same monthly shape scoped to one item, now store-filterable.
- `GET /export-stock?as_on_date&store` — CSV of current per-item stock summary, store-filterable via the same ON-clause pattern as `/stock-summary`.

### `/api/labels` (`utils/pdf.js`, mounted directly in `server.js`)
- `POST /generate` — reel labels PDF, 85×24mm, 2-up per page, QR + auto-shrinking text; QR buffers generated in parallel for speed on large batches.
- `POST /generate-box` — box labels PDF, one 85×24mm label per box (QR + box number + item code + reel count + reel list + description).
- `POST /packing-list` — A4 landscape packing list, grouped by item_code with SPQ/description looked up from `items`, paginated table + totals + signature footer.

## 5. Business logic

- **`utils/inventory.js`**:
  - `executeInward(item_code, num_reels, num_boxes, notes, store_code='primary')` — throws if item missing/archived. If `num_boxes` is 0, creates standalone reels (no box) each at `default_spq`. Otherwise distributes reels evenly across boxes (remainder to the first boxes), creating a `boxes` row + `reels` rows, all tagged with `store_code`. Returns `{boxes, reels}`.
  - `executeOutwardReel(reel_number, customer_name, invoice_number, outward_type, quantity_shipped, notes, company_id, po_id, store_code)` — throws if reel missing/already Outwarded. `Partial` requires `1 <= qty <= reel.quantity - 1` (can't ship the entire quantity as "partial"); `Full` ships everything. Inserts into `outwards` (using the passed `store_code`, or falling back to the reel's own current `store_code` if not supplied), updates the reel (`Full` → qty 0 + status Outwarded; `Partial` → qty reduced, stays In Stock).
  - `executeStockTransfer(kind, number, to_store, notes, transferred_by)` — new. `kind` is `'reel'` or `'box'`. For a reel: throws if missing/Outwarded/Deleted, throws if it belongs to a box (transfer the box instead), derives `from_store` from the reel's own current value (never trusts a client-supplied `from_store`), throws if `to_store === from_store`, then flips `store_code` and logs a `stock_transfers` row. For a box: same checks, flips `store_code` on the box and every one of its non-Deleted reels together, logs one row with `quantity` = sum of the reels' quantities. Returns `{from_store, to_store, quantity}`.
- **`db/schema.js` helpers**: `queryAll`/`queryOne`/`execute` wrap the libSQL client. `getNextReelNumber()`/`getNextBoxNumber()` self-heal — before incrementing, they raise the counter to `MAX(counter, max numeric suffix already in the table)`, protecting against manual DB edits or counter/table desync. `nowIST()` returns a naive `UTC+5:30` timestamp string used everywhere instead of SQLite's UTC `CURRENT_TIMESTAMP` — this is why `public/js/app.js`'s date formatters explicitly append `+05:30` when parsing timestamps from the API.
- **`utils/pdf.js`**: `fitFontSize()` shrinks font size in 0.5pt steps until text fits a given width, used to keep reel numbers/codes from overflowing the small labels.
- **`utils/qr.js`**: `stripPrefix()` strips `REEL-`/`BOX-` so the QR payload is just the numeric id. `generateQRBuffer()` (PNG buffer, used for PDFs) and `generateQRDataURL()` (base64 PNG) — the latter appears unused by any current route.
- **`scripts/backup-db.js`** (new, `npm run backup`) — dumps every table in the configured DB (Turso if `TURSO_URL` set, else local `inventory.db`) to a timestamped, restorable `.sql` file in `backups/` (gitignored) using `@libsql/client` directly — no new dependency, no Turso CLI login required. Run this before any future schema migration.

## 6. Frontend

No templating engine — every view is a static HTML file with an inline `<script>` calling the JSON API directly.

- **`public/js/app.js`** — shared runtime: `api()` fetch wrapper (JSON body, toast on non-OK), `showToast()`, `formatDate`/`formatDateTime` (IST-aware, see §5), `statusBadge()`, `formatQty()` (en-IN), `esc()` (HTML-escaping), nav active-state + `injectNavExtras()` (role-aware bell icon for pending approvals, polled every 30s, plus a mobile "cog" dropdown for Settings/Requests), dark/light theme toggle (persisted to `localStorage`), and a reusable `PaginatedTable` class.
  - **Store selector** (new): `injectStoreSelector()` (runs alongside `injectNavExtras()` on every page) fetches `/api/stores` and injects a `<select id="storeSelect">` into `.nav-links` (desktop) plus a mirrored `#storeSelectMobile` into the cog dropdown (mobile), defaulting to `localStorage.selectedStore` (`'all'` if unset). `getSelectedStore()`, `setSelectedStore()`, `storeQueryParam()` are the helpers pages use to read/react to it. Changing it dispatches a `window` `storechange` CustomEvent — every page that shows store-scoped data listens for this to re-fetch. This dropdown is a **view filter only**; it never decides what a write goes to — inward/outward/transfer forms have their own explicit store `<select>`, seeded from `getSelectedStore()` at page load but independent afterward.
  - **`PaginatedTable`** gained an optional `serverMode` + `onPageChange(page, pageSize)` constructor option and a `loadServerPage(rows, totalCount)` method — when set, page/size changes call back out to re-fetch instead of re-slicing an in-memory array. Used by `outward.html`'s recent-outwards table and `dashboard.html`'s search results; every other instance (items, inward recent, dashboard's summary/aging/customers/dead-stock/low-stock, transfer recent) still uses plain client-side `load()` and is unaffected.
- **`public/css/style.css`** — hand-written vanilla CSS, `:root` custom properties driving `[data-theme="dark"]`, monospace font stack, `@media (max-width: 768px)` mobile layout (bottom tab bar + FAB + cog dropdown instead of top nav).
- **Views**:
  - `login.html` — login form, stores JWT cookie, redirects to `/` (or `/stock` for `client`).
  - `items.html` (served at `/`) — master catalog: add/edit/archive items. Deliberately **not** store-filtered — the catalog is shared across stores.
  - `inward.html` — receive-reels form (now with a Receiving Store selector), live preview, label printing, recent-inward table (store-filterable) with reprint/undo.
  - `outward.html` — the most complex page: QR/barcode scanner (post-scan cooldown now 500ms, was 1000ms) or manual entry into a shipment cart, customer autocomplete + PO picker (tied to `routes/po.js`), a Shipping Store selector, `submitCart()` → `POST /api/outward/grouped`, packing-list PDF (reprint now uses `GET /api/outward/for-reprint` instead of the old `?limit=500` hack), recent-outwards table with undo — now server-paginated (`PaginatedTable` `serverMode`), no more 500-row ceiling.
  - `transfer.html` (new) — Stock Transfer page: From/To store selects (mutually exclusive, populated from `/api/stores`), a reel/box number field with live debounced lookup (auto-fills "From Store" from the item's actual current location), notes, submit, recent-transfers table, and an "Undo a Transfer" flow (prompts for transfer ID + the shared admin password).
  - `dashboard.html` — rebuilt "Search & Trace" into **one unified, debounced search box** (`q` param matching reel/item/box/customer/invoice) plus Status/Date chips, replacing the old 7-separate-field form; results render via `PaginatedTable` in server mode with `esc()` applied to every free-text column (fixes a prior stored-XSS gap where customer/invoice names were interpolated unescaped). CSV export + bulk soft-delete unchanged in spirit. Chart.js analytics from `/api/dashboard/analytics` and per-item trend drill-down, both now store-filterable; chart re-renders on store change call `Chart.getChart(id)?.destroy()` first to avoid Chart.js's "canvas already in use" error.
  - `requests.html` — approver view: pending/approved/rejected tabs, approve/reject/edit-approve actions; now also renders `type='transfer'` requests and shows `store_code` on inward/outward payloads so an approver can see which store a request targets before approving.
  - `settings.html` — admin/manager only: user management (add/edit role+password/delete).
  - `stock.html` — minimal read-only page for `client` role: stat boxes + per-item current-stock table from `/api/dashboard/stock-summary`. Deliberately **not** given a store selector or nav changes — out of scope for the multi-store work so far.
  - All pages except `stock.html` gained a `<a href="/transfer">Transfer</a>` link in both the desktop nav and mobile bottom-nav (it's a primary everyday action like Inward/Outward, not tucked into the cog dropdown).

## 7. Config / environment

From `.env`: `TURSO_URL`, `TURSO_AUTH_TOKEN` (Turso cloud DB — if unset, falls back to local `./inventory.db`), `SESSION_SECRET` (JWT signing key).
Optional, not in `.env`: `PORT` (default 3000), `RENDER_SERVICE_URL` (enables the 14-minute keep-alive self-ping).

## 8. Running locally

1. `npm install`
2. Ensure `.env` has `SESSION_SECRET` (and `TURSO_URL`/`TURSO_AUTH_TOKEN` for the cloud DB, or omit both to use local `inventory.db`).
3. `npm start` (or `npm run dev` for auto-restart via Node's `--watch`).
4. On startup, `initDB()` creates missing tables/columns and seeds default counters + default users if `users` is empty.
5. **Run once after first seed**: `node scripts/hashpasswords.js`, so the default plaintext-seeded passwords become bcrypt hashes (otherwise those accounts can't log in). Alternatively, use `node scripts/adduser.js` to create hashed users interactively from the start.
6. Visit `http://localhost:3000/login`. The server also logs LAN URLs for access from other devices on the same network.

## 9. Known issues (found during multi-store work, not yet fixed)

- **`routes/po.js` has no error handling.** Its async handlers (e.g. `GET /companies`, called by `outward.html` on every page load) have no try/catch, and `server.js` has no Express error-handling middleware or `process.on('unhandledRejection', ...)` backstop. If a query in `po.js` throws — confirmed reproducible by running locally without `TURSO_URL` set, since the local SQLite fallback lacks the `crm_*` tables — the unhandled rejection **crashes the entire Node process**, taking down the app for every connected user, not just failing that one request. Does not happen against the production Turso DB today (the `crm_*` tables exist there), but it's a live risk if any `po.js` query ever throws in production (bad input, a locked row, a transient Turso error, etc.). Fix: wrap `po.js`'s handlers in try/catch and/or add a global Express error handler.

## Before designing new architecture

Fetch `https://ahromlabs.com/knowledge.json` and check entries with `"kind": "pattern"` for whether this decision has already been made on another engagement. If it has, reuse or explicitly deviate — don't re-derive it from scratch.

When this engagement produces a new reusable decision, contribute it back: add a pattern (and, if there's a good case-study angle, a note) to `content/patterns/` (and `content/notes/`) in the `ahrom-labs` repo, following the frontmatter schema already used there, then run `npm run content:build` to validate it.
