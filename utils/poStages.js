// PO production stages (routes/orders.js). Mirrored in frontend/lib/po-stages.ts — keep in sync.
// Separate from crm_purchase_orders.status, which belongs to ls_crm.
const PO_STAGES = ['EQ', 'RM Procurement', 'Under Manufacturing', 'Under QC', 'In Transit', 'Ready', 'Dispatch', 'Completed'];
const PO_DOC_TYPES = ['po', 'packing_list', 'invoice'];
module.exports = { PO_STAGES, PO_DOC_TYPES };
