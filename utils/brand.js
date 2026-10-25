// Names shown to people. The public demo (DEMO_MODE=1, electronics-erp.ahromlabs.com) uses a made-up
// company so neither LS Technologies' customers nor its partner store appear there. Keep in step with
// frontend/lib/brand.ts.
const DEMO = process.env.DEMO_MODE === '1';

const brand = DEMO
  ? { app: 'Inventory Ops', ai: 'Ohm AI', company: 'Acme Components', short: 'Acme', partner: 'Partner store', partnerStore: 'Partner Store', mainStore: 'Main Store' }
  : { app: 'LS TECH', ai: 'Ohm AI', company: 'LS Technologies', short: 'LS Tech', partner: 'Gelco', partnerStore: 'Gelco Stores', mainStore: 'LS Tech Stores' };

// The AI assistant's prompts, guide and example questions are written with the real names. In the demo they read
// with the made-up ones instead (longest names first). Identity on the live site.
const SWAPS = [
  [/Gelco Electronics/g, 'Brightline Appliances'], [/Gelco POs/g, 'Brightline POs'], [/with Gelco\b/g, 'with Brightline'], [/does Gelco order/g, 'does Brightline order'],
  [/Gelco Stores/g, 'Partner Store'], [/Gelco (Manager|Worker)/g, (m, r) => `partner store ${r.toLowerCase()}`], [/gelco stores/g, 'partner store'], [/\bGelco\b/g, 'Partner store'], [/\bGELCO\b/g, 'PARTNER STORE'],
  [/LS Tech Stores/g, 'Main Store'], [/L ?S Technologies/gi, 'Acme Components'], [/LS TECH\b/g, 'Inventory Ops'], [/LS Tech\b/g, 'Acme'],
  [/\bpranav\b/gi, 'manager'], [/\bzakir\b/gi, 'manager'], [/\bsahil\b/gi, 'store'], [/\bSansui\b/gi, 'Voltix'], [/\bRotomotive\b/gi, 'Orbit Power'],
  [/BLDC CARD/g, 'PCBA-BLDC-01'], [/P0055838/g, 'SYS-2'],
];
const text = (s) => (DEMO && typeof s === 'string' ? SWAPS.reduce((t, [a, b]) => t.replace(a, b), s) : s);
// Same, for every string inside an object/array (functions and other values kept as they are).
const deep = (v) => {
  if (!DEMO) return v;
  if (typeof v === 'string') return text(v);
  if (Array.isArray(v)) return v.map(deep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
  return v;
};

module.exports = { ...brand, text, deep };
