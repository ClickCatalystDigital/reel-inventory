// Which market this deployment serves: MARKET=NA is the American demo (electronics-erp-us.ahromlabs.com); unset = IN, which is
// lstechnologies.in and the Indian demo, unchanged. One profile per deployment, never per visitor. Keep in step with
// frontend/lib/market.ts.
const NA = process.env.MARKET === 'NA';

const P = NA
  ? { NA, LOCALE: 'en-US', symbol: '$', timeZone: 'America/Chicago', tzLabel: 'Central Time', paper: 'LETTER' }
  : { NA, LOCALE: 'en-IN', symbol: '₹', timeZone: 'Asia/Kolkata', tzLabel: 'IST', paper: 'A4' };

const locale = () => P.LOCALE;
const money = (n, digits = 2) => P.symbol + Number(n || 0).toLocaleString(P.LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Wall-clock 'YYYY-MM-DD HH:MM:SS' in the market's time zone: every stored timestamp is this naive local time.
// India keeps its fixed +5:30 arithmetic; America/Chicago needs Intl for daylight saving.
const CT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const wallClock = (d = new Date()) => (NA ? CT.format(d).replace(',', '') : new Date(d.getTime() + 5.5 * 3600e3).toISOString().replace('T', ' ').substring(0, 19));

module.exports = { ...P, locale, money, wallClock };
