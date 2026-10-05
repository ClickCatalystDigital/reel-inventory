// The only screens the assistant may link to (mirrors utils/assistantGuide.js). Anything else renders as plain text.
export const ASSISTANT_PATHS = new Set([
  "/", "/clients", "/catalog", "/inward", "/outward", "/transfer", "/reports", "/reports/search", "/reports/analytics",
  "/reports/alerts", "/reports/daily", "/requests", "/notifications", "/gelco-docs", "/settings",
]);
export const safePath = (p: string | null | undefined) => (p && ASSISTANT_PATHS.has(p) ? p : null);

export interface ReplyColumn { key: string; label: string; type?: "int" | "date" | "text" }
export interface ReplyLink { path: string; label: string }
export interface ReplyOption { label: string; send: string }
export interface Reply {
  type: "text" | "table" | "ask";
  text?: string | null;
  title?: string;
  link?: ReplyLink | null;
  chips?: ReplyOption[];
  options?: ReplyOption[];
  toolLabel?: string;
  summary?: string;
  params?: { label: string; value: string }[];
  columns?: ReplyColumn[];
  rows?: Record<string, string | number | null>[];
  total?: number;
  truncated?: boolean;
  note?: string | null;
  context?: Record<string, unknown> | null; // sent back with the next question so "and last month?" works
  cards?: Reply[]; // a second look-up answered in the same turn
}

export interface Briefing {
  part: "morning" | "afternoon" | "evening";
  day: string;
  dayLabel: string;
  headline: string;
  items: { label: string; value: string; tone?: "warn" | null; link?: string }[];
}
