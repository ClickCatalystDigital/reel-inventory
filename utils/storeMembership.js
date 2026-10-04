// SQL fragment: "this item has ever had stock at a store" — used so an item whose
// last reel there was outwarded/moved keeps showing (with 0 Qty) instead of vanishing.
// Needs 2 params, in order: store, store. `itemCodeExpr` is the outer item_code column.
// Branch 1: a non-deleted reel (any status) currently sits at the store.
// Branch 2: a reel of this item was transferred out of the store (its store_code has
// since changed, so branch 1 alone would miss an item that fully moved away).
function hadStockAtStore(itemCodeExpr) {
  return `(
    EXISTS (SELECT 1 FROM reels hr WHERE hr.item_code = ${itemCodeExpr} AND hr.store_code = ? AND hr.status != 'Deleted')
    OR EXISTS (SELECT 1 FROM stock_transfers hst JOIN reels hr2 ON hr2.reel_number = hst.reel_number
               WHERE hr2.item_code = ${itemCodeExpr} AND hst.from_store = ?)
  )`;
}

module.exports = { hadStockAtStore };
