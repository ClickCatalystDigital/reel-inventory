// Names shown on screen. The public demo build (NEXT_PUBLIC_DEMO=1, electronics-erp.ahromlabs.com) uses a
// made-up company so neither LS Technologies' customers nor its partner store appear there. Keep in step
// with ../utils/brand.js.
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export const BRAND = DEMO
  ? { company: "Acme Components", short: "Acme", partner: "Partner store", partnerStore: "Partner Store" }
  : { company: "LS Technologies", short: "LS Tech", partner: "Gelco", partnerStore: "Gelco Stores" };
