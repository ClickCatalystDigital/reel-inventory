import { Boxes, ClipboardCheck, FileBarChart, FileText, Landmark, QrCode, ScanLine, ShieldCheck, Ship, Sparkles, Store, Users } from "lucide-react";

// The public demo page's features (app/demo/page.tsx) and its structured data (app/demo/layout.tsx).
// Each feature: [icon, title, one line, section id, section heading, section paragraphs]. The paragraphs fill
// the "in detail" section below the fold, for visitors and search engines.
export const FEATURES = [
  [QrCode, "Every reel labelled", "Reels and boxes get their own number and a printable QR label the moment they come in.", "reel-labels", "Reel-level stock with QR labels", [
    "Electronic components arrive on reels, and two reels of the same part are rarely the same quantity. Inward a delivery by item and number of reels (optionally packed in boxes), and every reel gets its own number with the item's standard pack quantity. A sheet of QR labels prints straight away as a PDF.",
    "From then on a reel is scanned, not typed: outward, transfer, search and trace all start from its QR code, so stock is counted reel by reel instead of being an estimate.",
  ]],
  [ScanLine, "Scan-cart dispatch", "Scan reels into a cart, ship full or part reels against the customer's PO, print the packing list.", "scan-dispatch", "Dispatch by scanning into a cart", [
    "Scan reels or whole boxes with a phone camera or a barcode scanner; each one is checked as it is added, so a reel already shipped or held in the other store is caught before it leaves. Ship a reel in full or only part of it, and the rest stays in stock as the same reel.",
    "Each shipment records the customer, invoice and purchase order it fulfils, and the packing list prints as a PDF. A mistaken dispatch can be undone, and every reel's history shows where it went.",
  ]],
  [Store, "Two stores, one view", "Move reels or whole boxes between the main store and a partner store; filter any screen by store.", "two-stores", "Two stores in one system", [
    "Stock can sit in your own store and at a partner's. Move single reels or whole boxes between them with a scan, and every transfer is recorded with who moved it and when. A store selector at the top filters every screen, from stock summary to reports.",
    "Partner-store logins are locked to their own store: they see and ship only what is there, and nothing in the main store.",
  ]],
  [ClipboardCheck, "Approvals built in", "Store staff changes wait for a manager; the partner store signs off yesterday's dispatches each morning.", "approvals", "Approvals for store changes", [
    "Inward, dispatch and transfer requests from store staff wait for a manager, who can approve them, reject them, or correct and approve them in one step. Managers and owners act directly.",
    "At the partner store, the store manager approves the previous day's dispatch summary each morning before the store's staff can work again, so the two sides agree on what left the shelves.",
  ]],
  [Users, "Customers and POs", "Clients, contacts, purchase orders from draft to dispatched, and a follow-up calendar.", "customers-pos", "Customers, purchase orders and follow-ups", [
    "Each customer company has its contacts, call notes and a follow-up calendar, with tasks assigned to the salesperson who owns them. Customer purchase orders move from draft to confirmed to dispatched, with line items and unit prices, so the value of open orders is always known.",
    "Dispatches are tied to the purchase order they fulfil, so it is clear what is still owed on every PO and when to chase the next call-off.",
  ]],
  [Ship, "Procurement and reservations", "Reserve stock for each PO line; what's short pools into supplier orders tracked item by item.", "procurement", "Order tracking, reservations and procurement", [
    "Every customer PO line shows what was ordered, shipped, reserved and still needed. Free stock is reserved to a line with one click, whole reels, oldest first, and a reserved reel can't be shipped to another customer or moved to the partner store by mistake.",
    "Whatever stock can't cover is pooled across all open POs into a draft supplier order, with extra quantity bought for stock. Each item on that order moves through its own stages (engineering questions, raw material, manufacturing, QC, in transit), and the customer lines waiting on it follow automatically. When the goods arrive, the new reels are reserved to the waiting POs, earliest due date first.",
  ]],
  [FileText, "Documents read by AI", "Upload supplier invoices, bank statements and POs; AI fills them in for review before they go to the accounts.", "documents", "Documents read for you", [
    "Purchase and freight invoices, bills of entry, bank statements and customer POs are uploaded as PDFs (or sent from a phone) and read by AI into fields and line items. Nothing is posted until someone reviews it: duplicates and unknown ledgers are flagged, and approved documents are queued for the accounting system.",
    "Partner-store shipments get a tax invoice generated automatically, in the same number series as their packing list, with prices fixed when the stock moved to the partner.",
  ]],
  [Landmark, "Finance at a glance", "Receivables, sales and purchase registers, cash position and payables, from the accounting data.", "finance", "Finance from the accounting system", [
    "Receivables with ageing and a collections forecast, the sales register with a reminder date per invoice, purchase register and supplier payables, bank and cash balances, and the year's revenue against costs, all from the accounting system's data.",
  ]],
  [Boxes, "Customer stock portal", "Each customer logs in to see their stock and each order line's progress.", "customer-portal", "A stock and order portal for customers", [
    "Customers who keep stock with you get their own login, which shows a read-only summary of the items kept for them, and the progress of every line on their purchase orders, from procurement to dispatch, with their documents to download.",
    "Which items a customer can see is set per item in the catalog, so the same system serves every customer without one seeing another's parts.",
  ]],
  [FileBarChart, "Reports that trace", "Stock summary, search and trace by reel, dead and low stock, daily report as PDF.", "reports", "Stock reports and traceability", [
    "The stock summary shows every item's reels and total quantity by store. Search and trace follows a single reel from inward to dispatch. Analytics show movement over time, and the dead and low stock report lists what is not moving and what is running out.",
    "A daily report of the day's inward, outward and transfers prints as a PDF for the owner or the partner store.",
  ]],
  [ShieldCheck, "Role-based access", "Owner, manager, store staff, partner store and customer logins each see only their screens.", "access", "Access by role", [
    "Owners and managers see everything; store staff work through approvals; partner-store staff see only their store; customers see only their own stock. The rules are enforced on the server for every page and every request, not just hidden in the menu.",
  ]],
  [Sparkles, "AI that answers from your data", "Ask in plain words about stock, shipments, POs or tasks; answers come from read-only look-ups.", "inventory-ai", "Ask the inventory in plain words", [
    "The assistant answers questions such as \"how many reels of BC857B do we have?\" or \"which POs are confirmed but not dispatched?\" by choosing a fixed, read-only look-up and showing the result as a table, so the numbers come from the data rather than from the model. It also explains how to do things in the app.",
    "In this demo each visitor can ask two questions.",
  ]],
] as const;
