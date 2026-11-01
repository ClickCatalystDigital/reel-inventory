// Number and date style for the page: US (100,000) for a North American visitor on the public demo, else Indian
// (1,00,000). worker.mjs sets the `mkt` cookie only in demo mode, so the client deployment always gets en-IN.
export const LOCALE = (): "en-US" | "en-IN" =>
  typeof document !== "undefined" && /(?:^|;\s*)mkt=NA(?:;|$)/.test(document.cookie) ? "en-US" : "en-IN";
