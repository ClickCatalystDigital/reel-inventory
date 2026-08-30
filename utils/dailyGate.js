const { queryOne, istDateString } = require('../db/schema');

async function isGateApprovedToday(storeCode) {
  const row = await queryOne(
    'SELECT 1 as x FROM daily_gate_approvals WHERE store_code = ? AND gate_date = ?',
    [storeCode, istDateString()]
  );
  return !!row;
}

module.exports = { isGateApprovedToday };
