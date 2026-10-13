// Names shown to people. The public demo (DEMO_MODE=1, electronics-erp.ahromlabs.com) uses a made-up
// company so neither LS Technologies' customers nor its partner store appear there. Keep in step with
// frontend/lib/brand.ts.
const DEMO = process.env.DEMO_MODE === '1';

module.exports = DEMO
  ? { company: 'Acme Components', short: 'Acme', partner: 'Partner store', partnerStore: 'Partner Store' }
  : { company: 'LS Technologies', short: 'LS Tech', partner: 'Gelco', partnerStore: 'Gelco Stores' };
