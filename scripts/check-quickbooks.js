// node scripts/check-quickbooks.js
const assert = require('node:assert/strict');
const { authorizeUrl, tokenTimes, needsRefresh, checkState, normalizeAccounts, accountFits, cleanAccountMap, suggestAccountMap, LOCAL_ACCOUNTS, QBO_SCOPE } = require('../utils/quickbooks-core');

const u = new URL(authorizeUrl({ clientId: 'abc', redirectUri: 'https://x.test/api/quickbooks/callback', state: 's1' }));
assert.equal(u.origin + u.pathname, 'https://appcenter.intuit.com/connect/oauth2');
assert.equal(u.searchParams.get('scope'), QBO_SCOPE);
assert.equal(u.searchParams.get('response_type'), 'code');
assert.equal(u.searchParams.get('redirect_uri'), 'https://x.test/api/quickbooks/callback');

const now = Date.UTC(2026, 10, 3);
const t = tokenTimes({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8726400 }, now);
assert.equal(t.access_expires_at, new Date(now + 3600e3).toISOString());
assert.equal(t.refresh_expires_at, new Date(now + 8726400e3).toISOString());
assert.throws(() => tokenTimes({ access_token: 'a', expires_in: 3600 }, now));

assert.equal(needsRefresh({ access_expires_at: new Date(now + 60e3).toISOString() }, now), true);
assert.equal(needsRefresh({ access_expires_at: new Date(now + 30 * 60e3).toISOString() }, now), false);
assert.equal(needsRefresh({}, now), true);

const cookie = { state: 's1', userId: 'owner', exp: now + 1000 };
assert.equal(checkState({ cookie, state: 's1', userId: 'owner', now }), null);
assert.match(checkState({ cookie, state: 'x', userId: 'owner', now }), /did not match/);
assert.match(checkState({ cookie, state: 's1', userId: 'other', now }), /signed in/);
assert.match(checkState({ cookie, state: 's1', userId: 'owner', now: now + 2000 }), /expired/);
assert.match(checkState({ cookie: null, state: 's1', userId: 'owner', now }), /expired/);

const accts = normalizeAccounts({ QueryResponse: { Account: [
  { Id: 2, Name: 'Sales', AccountType: 'Income', Active: true },
  { Id: 1, Name: 'Checking', AccountType: 'Bank' },
  { Id: 3, Name: 'Old', AccountType: 'Bank', Active: false },
] } });
assert.deepEqual(accts.map(a => a.id), ['1', '2']);
assert.equal(accountFits('asset', 'Bank'), true);
assert.equal(accountFits('income', 'Bank'), false);

assert.deepEqual(cleanAccountMap({ bank: '1', sales: '' }, ['bank', 'sales'], ['1', '2']).rows,
  [{ code: 'bank', qbo_account_id: '1' }, { code: 'sales', qbo_account_id: null }]);
assert.match(cleanAccountMap({ nope: '1' }, ['bank'], ['1']).error, /Unknown/);
assert.match(cleanAccountMap({ bank: '99' }, ['bank'], ['1']).error, /not found/);
assert.match(cleanAccountMap([], ['bank'], ['1']).error, /mapping/);

const qbo = [
  { id: '35', name: 'Checking', type: 'Bank', subType: 'Checking' },
  { id: '84', name: 'Accounts Receivable (A/R)', type: 'Accounts Receivable' },
  { id: '33', name: 'Accounts Payable (A/P)', type: 'Accounts Payable' },
  { id: '79', name: 'Sales of Product Income', type: 'Income', subType: 'SalesOfProductIncome' },
  { id: '81', name: 'Inventory Asset', type: 'Other Current Asset', subType: 'Inventory' },
  { id: '80', name: 'Cost of Goods Sold', type: 'Cost of Goods Sold' },
  { id: '60', name: 'Freight and delivery', type: 'Expense' },
  { id: '89', name: 'Board of Equalization Payable', type: 'Other Current Liability', subType: 'GlobalTaxPayable' },
];
assert.deepEqual(suggestAccountMap(LOCAL_ACCOUNTS, qbo),
  { bank: '35', receivables: '84', payables: '33', sales: '79', inventory: '81', purchases: '80', freight: '60' });
assert.deepEqual(suggestAccountMap([{ code: 'tax', name: 'Sales Tax Payable', account_type: 'liability' }], qbo), {});

console.log('quickbooks selfcheck ok');
