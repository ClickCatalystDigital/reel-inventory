"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { INR, finDate, periodQuery, type Period } from "@/lib/finance";
import { Empty, FinCard, Hint, PeriodBar, Row, Stat } from "./bits";

interface Bal { name: string; parent: string; balance: number; is_overdraft?: boolean }
interface CashBank { accounts: Bal[]; advances: Bal[]; tax: Bal[] }
interface Pnl { sales: Bal[]; purchase: Bal[]; opex: Bal[]; totalSales: number; totalPurchase: number; totalOpEx: number; grossProfit: number }
interface Txns { rows: { voucher_no: string; voucher_type: string; date: string; party_name: string | null; amount: number; narration: string | null }[]; totalIn: number; totalOut: number; netFlow: number }

// Cash & bank, advances/tax, this FY's P&L, and bank transaction history.
export function Position() {
  const [cb, setCb] = useState<CashBank | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [type, setType] = useState("all");
  const [txns, setTxns] = useState<Txns | null>(null);

  useEffect(() => {
    api<CashBank>("/api/finance/cash-bank").then(setCb).catch(() => {});
    api<Pnl>("/api/finance/pnl-snapshot").then(setPnl).catch(() => {});
  }, []);
  useEffect(() => {
    const qs = [periodQuery(period), type !== "all" ? `type=${type}` : ""].filter(Boolean).join("&");
    api<Txns>(`/api/finance/transactions${qs ? "?" + qs : ""}`).then(setTxns).catch(() => {});
  }, [period, type]);

  const accounts = cb?.accounts ?? [];
  const cash = accounts.filter((a) => !a.is_overdraft).reduce((s, a) => s + a.balance, 0);
  const od = accounts.filter((a) => a.is_overdraft).reduce((s, a) => s + a.balance, 0);
  const advTotal = (cb?.advances ?? []).reduce((s, r) => s + r.balance, 0);
  const taxTotal = (cb?.tax ?? []).reduce((s, r) => s + r.balance, 0);
  const others = [
    ...(cb?.advances ?? []).map((r) => ({ ...r, sub: "Customer advance received", warn: false })),
    ...(cb?.tax ?? []).map((r) => ({ ...r, sub: "Tax liability payable", warn: true })),
  ];
  const gp = pnl?.grossProfit ?? 0;

  return (
    <div className="space-y-4">
      <FinCard title="This FY — Revenue & Cost" tip="P&L account balances for this financial year. In Indian accounting these reset each April — so this reflects current FY only. Answers: Are we making gross profit? Where is most money going?">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Revenue" value={pnl ? INR(pnl.totalSales) : "—"} />
          <Stat label="Cost of Goods" value={pnl ? INR(pnl.totalPurchase) : "—"} />
          <Stat label={gp >= 0 ? "Gross Profit" : "Gross Loss"} value={pnl ? INR(Math.abs(gp)) : "—"} className={gp >= 0 ? "text-success" : "text-destructive"} />
          <Stat label="Operating Exp." value={pnl ? INR(pnl.totalOpEx) : "—"} />
        </div>
        {pnl && (pnl.sales.length > 0 || pnl.purchase.length > 0 || pnl.opex.length > 0) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FinCard title="Revenue Accounts" tip="Sales and income ledger balances for this FY.">
              <Ledgers rows={pnl.sales} />
            </FinCard>
            <FinCard title="Cost Accounts" tip="Purchases and operating expenses for this FY.">
              <Ledgers rows={[...pnl.purchase, ...pnl.opex]} />
            </FinCard>
          </div>
        )}
      </FinCard>

      <div className="grid gap-4 md:grid-cols-2">
        <FinCard>
          <div className="mb-4 flex items-start justify-between border-b pb-3.5">
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Available Cash &amp; Bank</div>
              <div className="text-2xl font-bold">{cb ? INR(cash - od) : "—"}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{cb ? `${accounts.length} account${accounts.length !== 1 ? "s" : ""} · from Tally` : "loading accounts…"}</div>
            </div>
            <Hint tip="Live bank and cash balance from Tally. Check before approving a supplier payment or extending credit to a customer. Refreshes with each daily master sync." />
          </div>
          {!cb ? <Empty>Loading…</Empty> : accounts.length ? accounts.map((a) => (
            <Row key={a.name} name={a.name} sub={a.parent} amount={`${a.is_overdraft ? "▼ OD " : ""}${INR(a.balance)}`} amountClass={a.is_overdraft ? "text-destructive" : ""} />
          )) : <Empty>No bank or cash accounts found in Tally ledgers.<br /><span className="text-xs">Expected groups: Bank Accounts, Cash-in-Hand</span></Empty>}
        </FinCard>
        <FinCard title="Other Positions" tip="Customer advances received (cash you hold but haven't earned yet) and tax liabilities (GST/IGST payable to government). Advances reduce your net receivables; tax liability reduces available cash.">
          {!cb ? <Empty>Loading…</Empty> : others.length ? (
            <>
              <div className="mb-2.5 text-xs text-muted-foreground">Advances in: <strong>{INR(advTotal)}</strong> · Tax payable: <strong className="text-warning">{INR(taxTotal)}</strong></div>
              {others.map((r) => <Row key={r.parent + r.name} name={r.name} sub={r.sub} amount={INR(r.balance)} amountClass={r.warn ? "text-warning" : ""} />)}
            </>
          ) : <Empty>No advance or tax positions found.</Empty>}
        </FinCard>
      </div>

      <FinCard title="Transaction History" tip="Bank receipts and payments from Tally. Use to verify whether a specific customer has paid, or to review all outgoing payments this month. Net flow = receipts minus payments.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PeriodBar value={period} onChange={setPeriod} />
          <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" aria-label="Transaction type">
            <option value="all">All types</option>
            <option value="Receipt">Receipts only</option>
            <option value="Payment">Payments only</option>
          </select>
        </div>
        {!txns || !txns.rows.length ? <Empty>No transactions found for this period.</Empty> : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 border-b pb-3 text-xs">
              <span>In: <strong className="text-success">{INR(txns.totalIn)}</strong></span>
              <span>Out: <strong className="text-destructive">{INR(txns.totalOut)}</strong></span>
              <span>Net: <strong className={txns.netFlow >= 0 ? "text-success" : "text-destructive"}>{INR(Math.abs(txns.netFlow))}</strong></span>
            </div>
            {txns.rows.map((r) => {
              const inflow = r.voucher_type === "Receipt";
              return (
                <Row
                  key={r.voucher_type + r.voucher_no}
                  name={r.party_name || r.narration || r.voucher_no}
                  sub={<>{finDate(r.date)} · <span className={inflow ? "text-success" : "text-destructive"}>{r.voucher_type}</span></>}
                  amount={`${inflow ? "+" : "−"}${INR(Math.abs(r.amount || 0))}`}
                  amountClass={inflow ? "text-success" : "text-destructive"}
                />
              );
            })}
          </>
        )}
      </FinCard>
    </div>
  );
}

function Ledgers({ rows }: { rows: Bal[] }) {
  if (!rows.length) return <Empty>No entries</Empty>;
  return rows.map((r) => (
    <div key={r.parent + r.name} className="flex justify-between border-b py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground">{r.name}</span>
      <strong>{INR(r.balance)}</strong>
    </div>
  ));
}
