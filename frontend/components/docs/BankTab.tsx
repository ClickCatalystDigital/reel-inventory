"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Paperclip, Plus, Save, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { docDate, lines, money, smartTags, type Invoice, type LineItem, type Tag } from "@/lib/docs";
import { Kpi } from "./bits";
import { useDocs } from "./context";

type SortCol = "date" | "description" | "withdrawal" | "deposit";
const bankOf = (r: Invoice) => r.bank_ledger || "Unassigned";

// Bank statements: one sub-tab per bank, a period picker, account summary and a sortable, searchable
// transaction table with per-line notes and supporting files.
export function BankTab() {
  const docs = useDocs();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [bank, setBank] = useState<string | null>(null);
  const [stmtId, setStmtId] = useState<number | null>(null);
  const [stmt, setStmt] = useState<Invoice | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "date", dir: "asc" });
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Invoice[]>("/api/invoices").then((r) => setRows(r.filter((d) => d.doc_type === "bank_statement"))).catch(() => {});
  }, [docs.version]);

  const banks = useMemo(() => [...new Set(rows.map(bankOf))].sort(), [rows]);
  const activeBank = bank && banks.includes(bank) ? bank : banks[0] ?? null;
  const stmts = rows.filter((r) => bankOf(r) === activeBank);
  const activeStmt = stmtId && stmts.some((s) => s.id === stmtId) ? stmtId : stmts[0]?.id ?? null;

  useEffect(() => {
    if (!activeStmt) return;
    setStmt(null);
    api<Invoice>(`/api/invoices/${activeStmt}`).then((s) => { setStmt(s); setItems(lines(s)); }).catch(() => {});
  }, [activeStmt, docs.version]);

  function pick(b: string | null, s: number | null) {
    setBank(b); setStmtId(s); setQ(""); setFrom(""); setTo("");
  }
  async function save(next: LineItem[], msg: string) {
    if (!activeStmt) return;
    try {
      await api(`/api/invoices/${activeStmt}`, { method: "PUT", body: { line_items: next } });
      showToast(msg, "success");
    } catch {
      // api() already toasted
    }
  }
  async function attach(i: number, f: File) {
    const fd = new FormData();
    fd.append("file", f);
    showToast("Uploading…", "success");
    try {
      const res = await fetch("/api/invoices/attachment", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const next = items.map((li, j) => (j === i ? { ...li, attachment_url: data.file_url } : li));
      setItems(next);
      await save(next, "Attached");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed", "error");
    }
  }
  async function detach(i: number) {
    try {
      await api("/api/invoices/attachment", { method: "DELETE", body: { url: items[i].attachment_url } });
      const next = items.map((li, j) => (j === i ? { ...li, attachment_url: null } : li));
      setItems(next);
      await save(next, "Removed");
    } catch {
      // api() already toasted
    }
  }

  const shown = useMemo(() => {
    const t = q.toLowerCase();
    const r = items.map((li, i) => ({ li, i })).filter(({ li }) =>
      (!t || (li.description || "").toLowerCase().includes(t) || (li.comment || "").toLowerCase().includes(t)) &&
      !(from && li.date && li.date < from) && !(to && li.date && li.date > to));
    const val = ({ li }: { li: LineItem }) => {
      const a = Number(li.amount) || 0;
      return sort.col === "description" ? (li.description || "").toLowerCase() : sort.col === "withdrawal" ? (a < 0 ? -a : 0) : sort.col === "deposit" ? (a > 0 ? a : 0) : li.date || "";
    };
    return r.sort((a, b) => { const [x, y] = [val(a), val(b)]; return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1); });
  }, [items, q, from, to, sort]);

  const dates = items.map((l) => l.date).filter(Boolean).sort() as string[];
  const periodFrom = from || dates[0] || stmt?.statement_from;
  const periodTo = to || dates[dates.length - 1] || stmt?.statement_to;
  const th = (col: SortCol, label: string, right?: boolean) => (
    <th className={cn("cursor-pointer px-2.5 py-2 text-[10px] font-semibold whitespace-nowrap uppercase select-none", right && "text-right", sort.col === col ? "text-foreground" : "text-muted-foreground")}
      onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }))}>
      {label} {sort.col === col ? (sort.dir === "asc" ? <ArrowUp className="inline size-3" /> : <ArrowDown className="inline size-3" />) : <ArrowUpDown className="inline size-3 opacity-30" />}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi value={rows.length} label="Statements" />
        <Kpi value={rows.filter((d) => d.status === "pending").length} label="Pending Review" tone="text-warning" />
        <Kpi value={rows.filter((d) => d.status === "pushed").length} label="In Tally" tone="text-success" />
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Transaction Volume</div>
          <div className="flex gap-4">
            <div><div className="text-sm font-bold text-destructive">{money(rows.reduce((s, d) => s + (Number(d.total_debit) || 0), 0))}</div><div className="text-[9px] font-semibold text-muted-foreground uppercase">Total Dr</div></div>
            <div><div className="text-sm font-bold text-success">{money(rows.reduce((s, d) => s + (Number(d.total_credit) || 0), 0))}</div><div className="text-[9px] font-semibold text-muted-foreground uppercase">Total Cr</div></div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {banks.map((b) => (
            <button key={b} onClick={() => pick(b, null)}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-4 pb-2.5 text-xs font-semibold whitespace-nowrap uppercase", b === activeBank ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")}>
              {b}<span className={cn("rounded-full px-1.5 text-[9px]", b === activeBank ? "bg-foreground text-background" : "bg-muted")}>{rows.filter((r) => bankOf(r) === b).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 pb-2">
          <Button size="sm" onClick={() => docs.manual("bank_statement")}><Plus className="size-4" /> Create</Button>
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}><Upload className="size-4" /> Upload</Button>
          <input ref={file} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) docs.upload(f, "bank_statement"); }} />
        </div>
      </div>

      {!activeBank ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No bank statements found.</div>
      ) : (
        <>
          {stmts.length > 1 && (
            <label className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-muted-foreground uppercase">Statement Period</span>
              <select value={activeStmt ?? ""} onChange={(e) => pick(activeBank, Number(e.target.value))} className="h-8 max-w-sm rounded-md border border-input bg-background px-2 text-sm">
                {stmts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.account_no ? s.account_no + " · " : ""}{docDate(s.statement_from)} → {docDate(s.statement_to)}{s.status !== "pushed" ? ` (${s.status})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!stmt ? <div className="py-8 text-center text-sm text-muted-foreground">Loading statement…</div> : (
            <>
              <Card className="flex-row flex-wrap items-center justify-between gap-6 p-4">
                <div className="flex flex-wrap gap-6">
                  <Field label="Account Number"><span className="font-mono">{stmt.account_no || "—"}</span></Field>
                  <Field label="Statement Period">{docDate(periodFrom)} — {docDate(periodTo)}</Field>
                  <Field label="Downloaded On"><span className="text-muted-foreground">{docDate(stmt.invoice_date)}</span></Field>
                </div>
                <div className="flex flex-wrap gap-5 rounded-lg border bg-muted/30 px-4 py-2">
                  <Field label="Opening Bal">{stmt.opening_balance != null ? money(stmt.opening_balance) : "—"}</Field>
                  <Field label="Closing Bal">{stmt.closing_balance != null ? money(stmt.closing_balance) : "—"}</Field>
                  <Field label="Withdrawals"><span className="text-destructive">{stmt.total_debit != null ? money(stmt.total_debit) : "—"}</span></Field>
                  <Field label="Deposits"><span className="text-success">{stmt.total_credit != null ? money(stmt.total_credit) : "—"}</span></Field>
                </div>
              </Card>

              <Card className="gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search description or note…" value={q} onChange={(e) => setQ(e.target.value.trim())} className="pl-8" />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" /></label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" /></label>
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => save(items, "Notes saved")}><Save className="size-4" /> Save Notes</Button>
                  {(q || from || to) && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setFrom(""); setTo(""); }}>Clear</Button>}
                </div>
                {!shown.length ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">{items.length ? "No transactions match your filters." : "No transaction data for this statement."}</div>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <div className="max-h-[520px] overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
                          <tr>
                            {th("date", "Date")}{th("description", "Description")}{th("withdrawal", "Withdrawal (Dr)", true)}{th("deposit", "Deposit (Cr)", true)}
                            <th className="px-2.5 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase">Smart Track / Ref</th>
                            <th className="px-2.5 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase">Internal Note</th>
                            <th className="px-2.5 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase">Attachment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map(({ li, i }, n) => {
                            const a = Number(li.amount) || 0;
                            return (
                              <tr key={i} className={cn("border-b", n % 2 && "bg-muted/30")}>
                                <td className="px-2.5 py-2 whitespace-nowrap">{li.date ? docDate(li.date) : "—"}</td>
                                <td className="max-w-[240px] truncate px-2.5 py-2 font-mono text-[11px] text-muted-foreground" title={li.description || ""}>{li.description || "—"}</td>
                                <td className="px-2.5 py-2 text-right font-bold text-destructive">{a < 0 ? money(-a) : ""}</td>
                                <td className="px-2.5 py-2 text-right font-bold text-success">{a > 0 ? money(a) : ""}</td>
                                <td className="px-2.5 py-2"><Tags tags={smartTags(li.description)} /></td>
                                <td className="px-2.5 py-1">
                                  <input value={li.comment || ""} placeholder="Add note…" aria-label="Internal note"
                                    onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))}
                                    className="w-full min-w-[140px] rounded border border-transparent bg-transparent px-2 py-1 focus:border-border focus:bg-background focus:outline-none" />
                                </td>
                                <td className="px-2.5 py-2 text-center">
                                  {li.attachment_url ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <a href={li.attachment_url} target="_blank" rel="noopener" className="font-semibold hover:underline">View ↗</a>
                                      <button title="Remove" onClick={() => detach(i)}><X className="size-3.5 text-destructive" /></button>
                                    </span>
                                  ) : (
                                    <label title="Attach file" className="inline-flex cursor-pointer p-1 text-muted-foreground hover:text-foreground">
                                      <Paperclip className="size-3.5" />
                                      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attach(i, f); }} />
                                    </label>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t bg-card px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                      {shown.length} of {items.length} transaction{items.length !== 1 ? "s" : ""}{q || from || to ? " — filtered" : ""}
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-semibold">{children}</div>
    </div>
  );
}

const TONE: Record<Tag["tone"], string> = {
  ref: "bg-foreground/10 font-semibold",
  mono: "border font-mono text-muted-foreground",
  warn: "bg-warning/15 font-semibold text-warning",
  danger: "bg-destructive/10 font-semibold text-destructive",
  plain: "border",
  party: "bg-muted font-semibold",
};
export function Tags({ tags }: { tags: Tag[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {tags.map((t, i) => <span key={i} className={cn("rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap", TONE[t.tone])}>{t.text}</span>)}
    </div>
  );
}
