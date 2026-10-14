"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { INR, daysTo, finDate } from "@/lib/finance";
import { Empty, FinCard, Stat } from "./bits";

export interface Summary { total: number; overdue: number; dueMonth: number; openBills: number; masterSyncEpoch: number | null; voucherSyncDate: string | null }
interface Bill { company_id: number | null; party_name: string; bill_ref: string; bill_date: string; pending_amt: number; due_date: string | null; overdue_days: number }
interface Debtor { name: string; tally_balance: number; tracked_outstanding: number; gap: number; coverage_pct: number }

function StatusPill({ b }: { b: Bill }) {
  if (b.overdue_days > 0) return <Badge variant="destructive">{b.overdue_days}d overdue</Badge>;
  const days = b.due_date ? daysTo(b.due_date) : 99;
  if (days <= 7) return <Badge className="bg-warning text-white">Due in {days}d</Badge>;
  return <Badge className="bg-success text-white">Current</Badge>;
}

export function Receivables({ summary }: { summary: Summary | null }) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [debtors, setDebtors] = useState<Debtor[] | null>(null);

  useEffect(() => {
    api<Bill[]>("/api/finance/outstanding").then(setBills).catch(() => setBills([]));
    api<Debtor[]>("/api/finance/debtors").then(setDebtors).catch(() => setDebtors([]));
  }, []);

  const b = bills ?? [];
  const total = b.reduce((s, x) => s + (x.pending_amt || 0), 0);
  const overdue = b.filter((x) => x.overdue_days > 0).reduce((s, x) => s + (x.pending_amt || 0), 0);
  const buckets = [
    { lbl: "Overdue", sub: "collect now", rows: b.filter((x) => x.overdue_days > 0) },
    { lbl: "Due ≤ 7 days", sub: "this week", rows: b.filter((x) => { const d = daysTo(x.due_date); return d > 0 && d <= 7; }) },
    { lbl: "Due 8–30 days", sub: "this month", rows: b.filter((x) => { const d = daysTo(x.due_date); return d > 7 && d <= 30; }) },
    { lbl: "Due 31–60 days", sub: "next month", rows: b.filter((x) => { const d = daysTo(x.due_date); return d > 30 && d <= 60; }) },
  ];
  const d = debtors ?? [];
  const totalT = d.reduce((s, x) => s + x.tally_balance, 0);
  const totalK = d.reduce((s, x) => s + x.tracked_outstanding, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total Receivables" value={summary ? INR(summary.total) : "—"} />
        <Stat label="Overdue" value={summary ? INR(summary.overdue) : "—"} className="text-destructive" />
        <Stat label="Due Next 30 Days" value={summary ? INR(summary.dueMonth) : "—"} />
        <Stat label="Open Bills" value={summary ? summary.openBills : "—"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FinCard title="Aging Breakdown" tip="Splits outstanding into overdue vs current. Any overdue balance needs a collection call today — every extra day increases default risk.">
          {bills === null ? <Empty>Loading…</Empty> : !total ? <Empty>No outstanding bills</Empty> : (
            [
              { lbl: "Overdue", amt: overdue, cls: "bg-destructive" },
              { lbl: "Current (within terms)", amt: total - overdue, cls: "bg-success" },
            ].map((r) => (
              <div key={r.lbl} className="mb-3.5">
                <div className="flex justify-between text-xs text-muted-foreground"><span>{r.lbl}</span><strong className="text-foreground">{INR(r.amt)}</strong></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted"><div className={`h-full rounded ${r.cls}`} style={{ width: `${((r.amt / total) * 100).toFixed(1)}%` }} /></div>
              </div>
            ))
          )}
        </FinCard>
        <FinCard title="Collections Forecast" tip="Maps when cash should arrive. Use before approving supplier payments or assessing if you can offer a customer extended credit terms.">
          {buckets.map((k) => {
            const amt = k.rows.reduce((s, x) => s + (x.pending_amt || 0), 0);
            return (
              <div key={k.lbl} className="flex items-center justify-between border-b py-2.5 text-xs last:border-b-0">
                <div>
                  <div className="text-muted-foreground">{k.lbl}</div>
                  <div className="text-[11px] text-muted-foreground">{k.rows.length} bill{k.rows.length !== 1 ? "s" : ""} · {k.sub}</div>
                </div>
                <div className={`text-sm font-bold ${!k.rows.length ? "text-muted-foreground" : k.lbl === "Overdue" ? "text-destructive" : ""}`}>{k.rows.length ? INR(amt) : "—"}</div>
              </div>
            );
          })}
        </FinCard>
      </div>

      <FinCard tip="Every open bill, who owes it, and how overdue. Act on red rows first — click a party linked to the CRM to open their clients list.">
        <DataTable
          title="Outstanding Bills"
          data={b}
          pageSize={10}
          getRowKey={(r, i) => `${r.party_name}-${r.bill_ref}-${i}`}
          columns={[
            { label: "Party", render: (r) => (r.company_id ? <PartyLink name={r.party_name} /> : <strong>{r.party_name}</strong>) },
            { label: "Bill Ref", render: (r) => <span className="text-xs font-semibold">{r.bill_ref}</span> },
            { label: "Invoice", render: (r) => finDate(r.bill_date), className: "hidden md:table-cell" },
            { label: "Pending", render: (r) => <strong>{INR(r.pending_amt)}</strong> },
            { label: "Due Date", render: (r) => (r.due_date ? <span className={r.overdue_days > 0 ? "text-destructive" : ""}>{finDate(r.due_date)}</span> : "—"), className: "hidden sm:table-cell" },
            { label: "Status", render: (r) => <StatusPill b={r} /> },
          ]}
        />
      </FinCard>

      <FinCard title="⚠ Debtor Reconciliation" tip="Compares Tally ledger balances vs bill-tracked outstanding. A large gap means pre-system or untracked debt — needs manual follow-up or accountant review." className="border-l-4 border-l-warning">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {debtors === null ? "Loading…" : (
            <>
              Tally ledgers show <strong>{INR(totalT)}</strong> in Sundry Debtor balances. Only <strong>{INR(totalK)}</strong> (
              {totalT > 0 ? ((totalK / totalT) * 100).toFixed(1) : 100}%) is bill-referenced and tracked here. Remaining <strong>{INR(totalT - totalK)}</strong> are likely opening balances or pre-system entries — no bill reference exists in Tally.
            </>
          )}
        </p>
        <DataTable
          title="All Sundry Debtors"
          data={d}
          pageSize={10}
          getRowKey={(r) => r.name}
          columns={[
            { label: "Party", render: (r) => r.name },
            { label: "Tally Balance", render: (r) => INR(r.tally_balance) },
            { label: "Tracked", render: (r) => (r.tracked_outstanding > 0 ? <span className="text-success">{INR(r.tracked_outstanding)}</span> : <span className="text-muted-foreground">—</span>), className: "hidden sm:table-cell" },
            { label: "Gap", render: (r) => (r.gap > 0 ? <span className={r.gap > 50000 ? "text-warning" : "text-muted-foreground"}>{INR(r.gap)}</span> : "—") },
            {
              label: "Coverage",
              className: "hidden md:table-cell",
              render: (r) => {
                const pct = Math.min(r.coverage_pct, 100);
                const col = pct >= 80 ? "bg-success" : pct >= 20 ? "bg-warning" : "bg-destructive";
                return (
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-16 rounded bg-muted"><div className={`h-full rounded ${col}`} style={{ width: `${pct}%` }} /></div>
                    <span className="text-xs text-muted-foreground">{r.coverage_pct}%</span>
                  </div>
                );
              },
            },
          ]}
        />
      </FinCard>
    </div>
  );
}

// ls_crm linked matched parties to its clients list; here that list's search box does the same job.
function PartyLink({ name }: { name: string }) {
  return (
    <Link href={`/clients?q=${encodeURIComponent(name)}`} className="font-semibold hover:underline">
      {name}
    </Link>
  );
}
