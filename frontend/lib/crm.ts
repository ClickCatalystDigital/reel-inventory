// Shared CRM types + small helpers for the Home and Clients pages (ported from ls_crm's inline scripts).

export interface Task {
  id: number;
  title: string;
  due_date: string; // YYYY-MM-DD
  status: string;
  assigned_to: string | null;
  invoice_id?: number | null;
  contact_id?: number | null;
  poc_name?: string | null;
  company_name?: string | null;
}

export interface TaskDetail extends Task {
  designation: string | null;
  email: string | null;
  phone: string | null;
  contact_status: string | null;
  crm_contact_id: number | null;
  last_note: { body: string; created_by: string; created_at: string } | null;
}

export interface Alert {
  id: number;
  poc_name: string;
  status: string;
  company_name: string | null;
}

export interface Client {
  id: number;
  company_id: number | null;
  poc_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  product_id: number | null;
  severity: number;
  company_name: string | null;
  product_name: string | null;
  updated_at: string;
}

export interface Note {
  id: number;
  body: string;
  created_by: string;
  created_at: string;
}

export interface ClientDetail extends Client {
  notes: Note[];
}

export interface Metrics {
  total: number;
  qualified: number;
  customers: number;
  conversion: number;
  byStatus: Record<string, number>;
}

export interface Product {
  id: number;
  name: string;
}

export interface Assignee {
  username: string;
  role: string;
}

export interface Invoice {
  id: number;
  status: string;
  invoice_no: string | null;
  original_filename: string | null;
  party_name: string | null;
  invoice_date: string | null;
  commodity: string | null;
  taxable_value: number | null;
  total_tax: number | null;
  net_amount: number | null;
  line_items: { description?: string }[] | null;
}

export const PIPELINE_STAGES = ["new", "contacted", "qualified", "customer", "lost"] as const;
export const SEVERITIES = [
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
] as const;

export const isApproverRole = (role: string | undefined) => role === "admin" || role === "manager";

// Where a task came from, driving its colour (same precedence as the CRM's getTaskOriginClass).
export type TaskOrigin = "payment" | "doc" | "po" | "client" | "manual";

export function originOf(t: Pick<Task, "title" | "invoice_id" | "contact_id"> & { crm_contact_id?: number | null }): TaskOrigin {
  if (t.title.includes("Payment Reminder")) return "payment";
  if (t.invoice_id) return "doc";
  if (t.title.includes("Dispatch PO") || t.title.includes("Post-dispatch follow up")) return "po";
  if (t.contact_id || t.crm_contact_id) return "client";
  return "manual";
}

// Full class strings (not built dynamically) so Tailwind keeps them.
export const ORIGIN_STYLE: Record<TaskOrigin, { chip: string; label: string; dot: string }> = {
  payment: { chip: "border-l-rose-500 bg-rose-500/10", label: "Payment", dot: "bg-rose-500" },
  doc: { chip: "border-l-teal-500 bg-teal-500/10", label: "Document", dot: "bg-teal-500" },
  po: { chip: "border-l-blue-500 bg-blue-500/10", label: "Purchase order", dot: "bg-blue-500" },
  client: { chip: "border-l-purple-500 bg-purple-500/10", label: "Client", dot: "bg-purple-500" },
  manual: { chip: "border-l-amber-500 bg-amber-500/10", label: "Manual", dot: "bg-amber-500" },
};

const AVATAR_COLORS = [
  "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-rose-600", "bg-amber-600",
  "bg-cyan-600", "bg-fuchsia-600", "bg-lime-700", "bg-orange-600", "bg-indigo-600",
];

export function avatarColor(username: string): string {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsFor(username: string): string {
  const parts = username.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// "5 Oct 2026" from a YYYY-MM-DD string without any timezone shift.
export function fmtTaskDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const inr = (v: number | null | undefined) =>
  "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

export function clientStatusClass(status: string): string {
  if (status === "qualified" || status === "customer") return "bg-success/10 text-success border-success/20";
  if (status === "lost") return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-warning/10 text-warning border-warning/20";
}

export function severityClass(sev: number): string {
  if (sev >= 3) return "text-destructive";
  if (sev === 2) return "text-warning";
  return "text-success";
}
