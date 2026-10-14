// Mirrors utils/poStages.js — keep in sync.
export const PO_STAGES = ["EQ", "RM Procurement", "Under Manufacturing", "Under QC", "In Transit", "Ready", "Dispatch", "Completed"] as const;
export const PO_STAGE_HINT: Record<string, string> = { EQ: "Engineering Questions" };
export const PO_DOC_TYPES = [
  { value: "po", label: "PO" },
  { value: "packing_list", label: "Packing List" },
  { value: "invoice", label: "Invoice" },
] as const;
export const docTypeLabel = (t: string) => PO_DOC_TYPES.find((d) => d.value === t)?.label ?? t;

export interface PoLine { id: number; po_id: number; item_code: string; quantity_ordered: number; description: string | null; in_stock?: number }
export interface PoLot { id: number; po_id: number; item_code: string; quantity: number; dispatch_date: string | null; notes: string | null; updated_by?: string; updated_at: string }
export interface PoDoc { id: number; po_id: number; doc_type: string; original_filename: string; uploaded_by?: string; uploaded_at: string }
export interface PoDetail {
  id: number; po_number: string; status?: string; order_date: string | null; expected_dispatch_date: string | null;
  company_name: string | null; stage: string | null; stage_updated_at: string | null; stage_updated_by?: string | null;
  lines: PoLine[]; dispatches: PoLot[]; docs: PoDoc[];
}
