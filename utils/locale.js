// Number and date style: Indian (1,00,000) unless this is the public demo and the visitor is in North America (the
// `mkt` cookie worker.mjs sets in demo mode). The client deployment never sets it, so it always stays en-IN.
// Money keeps ₹: the demo company's books are in rupees, so only the digit grouping and date order change.
const { AsyncLocalStorage } = require('node:async_hooks');

const scope = new AsyncLocalStorage();
const locale = () => scope.getStore() || 'en-IN';
const fromCookie = (cookie) => (/(?:^|;\s*)mkt=NA(?:;|$)/.test(cookie || '') ? 'en-US' : 'en-IN');
const runIn = (loc, fn) => scope.run(loc, fn);

module.exports = { locale, fromCookie, runIn };
