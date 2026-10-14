// Stages. Mirrored in frontend/lib/po-stages.ts — keep in sync.
// Procurement item (China order) stages, in order; the last one is set by receiving it (inward).
const PROC_STAGES = ['EQ', 'RM Procurement', 'Under Manufacturing', 'Under QC', 'In Transit', 'Received'];
// A customer PO line's status, least → most advanced (utils/poProgress.js derives it).
const LINE_STATUSES = ['Not planned', 'EQ', 'RM Procurement', 'Under Manufacturing', 'Under QC', 'In Transit', 'Ready', 'Dispatch', 'Completed'];
// Old hand-set PO stages (po_stages table) — no longer set; kept so old rows still read.
const PO_STAGES = ['EQ', 'RM Procurement', 'Under Manufacturing', 'Under QC', 'In Transit', 'Ready', 'Dispatch', 'Completed'];
const PO_DOC_TYPES = ['po', 'packing_list', 'invoice'];
module.exports = { PROC_STAGES, LINE_STATUSES, PO_STAGES, PO_DOC_TYPES };
