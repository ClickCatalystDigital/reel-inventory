"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { INR, finDate, periodQuery, resolveAmt, type Period } from "@/lib/finance";
import { Empty, FinCard, PeriodBar } from "./bits";

interface Voucher { voucher_no: string; date: string; party_name: string | null; amount: number; narration: string | null; bill_refs: string | null }
interface VoucherDetail {
  voucher_no: string; date: string; party_name: string | null; amount: number; narration: string | null; payment_reminder_date: string | null;
  inventory_lines: { item: string; billed_qty?: string; actual_qty?: string; rate?: string; amount: number }[];
  ledger_lines: { ledger: string; dr_cr: string; amount: number }[];
  bill_refs: { name: string; date?: string; amount: number; credit_days?: number }[];
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-5 mb-2 border-b pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
);

export function Sales() {
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [rows, setRows] = useState<Voucher[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (period === "custom" && !(custom.from && custom.to)) return;
    const qs = periodQuery(period, custom);
    api<Voucher[]>(`/api/finance/sales${qs ? "?" + qs : ""}`).then(setRows).catch(() => {});
  }, [period, custom]);

  return (
    <div className="space-y-3">
      <PeriodBar value={period} onChange={setPeriod} withCustom />
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" className="w-auto flex-1 sm:flex-none" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="w-auto flex-1 sm:flex-none" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      )}
      <FinCard tip="Tally-recorded sales for the selected period. Use period filter to see monthly revenue, identify top customers, and spot months with unusually low sales.">
        <DataTable
          title="Sales Vouchers"
          data={rows}
          pageSize={15}
          getRowKey={(v) => v.voucher_no}
          columns={[
            { label: "Voucher No", render: (v) => <button className="font-semibold hover:underline" onClick={() => setOpen(v.voucher_no)}>{v.voucher_no}</button> },
            { label: "Date", render: (v) => finDate(v.date) },
            { label: "Party", render: (v) => v.party_name || <span className="italic text-muted-foreground">Internal</span> },
            { label: "Amount", render: (v) => { const a = resolveAmt(v); return a > 0 ? <strong>{INR(a)}</strong> : <span className="text-muted-foreground">—</span>; } },
            { label: "Narration", render: (v) => <span className="text-xs text-muted-foreground">{v.narration || "—"}</span>, className: "hidden md:table-cell" },
          ]}
        />
      </FinCard>
      <VoucherSheet vno={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function VoucherSheet({ vno, onClose }: { vno: string | null; onClose: () => void }) {
  const [v, setV] = useState<VoucherDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [reminder, setReminder] = useState("");

  useEffect(() => {
    if (!vno) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setV(null);
    setFailed(false);
    api<VoucherDetail>(`/api/finance/sales/${encodeURIComponent(vno)}`)
      .then((d) => { setV(d); setReminder(d.payment_reminder_date || ""); })
      .catch(() => setFailed(true));
  }, [vno]);

  async function saveReminder() {
    if (!v) return;
    try {
      await api(`/api/finance/sales/${encodeURIComponent(v.voucher_no)}/reminder`, { method: "PUT", body: { reminder_date: reminder } });
      showToast("Reminder schedule updated", "success");
    } catch {
      // api() already toasted
    }
  }

  const amt = v ? resolveAmt({ amount: v.amount, bill_refs: v.bill_refs }) : 0;
  return (
    <Sheet open={vno != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>{vno}</SheetTitle>
          <SheetDescription>{v ? finDate(v.date) + (v.party_name ? " · " + v.party_name : "") : "—"}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {failed ? <div className="text-destructive">Failed to load voucher detail.</div> : !v ? <div className="text-muted-foreground">Loading…</div> : (
            <>
              {amt > 0 && <div className="mb-4"><span className="text-2xl font-bold">{INR(amt)}</span><span className="ml-2 text-xs text-muted-foreground">invoice total</span></div>}
              <div className="mb-5 rounded-md border bg-muted/40 p-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Payment Reminder Date</div>
                <div className="flex gap-2">
                  <Input type="date" value={reminder} onChange={(e) => setReminder(e.target.value)} />
                  <Button size="sm" onClick={saveReminder}>Save</Button>
                </div>
              </div>
              {v.narration && <div className="mb-4 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">{v.narration}</div>}
              {v.inventory_lines.length > 0 && (
                <>
                  <SectionLabel>Items Sold</SectionLabel>
                  <DetailTable head={["Item", "Qty", "Rate", "Amount"]} rows={v.inventory_lines.map((l) => [l.item, l.billed_qty || l.actual_qty || "—", l.rate || "—", <strong key="a">{INR(l.amount)}</strong>])} />
                </>
              )}
              {v.ledger_lines.length > 0 && (
                <>
                  <SectionLabel>{v.inventory_lines.length > 0 ? "Accounting Entries" : "Ledger Breakdown"}</SectionLabel>
                  <DetailTable rows={v.ledger_lines.map((l) => [l.ledger, <span key="d" className={l.dr_cr === "Yes" ? "font-bold" : "font-bold text-success"}>{l.dr_cr === "Yes" ? "Dr" : "Cr"}</span>, INR(Math.abs(l.amount))])} />
                </>
              )}
              {v.bill_refs.length > 0 && (
                <>
                  <SectionLabel>Bill References</SectionLabel>
                  <DetailTable head={["Bill Name", "Date", "Amount", "Credit Days"]} rows={v.bill_refs.map((r) => [<strong key="n">{r.name}</strong>, r.date ? finDate(r.date) : "—", INR(Math.abs(r.amount)), r.credit_days ? r.credit_days + "d" : "—"])} />
                </>
              )}
              {!amt && !v.narration && !v.inventory_lines.length && !v.ledger_lines.length && !v.bill_refs.length && <Empty>No detail available for this voucher.</Empty>}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailTable({ head, rows }: { head?: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full text-xs">
      {head && (
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={`border-b-2 px-2 py-1.5 text-[10px] uppercase text-muted-foreground ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
      )}
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={`border-b px-2 py-2 ${j ? "text-right" : ""}`}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
