// The only screens the assistant may link to (mirrors utils/assistantGuide.js). Anything else renders as plain text.
export const ASSISTANT_PATHS = new Set([
  "/", "/clients", "/catalog", "/inward", "/outward", "/transfer", "/reports", "/reports/search", "/reports/analytics",
  "/reports/alerts", "/reports/daily", "/requests", "/notifications", "/gelco-docs", "/settings",
]);
export const safePath = (p: string | null | undefined) => (p && ASSISTANT_PATHS.has(p) ? p : null);

export interface ReplyColumn { key: string; label: string; type?: "int" | "date" | "text" }
export interface ReplyLink { path: string; label: string }
export interface ReplyOption { label: string; send: string }
// A change Ohm AI prepared (utils/assistantActions.js): every field editable, nothing saved until Save.
export interface DraftField {
  name: string; label: string; required: boolean;
  type: "text" | "longtext" | "number" | "money" | "date" | "enum" | "ref" | "phone" | "email" | "unit" | "units";
  ref?: string; value: string | number | null; display?: string; error?: string;
  options?: { value: string | number; label: string }[];
}
export interface ActionDraft {
  kind: "action"; action: string; risk: "create" | "change" | "delete"; summary: string;
  fields: DraftField[]; values: Record<string, string | number | null>; missing: string[]; errors: string[]; ready: boolean;
  auto?: boolean; // this person's Auto may save it at once (the server checks again)
}
export interface Reply {
  type: "text" | "table" | "ask" | "draft";
  draft?: ActionDraft;
  text?: string | null;
  title?: string;
  link?: ReplyLink | null;
  chips?: ReplyOption[];
  options?: ReplyOption[];
  tool?: string;
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
