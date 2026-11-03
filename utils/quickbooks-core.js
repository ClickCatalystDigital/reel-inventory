// utils/quickbooks-core.js — QuickBooks Online connection, pure parts (no DB, no fetch), so the self-check
// (scripts/check-quickbooks.js) runs under plain node. Server side lives in utils/quickbooks.js.
// Same as structonova-ops' lib/quickbooks.mjs, with this app's own account list.
//
// Endpoints come from Intuit's discovery documents
// (https://developer.api.intuit.com/.well-known/openid_sandbox_configuration, /openid_configuration)
// and Intuit's official Node SDK, github.com/intuit/oauth-jsclient (src/OAuthClient.js).
// Sandbox and production share the OAuth endpoints; only the API base differs.

const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QBO_API_BASE = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};
const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
// ponytail: one minor version pinned for every call; raise it deliberately when a field needs it.
const QBO_MINOR_VERSION = '75';
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: QBO_SCOPE, redirect_uri: redirectUri, state });
  return `${QBO_AUTHORIZE_URL}?${q}`;
}

// Intuit returns lifetimes in seconds: expires_in (access, 3600) and x_refresh_token_expires_in.
function tokenTimes(resp, now = Date.now()) {
  const access = Number(resp?.expires_in);
  const refresh = Number(resp?.x_refresh_token_expires_in);
  if (!resp?.access_token || !resp?.refresh_token || !(access > 0)) throw new Error('QuickBooks returned an incomplete token response');
  return {
    access_expires_at: new Date(now + access * 1000).toISOString(),
    refresh_expires_at: refresh > 0 ? new Date(now + refresh * 1000).toISOString() : null,
  };
}

function needsRefresh(conn, now = Date.now()) {
  return !conn?.access_expires_at || new Date(conn.access_expires_at).getTime() - now < REFRESH_SKEW_MS;
}

// The state cookie carries who started the connect and for which company. Checked on the callback.
function checkState({ cookie, state, userId, now = Date.now() }) {
  if (!cookie || !state) return 'The connection request expired. Start again from Settings.';
  if (cookie.state !== state) return 'The connection request did not match. Start again from Settings.';
  if (cookie.userId !== userId) return 'Finish connecting while signed in as the person who started it.';
  if (!(cookie.exp > now)) return 'The connection request expired. Start again from Settings.';
  return null;
}

// Query response for `select * from Account` → plain list, active accounts only.
function normalizeAccounts(resp) {
  const rows = resp?.QueryResponse?.Account || [];
  return rows
    .filter(a => a.Active !== false)
    .map(a => ({ id: String(a.Id), name: a.FullyQualifiedName || a.Name, type: a.AccountType, subType: a.AccountSubType || null, number: a.AcctNum || null }))
    .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name));
}

// Which QuickBooks account types make sense for an local account type. Used to sort the dropdown
// and to warn, never to block: the accountant may know better.
const FIT = {
  asset: ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'],
  liability: ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'],
  equity: ['Equity'],
  income: ['Income', 'Other Income'],
  expense: ['Expense', 'Other Expense', 'Cost of Goods Sold'],
};
function accountFits(localType, qboType) {
  return (FIT[localType] || []).includes(qboType);
}

// Validates an incoming map {code: qboAccountId|''} against the company's own codes and the
// QuickBooks account list. Blank = unmapped (allowed). Returns {rows, error}.
function cleanAccountMap(map, localCodes, qboIds) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: 'Send the mapping as {code: accountId}' };
  const codes = new Set(localCodes.map(String));
  const ids = new Set(qboIds.map(String));
  const rows = [];
  for (const [code, raw] of Object.entries(map)) {
    if (!codes.has(code)) return { error: `Unknown account code ${code}` };
    const id = raw == null ? '' : String(raw).trim();
    if (id && !ids.has(id)) return { error: `QuickBooks account ${id} was not found; reload the list` };
    rows.push({ code, qbo_account_id: id || null });
  }
  return { rows };
}

// LS Inventory has no chart of accounts: the ledgers the finance screens already show (the books) are what get
// mapped, in US words. code = stable key, account_type = which QuickBooks account types fit (accountFits).
const LOCAL_ACCOUNTS = [
  { code: 'bank', name: 'Bank', account_type: 'asset' },
  { code: 'receivables', name: 'Accounts receivable', account_type: 'asset' },
  { code: 'payables', name: 'Accounts payable', account_type: 'liability' },
  { code: 'sales', name: 'Sales', account_type: 'income' },
  { code: 'inventory', name: 'Inventory', account_type: 'asset' },
  { code: 'purchases', name: 'Purchases', account_type: 'expense' },
  { code: 'freight', name: 'Freight expense', account_type: 'expense' },
];

// Suggested matches shown right after connecting, so the owner reviews a filled-in table instead of picking every
// row. First rule whose local pattern matches wins; an exact name match beats every rule. Sales tax is never
// suggested: QuickBooks' automated sales tax posts to its own agency accounts.
const SUGGEST = [
  [/sales tax|tax payable/i, () => false],
  [/bank charge/i, q => q.subType === 'BankCharges'],
  [/bank|cash/i, q => q.subType === 'Checking' || q.type === 'Bank'],
  [/receivable/i, q => q.type === 'Accounts Receivable'],
  [/payable/i, q => q.type === 'Accounts Payable'],
  [/inventory|raw material/i, q => q.subType === 'Inventory'],
  [/prepaid/i, q => q.subType === 'PrepaidExpenses'],
  [/equity|capital/i, q => q.subType === 'OpeningBalanceEquity'],
  [/depreciation exp/i, q => q.subType === 'Depreciation'],
  [/purchase|material|cost of goods|cogs/i, q => q.type === 'Cost of Goods Sold'],
  [/freight|shipping/i, q => /freight|shipping|delivery/i.test(q.name)],
  [/sales|revenue|receipt|income/i, q => q.subType === 'SalesOfProductIncome'],
];
function suggestAccountMap(localAccounts, qboAccounts) {
  const map = {};
  for (const a of localAccounts) {
    const exact = qboAccounts.find(q => q.name.toLowerCase() === a.name.toLowerCase() && accountFits(a.account_type, q.type));
    const rule = SUGGEST.find(([re]) => re.test(a.name));
    const hit = exact || (rule && qboAccounts.find(q => rule[1](q) && accountFits(a.account_type, q.type)));
    if (hit) map[a.code] = hit.id;
  }
  return map;
}

module.exports = {
  QBO_AUTHORIZE_URL, QBO_TOKEN_URL, QBO_REVOKE_URL, QBO_API_BASE, QBO_SCOPE, QBO_MINOR_VERSION, REFRESH_SKEW_MS, STATE_TTL_MS,
  authorizeUrl, tokenTimes, needsRefresh, checkState, normalizeAccounts, accountFits, cleanAccountMap, LOCAL_ACCOUNTS, suggestAccountMap,
};
