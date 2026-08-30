// Ports of public/js/app.js's formatDate/formatDateTime/formatQty/statusBadge.
// The IST-naive-string parsing must stay exact: the backend returns naive
// SQLite datetime strings with no timezone, so "format in browser local time"
// would silently be wrong for anyone not in IST.

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T") + "+05:30");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T") + "+05:30");
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatQty(n: number | null | undefined): string {
  return (n || 0).toLocaleString("en-IN");
}

export function todayISTDateString(): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffset).toISOString().substring(0, 10);
}

export type BadgeVariant = "success" | "warning" | "danger";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  "In Stock": "success",
  Outwarded: "danger",
  Partial: "warning",
  Deleted: "danger",
};

export function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANT[status] || "warning";
}
