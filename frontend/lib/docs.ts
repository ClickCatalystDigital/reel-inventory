// Shared types + helpers for the Docs page (ported from ls_crm's docs.html and tabs/*.js).

export const DOC_TYPE_LABEL: Record<string, string> = {
  freight_invoice: "Freight Invoice",
  purchase_invoice: "Purchase Invoice",
  purchase_order: "Purchase Order",
  bill_of_entry: "Bill of Entry",
  bank_statement: "Bank Statement",
};
export const INV_TYPES = ["purchase_invoice", "freight_invoice"];
export const PO_STATUS_LABEL: Record<string, string> = { draft: "Draft", confirmed: "Confirmed", dispatched: "Dispatched", cancelled: "Cancelled" };

export interface LineItem {
  si_no?: number | null; date?: string | null; description?: string; hsn?: string | null; qty?: number | string | null; uom?: string | null;
  rate?: number | string | null; amount?: number | string | null; delivery_date?: string | null; kind?: "stock" | "expense";
  stock_item_name?: string; stock_match_score?: number; needs_match?: boolean; ledger?: string; comment?: string; attachment_url?: string | null;
}
export interface Invoice {
  id: number; created_at: string; uploaded_by: string | null; original_filename: string | null; doc_type: string | null; status: string;
  invoice_no: string | null; invoice_date: string | null; party_name: string | null; party_gstin: string | null; buyer_gstin: string | null;
  place_of_supply: string | null; mawb_no: string | null; flight_no: string | null; commodity: string | null; origin_airport: string | null;
  dest_airport: string | null; gross_weight: number | null; supplier_ref: string | null; taxable_value: number | null; cgst: number | null;
  sgst: number | null; igst: number | null; total_tax: number | null; net_amount: number | null; line_items: LineItem[] | string;
  tally_xml: string | null; review_notes: string | null; task_id: number | null; pushed_at: string | null; deleted_at: string | null;
  push_error: string | null; extract_error: string | null; purchase_ledger: string | null; bank_ledger: string | null; delivery_date: string | null;
  account_no: string | null; statement_from: string | null; statement_to: string | null; opening_balance: number | null; closing_balance: number | null;
  total_debit: number | null; total_credit: number | null; file_url: string | null;
}
export interface PoRow {
  id: number; po_number: string; po_source: string; company_id: number; contact_id: number | null; status: string; order_date: string | null;
  expected_dispatch_date: string | null; dispatch_date: string | null; notes: string | null; created_by: string | null; created_at: string;
  file_url: string | null; company_name: string | null; poc_name: string | null; item_count: number; outward_count: number;
}
export interface PoItem { id: number; po_id: number; item_code: string | null; quantity_ordered: number; unit_price: number | null; notes: string | null; description: string | null }
export interface PoFull extends PoRow {
  items: PoItem[]; website?: string | null;
  outwards: { id: number; reel_number: string; invoice_number: string | null; quantity_shipped: number; outward_date: string; customer_name: string | null }[];
  relatedInvoices: { id: number; invoice_no: string | null; invoice_date: string | null; doc_type: string; net_amount: number | null; status: string }[];
}
export interface Company { id: number; name: string }
export interface CatalogItem { item_code: string; description: string | null }

export const money = (v: number | string | null | undefined, digits = 2) =>
  "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const lines = (inv: Pick<Invoice, "line_items">): LineItem[] => {
  if (Array.isArray(inv.line_items)) return inv.line_items;
  try { return JSON.parse(inv.line_items || "[]"); } catch { return []; }
};

// Plain 'YYYY-MM-DD' (or anything Date can read) → '5 Oct 2026'.
export function docDate(d: string | null | undefined): string {
  if (!d) return "—";
  const p = String(d).slice(0, 10).split("-");
  if (p.length === 3 && p[0].length === 4) {
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${parseInt(p[2])} ${m[parseInt(p[1]) - 1]} ${p[0]}`;
  }
  return String(d);
}
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Bank line description → readable chips (invoice ref, UTR/RRN, statutory kind, channel, counterparty).
export type Tag = { text: string; tone: "ref" | "mono" | "warn" | "danger" | "plain" | "party" };
export function smartTags(desc: string | null | undefined): Tag[] {
  if (!desc) return [];
  const s = String(desc).toUpperCase().replace(/\s+/g, " ").trim();
  const tags: Tag[] = [];
  const bill = s.match(/BILL\s*ID:\s*\[?([A-Z0-9\s_-]+)\]?/i), qc = s.match(/(QC\s*TI\s*[\d\s/]+)/i), against = s.match(/AGAINST\s*([A-Z0-9\s/-]+)/i), inv = s.match(/INV\s*([\d\w_-]+)/i);
  if (bill) tags.push({ text: `Invoice: ${bill[1].trim()}`, tone: "ref" });
  else if (qc) tags.push({ text: `Invoice: ${qc[1].trim()}`, tone: "ref" });
  else if (against) tags.push({ text: `Ref: ${against[1].trim()}`, tone: "ref" });
  else if (inv) tags.push({ text: `Ref: ${inv[1].trim()}`, tone: "ref" });
  const upi = s.match(/UPI\/(\d{12})/), pre = s.match(/(?:NEFT|RTGS)-([A-Z0-9]+)/), raw = s.match(/\b([A-Z]{4}[RN]\d{11,16})\b/);
  if (upi) tags.push({ text: `RRN: ${upi[1]}`, tone: "mono" });
  if (pre) tags.push({ text: `UTR: ${pre[1]}`, tone: "mono" });
  else if (raw) tags.push({ text: `UTR: ${raw[1]}`, tone: "mono" });
  if (s.includes("ICEGATE")) tags.push({ text: "Customs Duty", tone: "warn" });
  else if (s.includes("GST")) tags.push({ text: "GST Tax", tone: "warn" });
  else if (s.includes("INT.COLL")) tags.push({ text: "Bank Interest", tone: "danger" });
  else if (s.includes("LOAN PROCESSING")) tags.push({ text: "Loan Fee", tone: "danger" });
  if (s.startsWith("CLG/")) tags.push({ text: "Cheque Clearing", tone: "plain" });
  else if (s.startsWith("CMS/")) tags.push({ text: "Bulk CMS Pay", tone: "ref" });
  else if (s.includes("BIL/ONL/")) tags.push({ text: "Online Gateway", tone: "plain" });
  let vendor = "";
  const parts = s.split("/").map((p) => p.trim()).filter(Boolean);
  if (s.startsWith("CLG/") && parts.length > 1) vendor = parts[1];
  else if (s.startsWith("CMS/") && parts.length > 1) vendor = parts[parts.length - 1];
  else if (s.startsWith("UPI/") && parts.length > 2) { if (parts[2] !== "UPI PAY") vendor = parts[2]; }
  else if (s.startsWith("INF/") && parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (!/^\d+$/.test(p) && !p.startsWith("HDFC") && !p.startsWith("ICIC") && !["NEFT", "INFT", "DR", "CR", "INR"].includes(p) && p.length > 2) { vendor = p; break; }
    }
  } else if ((s.startsWith("NEFT-") || s.startsWith("RTGS-")) && s.includes("-")) {
    for (const p of s.split("-").map((x) => x.trim()).filter(Boolean)) {
      if (!/^\d+$/.test(p) && !/(SIBL|HDFC|SBIN|MAHB|BKID|RATN)[A-Z0-9]+/i.test(p) && !["NEFT", "RTGS", "FAST", "L S TECHNOLOGIES", "LS TECHNOLOGIES", "PRO", "ADVAN"].includes(p) && p.length > 2) { vendor = p; break; }
    }
  }
  if (vendor && !/^\d{2}\.\d{2}\.\d{4}/.test(vendor) && !/^\d+$/.test(vendor)) tags.push({ text: vendor, tone: "party" });
  return tags;
}

// Badge colour per status (docs + POs share it).
export function statusTone(status: string): string {
  switch (status) {
    case "pending": case "draft": case "reading": case "pending_type": return "bg-warning/15 text-warning border-warning/30";
    case "approved": case "dispatched": return "bg-success/15 text-success border-success/30";
    case "pushed": case "confirmed": return "bg-foreground text-background border-foreground";
    case "in_tally": return "bg-success text-white border-success";
    case "rejected": case "cancelled": case "extract_failed": case "push_failed": return "bg-destructive/10 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}
