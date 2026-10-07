// Per-item visibility for logins outside LS Tech: an item is visible to a client/Gelco login only if it's
// assigned (item_visibility) to a CRM company that login belongs to (user_companies). Unassigned = hidden.

const ITEM_CATEGORIES = [
  'Diode', 'Electrolytic Capacitor', 'FILM CAP', 'IC', 'MLCC', 'MOV', 'PCBA',
  'Printed Circuit Board', 'RESISTOR', 'SLCC', 'SMD Tan Cap', 'Transistor',
];

// SQL fragment, 1 param: the user's id. `itemCodeExpr` is the outer item_code column.
function visibleToUser(itemCodeExpr) {
  return `EXISTS (SELECT 1 FROM item_visibility v JOIN user_companies uc ON uc.company_id = v.company_id
                  WHERE v.item_code = ${itemCodeExpr} AND uc.user_id = ?)`;
}

// Clients: everywhere they see stock. Gelco: only LS Tech stock — Gelco Stores stock is their own.
function needsVisibilityFilter(user, store) {
  if (user.role === 'client') return true;
  if (user.role === 'gelco_manager' || user.role === 'gelco_worker') return store !== 'secondary';
  return false;
}

// Turns a request's company id list into clean integers (null = field not sent).
function parseCompanyIds(v) {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

module.exports = { ITEM_CATEGORIES, visibleToUser, needsVisibilityFilter, parseCompanyIds };
