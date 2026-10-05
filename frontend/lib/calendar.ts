// Pure date math for the Home calendar. Dates are plain YYYY-MM-DD strings and every Date is built/read in
// UTC, so the grid never shifts with the browser's timezone (task due dates are calendar dates, not instants).

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type CalView = "week" | "month" | "year";

export const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const toISO = (d: Date) => d.toISOString().substring(0, 10);
export const addDays = (iso: string, n: number) => {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};
export const startOfWeek = (iso: string) => addDays(iso, -parseISO(iso).getUTCDay()); // weeks start on Sunday, like the CRM
export const dayOf = (iso: string) => parseISO(iso).getUTCDate();
export const monthOf = (iso: string) => parseISO(iso).getUTCMonth();
export const yearOf = (iso: string) => parseISO(iso).getUTCFullYear();

export function weekDays(anchor: string): string[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Whole weeks covering the month (Sun-first), at most 6 rows.
export function monthCells(anchor: string): string[] {
  const y = yearOf(anchor), m = monthOf(anchor);
  const first = toISO(new Date(Date.UTC(y, m, 1)));
  const last = toISO(new Date(Date.UTC(y, m + 1, 0)));
  const cells: string[] = [];
  let cur = startOfWeek(first);
  while ((cur <= last || parseISO(cur).getUTCDay() !== 0) && cells.length < 42) {
    cells.push(cur);
    cur = addDays(cur, 1);
  }
  return cells;
}

export function shiftAnchor(view: CalView, anchor: string, dir: number): string {
  if (view === "week") return addDays(anchor, dir * 7);
  const d = parseISO(anchor);
  if (view === "month") d.setUTCMonth(d.getUTCMonth() + dir, 1);
  else d.setUTCFullYear(d.getUTCFullYear() + dir, d.getUTCMonth(), 1);
  return toISO(d);
}

// The date range a view needs from /api/tasks/range.
export function windowFor(view: CalView, anchor: string): { from: string; to: string } {
  if (view === "week") { const w = weekDays(anchor); return { from: w[0], to: w[6] }; }
  if (view === "month") { const c = monthCells(anchor); return { from: c[0], to: c[c.length - 1] }; }
  const y = yearOf(anchor);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function periodLabel(view: CalView, anchor: string): string {
  if (view === "year") return String(yearOf(anchor));
  if (view === "month") return `${MONTHS[monthOf(anchor)]} ${yearOf(anchor)}`;
  const w = weekDays(anchor);
  const f = (iso: string) => `${dayOf(iso)} ${MONTHS[monthOf(iso)].slice(0, 3)}`;
  return `${f(w[0])} – ${f(w[6])}`;
}

export function groupByDate<T extends { due_date: string }>(tasks: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  tasks.forEach((t) => (out[t.due_date] ||= []).push(t));
  return out;
}
