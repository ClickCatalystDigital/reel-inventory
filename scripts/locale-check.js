// node scripts/locale-check.js — the demo number style: Indian by default, US only inside a North American visit.
const { locale, fromCookie, runIn } = require("../utils/locale");
const assert = require('node:assert');
assert.equal(locale(), 'en-IN');
assert.equal(fromCookie('a=1; mkt=NA'), 'en-US');
assert.equal(fromCookie('mkt=IN'), 'en-IN');
assert.equal(fromCookie(undefined), 'en-IN');
runIn('en-US', async () => { await null; assert.equal(locale(), 'en-US'); assert.equal((123456).toLocaleString(locale()), '123,456'); console.log('locale ok'); });
