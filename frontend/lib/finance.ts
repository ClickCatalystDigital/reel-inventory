// Shared helpers for the Finance page (ported from ls_crm's finance.html).

export const INR = (n: number | null | undefined) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

// Tally dates are plain 'YYYY-MM-DD' calendar days.
export function finDate(d: string | null | undefined): string {
  if (!d || d === "null") return "—";
  const s = String(d).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(d);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const daysTo = (d: string | null | undefined) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : 999);

export function epochToRelative(epoch: number | string | null | undefined): string {
  if (!epoch) return "never";
  const diff = Math.floor(Date.now() / 1000 - Number(epoch));
  if (diff < 120) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

interface BillRef { name?: string; date?: string; amount?: number; credit_days?: number }
// Tally's DayBook sets a sales voucher's amount to 0; the bill allocations carry it.
export function resolveAmt(v: { amount?: number | null; bill_refs?: string | BillRef[] | null }): number {
  let amt = Math.abs(v.amount || 0);
  if (!amt) {
    try {
      const refs: BillRef[] = typeof v.bill_refs === "string" ? JSON.parse(v.bill_refs || "[]") : v.bill_refs || [];
      amt = refs.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
    } catch {
      // unparseable refs: no amount
    }
  }
  return amt;
}

export type Period = "month" | "lastmonth" | "fy" | "all" | "custom";
export const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "This Month" },
  { value: "lastmonth", label: "Last Month" },
  { value: "fy", label: "This FY" },
  { value: "all", label: "All Time" },
];

// Query string for a period (financial year starts 1 April). '' = all time.
export function periodQuery(p: Period, custom?: { from: string; to: string }): string {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (p === "month") return `from=${y}-${pad(m + 1)}-01&to=${iso(now)}`;
  if (p === "lastmonth") return `from=${iso(new Date(y, m - 1, 1))}&to=${iso(new Date(y, m, 0))}`;
  if (p === "fy") return `from=${m >= 3 ? y : y - 1}-04-01&to=${iso(now)}`;
  if (p === "custom" && custom?.from && custom?.to) return `from=${custom.from}&to=${custom.to}`;
  return "";
}
