"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { INR, finDate, periodQuery, type Period } from "@/lib/finance";
import { FinCard, PeriodBar, Row } from "./bits";

interface Supplier { name: string; parent: string; balance: number; is_dr: boolean }
interface Purchase { voucher_no: string; date: string; party_name: string | null; amount: number; narration: string | null }

export function Payables() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("month");
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    api<Supplier[]>("/api/finance/payables").then(setSuppliers).catch(() => setSuppliers([]));
  }, []);
  useEffect(() => {
    const qs = periodQuery(period);
    api<Purchase[]>(`/api/finance/purchase-register${qs ? "?" + qs : ""}`).then(setPurchases).catch(() => {});
  }, [period]);

  const s = suppliers ?? [];
  const shown = useMemo(() => {
    const all = suppliers ?? [];
    return q ? all.filter((r) => (r.name || "").toLowerCase().includes(q.toLowerCase().trim())) : all;
  }, [suppliers, q]);
  const domestic = s.filter((r) => r.parent === "Sundry Creditors");
  const imports = s.filter((r) => r.parent !== "Sundry Creditors");
  const sum = (rows: Supplier[]) => rows.reduce((t, r) => t + r.balance, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FinCard title="By Origin" tip="Import payables = foreign suppliers (FX exposure, LC terms). Domestic = local suppliers. High import share means payments depend on exchange rate. Use to prioritise which payables need attention first.">
          <Row name="Domestic" sub={`${domestic.length} suppliers`} amount={INR(sum(domestic))} />
          <Row name="Import" sub={<span className="text-warning">{imports.length} suppliers · FX exposure</span>} amount={INR(sum(imports))} amountClass="text-warning" />
        </FinCard>
        <FinCard title="Find Supplier" tip="Filter suppliers by name to quickly check a specific balance before making a payment decision.">
          <Input type="search" placeholder="Search suppliers…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total Payables</div>
            <div className="text-2xl font-bold">{suppliers ? INR(sum(s)) : "—"}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{s.length} supplier{s.length !== 1 ? "s" : ""} · closing balance only</div>
          </div>
        </FinCard>
      </div>

      <FinCard tip="What you owe each supplier per Tally ledger balance. No aging available until purchase vouchers are synced. Use to plan payment priority — largest balances first unless you have specific terms.">
        <DataTable
          title="Supplier Payables"
          data={shown}
          pageSize={15}
          getRowKey={(r) => r.parent + r.name}
          columns={[
            { label: "Supplier", render: (r) => <strong>{r.name}</strong> },
            { label: "Group", render: (r) => <span className="text-xs text-muted-foreground">{r.parent}</span>, className: "hidden sm:table-cell" },
            { label: "Balance Owed", render: (r) => <strong className={r.balance > 100000 ? "text-warning" : ""}>{INR(r.balance)}</strong> },
          ]}
        />
        <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">Balances from Tally ledger closing totals. Bill-level aging will appear once payables settlement tracking is confirmed.</div>
      </FinCard>

      <FinCard title="Purchase Register" tip="All purchase vouchers from Tally for the selected period. Answers: What did we buy? From whom? At what cost? Use to reconcile with payables balances — new purchases this period vs existing debt.">
        <div className="mb-3"><PeriodBar value={period} onChange={setPeriod} /></div>
        <DataTable
          title="Purchases"
          data={purchases}
          pageSize={15}
          getRowKey={(r, i) => `${r.voucher_no}-${i}`}
          columns={[
            { label: "Voucher No", render: (r) => <span className="font-semibold">{r.voucher_no}</span> },
            { label: "Date", render: (r) => finDate(r.date) },
            { label: "Supplier", render: (r) => <strong>{r.party_name || "—"}</strong> },
            { label: "Amount", render: (r) => (r.amount ? <strong>{INR(r.amount)}</strong> : "—") },
            { label: "Narration", render: (r) => <span className="text-xs text-muted-foreground">{(r.narration || "").slice(0, 50)}</span>, className: "hidden md:table-cell" },
          ]}
        />
      </FinCard>
    </div>
  );
}
