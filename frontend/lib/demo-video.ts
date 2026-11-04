// The narrated tour on YouTube: embedded above the demo form (app/demo/page.tsx) and described to search engines as a
// VideoObject next to the product (app/demo/layout.tsx). India build only: the tour shows rupees and GST.
const NA = process.env.NEXT_PUBLIC_MARKET === "NA"; // per module, see lib/market.ts

export const DEMO_VIDEO = NA ? null : {
  id: "Cb2MgE5OF4o",
  name: "Electronic Component Inventory ERP: a 90-Second Tour (Inventory Ops live demo, sample company)",
  description: "A tour of Inventory Ops with a made-up component distributor: the master catalog, reels received into boxes with QR labels, scan-cart outward against invoices, transfers between stores, approvals, customers, orders, receivables checked against Tally and the stock summary.",
  duration: "PT1M36S",
  uploadDate: "2026-11-04",
};
