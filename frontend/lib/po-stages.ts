// Mirrors utils/poStages.js — keep in sync.
// Procurement item stages; "Received" is set by inwarding against the item.
export const PROC_STAGES = ["EQ", "RM Procurement", "Under Manufacturing", "Under QC", "In Transit", "Received"] as const;
// Customer PO line status, least → most advanced (derived on the server, utils/poProgress.js).
export const LINE_STATUSES = ["Not planned", "EQ", "RM Procurement", "Under Manufacturing", "Under QC", "In Transit", "Ready", "Dispatch", "Completed"] as const;
// The steps a customer sees (Not planned = before the first).
export const PO_STAGES = LINE_STATUSES.slice(1);
export const PO_STAGE_HINT: Record<string, string> = { EQ: "Engineering Questions" };
export const PO_DOC_TYPES = [
  { value: "po", label: "PO" },
  { value: "packing_list", label: "Packing List" },
  { value: "invoice", label: "Invoice" },
] as const;
export const docTypeLabel = (t: string) => PO_DOC_TYPES.find((d) => d.value === t)?.label ?? t;

export interface LineProcurement { proc_id: number; proc_item_id: number; number: string; stage: string; qty: number; expected_date: string | null }
export interface PoLine {
  id: number; po_id: number; item_code: string | null; quantity_ordered: number; description: string | null;
  ordered: number; dispatched: number; reserved: number; reserved_reels?: number; in_procurement: number; needed: number; status: string;
  procurement?: LineProcurement[]; free_stock?: number; expected_date?: string | null;
}
export interface PoLot { id: number; po_id: number; item_code: string; quantity: number; dispatch_date: string | null; notes: string | null; updated_by?: string; updated_at: string }
export interface PoDoc { id: number; po_id: number; doc_type: string; original_filename: string; uploaded_by?: string; uploaded_at: string }
export interface PoDetail {
  id: number; po_number: string; status?: string; order_date: string | null; expected_dispatch_date: string | null;
  company_name: string | null; stage: string;
  lines: PoLine[]; dispatches: PoLot[]; docs: PoDoc[];
}
