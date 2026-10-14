"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { lines as parseLines, money, type Invoice, type LineItem } from "@/lib/docs";
import { Notice, SectionLabel, StatusPill } from "./bits";
import { useDocs } from "./context";

interface StockItem { name: string; parent: string | null; base_units: string | null }
interface Checks { duplicates: { id: number; invoice_no: string | null; status: string }[]; unknownLedgers: string[] }
type F = { k: string; label: string; req?: boolean; full?: boolean; type?: string };

const CORE: F[] = [
  { k: "invoice_no", label: "Document No", req: true }, { k: "invoice_date", label: "Date", req: true },
  { k: "party_name", label: "Party (supplier)", req: true, full: true }, { k: "party_gstin", label: "Party GSTIN" },
  { k: "buyer_gstin", label: "Buyer GSTIN" }, { k: "place_of_supply", label: "Place of Supply", req: true },
  { k: "taxable_value", label: "Taxable Value", req: true }, { k: "cgst", label: "CGST" }, { k: "sgst", label: "SGST" },
  { k: "igst", label: "IGST" }, { k: "net_amount", label: "Net Amount", req: true },
];
const FREIGHT: F[] = [{ k: "mawb_no", label: "MAWB No" }, { k: "flight_no", label: "Flight No" }, { k: "commodity", label: "Commodity" }, { k: "supplier_ref", label: "Supplier Ref" }];
const BANK: F[] = [
  { k: "account_no", label: "Account No", full: true }, { k: "statement_from", label: "Period From" }, { k: "statement_to", label: "Period To" },
  { k: "invoice_date", label: "Download Date", full: true }, { k: "opening_balance", label: "Opening Balance", type: "number" },
  { k: "closing_balance", label: "Closing Balance", type: "number" }, { k: "total_debit", label: "Total Withdrawals", type: "number" },
  { k: "total_credit", label: "Total Deposits", type: "number" },
];
const BANK_LEDGERS = ["South Indian Bank", "DB BANK", "ICICI Bank", "Cash"];
const PURCHASE_LEDGERS = ["GST LOCAL PURCHASE 18%", "GST INTRA STATE PURCHASE 18%", "GST Import Purchase 18%"];
const sel = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60";

// The fields shown (and sent back on save) depend on the document type, exactly as in ls_crm.
function fieldsFor(t: string | null): F[] {
  const out: F[] = [{ k: "doc_type", label: "Document Type", full: true }];
  if (t === "bank_statement") out.push({ k: "bank_ledger", label: "" }, ...BANK);
  else {
    if (t === "purchase_invoice" || t === "freight_invoice") out.push({ k: "purchase_ledger", label: "" });
    out.push(...CORE);
    if (t === "purchase_order") out.push({ k: "delivery_date", label: "Earliest Delivery Date", full: true });
  }
  if (t === "freight_invoice" || t === "bill_of_entry") out.push(...FREIGHT);
  return out;
}
const pdfUrl = (u: string) => u.trim().replace(/^https:\/\/https:\/\//, "https://");

export function ReviewSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const docs = useDocs();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [items, setItems] = useState<LineItem[]>([]);
  const [custom, setCustom] = useState<{ key: string; value: string }[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [checks, setChecks] = useState<Checks | null>(null);
  const [stock, setStock] = useState<StockItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInv(null); setErr(null); setChecks(null); setCustom([]);
    (async () => {
      try {
        const d = await api<Invoice>(`/api/invoices/${id}`);
        setInv(d);
        // ls_crm stamped each shown line's kind while rendering, so saves carry it (the Tally XML builder needs it).
        const stamp = d.doc_type !== "bank_statement" && d.doc_type !== "freight_invoice";
        setItems(parseLines(d).map((li) => (stamp ? { ...li, kind: li.kind || (d.doc_type === "purchase_invoice" ? "stock" : "expense") } : { ...li })));
        const init: Record<string, string> = {};
        for (const x of fieldsFor(d.doc_type)) init[x.k] = String((d as unknown as Record<string, unknown>)[x.k] ?? "");
        if (d.doc_type === "bank_statement" && !init.bank_ledger) init.bank_ledger = "South Indian Bank";
        setF(init);
        if (d.status === "pending") fetch(`/api/invoices/${id}/checks`).then((r) => r.json()).then(setChecks).catch(() => {});
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [id]);
  useEffect(() => {
    if (id == null || stock) return;
    api<StockItem[]>("/api/invoices/tally-stock-items").then(setStock).catch(() => setStock([]));
  }, [id, stock]);

  const t = inv?.doc_type ?? null;
  const locked = inv?.status !== "pending";
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setLine = (i: number, patch: Partial<LineItem>) => setItems((s) => s.map((li, j) => (j === i ? { ...li, ...patch } : li)));

  function body() {
    const b: Record<string, unknown> = { line_items: items };
    for (const x of fieldsFor(t)) b[x.k] = (f[x.k] ?? "").trim();
    if (custom.length) b.review_notes = "Custom: " + JSON.stringify(custom);
    return b;
  }
  async function save(silent: boolean) {
    if (!inv) return;
    await api(`/api/invoices/${inv.id}`, { method: "PUT", body: body() });
    if (!silent) { showToast("Saved", "success"); docs.changed(); }
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch { /* api() already toasted */ } finally { setBusy(false); }
  }
  const approve = () => run(async () => {
    if (!inv) return;
    // A stock line without a Tally item would push a blank item; force a pick first.
    if (t === "purchase_invoice") {
      const blanks = items.filter((li) => li.kind === "stock" && !(li.stock_item_name || "").trim()).length;
      if (blanks) return showToast(`${blanks} stock line(s) have no Tally item selected — pick one for each before approving.`, "error");
    }
    await save(true); // persist edits + rebuild XML first
    await api(`/api/invoices/${inv.id}/approve`, { method: "POST", body: {} });
    showToast("Approved — local agent will push to Tally", "success");
    onClose(); docs.changed();
  });
  const reject = () => run(async () => {
    if (!inv) return;
    await api(`/api/invoices/${inv.id}/reject`, { method: "POST", body: {} });
    showToast("Rejected", "success"); onClose(); docs.changed();
  });
  const remove = () => run(async () => {
    if (!inv) return;
    const msg = inv.status === "pushed" ? "This was pushed to Tally. Deleting here only archives the CRM record — it will NOT remove the voucher from Tally. Continue?" : "Delete this record permanently?";
    if (!confirm(msg)) return;
    const r = await api<{ soft: boolean }>(`/api/invoices/${inv.id}`, { method: "DELETE" });
    showToast(r.soft ? "Archived (was in Tally)" : "Deleted", "success"); onClose(); docs.changed();
  });

  const field = (x: F) => (
    <div key={x.k} className={cn("space-y-1", x.full && "col-span-2")}>
      <Label className="text-xs text-muted-foreground">{x.label}{x.req && <span className="text-destructive"> *</span>}</Label>
      <Input type={x.type} step={x.type === "number" ? "0.01" : undefined} value={f[x.k] ?? ""} disabled={locked} onChange={(e) => set(x.k, e.target.value)} />
    </div>
  );
  const fl = fieldsFor(t);
  const hasPdf = !!inv?.file_url;

  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={cn("gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg", hasPdf && "data-[side=right]:md:max-w-[min(1200px,96vw)]")}>
        <div className="flex h-full min-h-0">
          {hasPdf && <iframe title="Document" src={pdfUrl(inv!.file_url!)} className="hidden h-full min-w-0 flex-1 border-r bg-muted md:block" />}
          <div className={cn("flex h-full min-h-0 w-full flex-col", hasPdf && "md:w-[480px] md:shrink-0", t === "bank_statement" && hasPdf && "md:w-[640px]")}>
            <SheetHeader className="border-b p-4 pr-12">
              <SheetTitle>{inv ? inv.invoice_no || inv.original_filename || "Untitled" : "Document"}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex items-center gap-2">
                  {inv && <StatusPill status={inv.status} />}
                  {hasPdf && <a href={pdfUrl(inv!.file_url!)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] font-semibold md:hidden"><ExternalLink className="size-3" /> View PDF</a>}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-4 text-sm">
              {err ? <div className="text-destructive">Failed to load. <span className="text-xs text-muted-foreground">{err}</span></div>
                : !inv ? <div className="text-muted-foreground">Loading…</div>
                : inv.status === "reading" ? <div className="text-muted-foreground">Still reading this document — check back in a moment.</div>
                : inv.status === "extract_failed" ? (
                  <>
                    <div className="text-destructive">Extraction failed{inv.extract_error ? ` — ${inv.extract_error}` : ""}.</div>
                    <div className="mt-2 text-xs text-muted-foreground">Re-upload the PDF to try again, or delete this record.</div>
                  </>
                ) : (
                  <>
                    {inv.status === "pushed" && <Notice tone="info" title="Pushed to Tally">{inv.pushed_at ? formatDateTime(inv.pushed_at) : ""}</Notice>}
                    {inv.status === "push_failed" && <Notice tone="danger" title={`Tally push failed${inv.push_error ? " — " + inv.push_error : ""}`}>The local agent will retry, or delete this record.</Notice>}
                    {checks?.duplicates.length ? (
                      <Notice tone="warn" title="Possible duplicate">
                        Same supplier &amp; invoice no already exists:{" "}
                        {checks.duplicates.map((d, i) => (
                          <span key={d.id}>{i > 0 && ", "}<button className="underline" onClick={() => docs.openReview(d.id)}>{d.invoice_no || "#" + d.id}</button> ({d.status})</span>
                        ))}
                      </Notice>
                    ) : null}
                    {checks?.unknownLedgers.length ? <Notice tone="danger" title="Ledger not in Tally">These won&apos;t import until created in Tally: {checks.unknownLedgers.join(", ")}</Notice> : null}

                    <div className="grid grid-cols-2 gap-3">{field(fl[0])}</div>

                    {(t === "bank_statement" || t === "purchase_invoice" || t === "freight_invoice") && (
                      <>
                        <SectionLabel>Tally routing</SectionLabel>
                        {t === "bank_statement" ? (
                          <label className="block space-y-1"><span className="text-xs text-muted-foreground">Bank Account</span>
                            <select className={sel} value={f.bank_ledger} disabled={locked} onChange={(e) => set("bank_ledger", e.target.value)}>
                              {BANK_LEDGERS.map((b) => <option key={b}>{b}</option>)}
                            </select>
                          </label>
                        ) : (
                          <label className="block space-y-1"><span className="text-xs text-muted-foreground">Purchase Ledger</span>
                            <select className={sel} value={f.purchase_ledger} disabled={locked} onChange={(e) => set("purchase_ledger", e.target.value)}>
                              <option value="">Auto (CGST+SGST → Local, IGST → Intra)</option>
                              {PURCHASE_LEDGERS.map((b) => <option key={b}>{b}</option>)}
                            </select>
                          </label>
                        )}
                      </>
                    )}

                    <SectionLabel>{t === "bank_statement" ? "Account & period" : "Core fields"}</SectionLabel>
                    <div className="grid grid-cols-2 gap-3">{fl.filter((x) => ![ "doc_type", "bank_ledger", "purchase_ledger"].includes(x.k) && !FREIGHT.includes(x)).map(field)}</div>

                    {(t === "freight_invoice" || t === "bill_of_entry") && (
                      <>
                        <SectionLabel>Freight / shipment details</SectionLabel>
                        <div className="grid grid-cols-2 gap-3">{FREIGHT.map(field)}</div>
                      </>
                    )}

                    {t !== "freight_invoice" && (
                      <>
                        <SectionLabel>Line items</SectionLabel>
                        {t === "bank_statement"
                          ? <BankLines items={items} setLine={setLine} setItems={setItems} locked={locked} target={{ dr: Number(f.total_debit || inv.total_debit || 0), cr: Number(f.total_credit || inv.total_credit || 0) }} />
                          : <StdLines items={items} setLine={setLine} setItems={setItems} locked={locked} stockMode={t === "purchase_invoice"} stock={stock ?? []} />}
                        {!locked && (
                          <Button variant="outline" size="sm" className="mt-2 w-full border-dashed" onClick={() => setItems((s) => [...s, { kind: t === "purchase_invoice" ? "stock" : "expense", description: "", hsn: "", qty: "", uom: "", rate: "", amount: "", stock_item_name: "" }])}>
                            + Add line item
                          </Button>
                        )}
                      </>
                    )}

                    <SectionLabel>Custom fields</SectionLabel>
                    {custom.map((c, i) => (
                      <div key={i} className="mb-2 space-y-1">
                        <Label className="text-xs text-muted-foreground">{c.key}{!locked && <button className="ml-2 text-destructive" onClick={() => setCustom((s) => s.filter((_, j) => j !== i))}>remove</button>}</Label>
                        <Input value={c.value} disabled={locked} onChange={(e) => setCustom((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                      </div>
                    ))}
                    {!locked && (
                      <div className="flex gap-2">
                        <Input placeholder="Field name" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                        <Input placeholder="Value" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
                        <Button variant="outline" onClick={() => { if (!newKey.trim()) return showToast("Enter a field name", "error"); setCustom((s) => [...s, { key: newKey.trim(), value: newVal.trim() }]); setNewKey(""); setNewVal(""); }}>Add</Button>
                      </div>
                    )}
                  </>
                )}
            </div>

            {inv && (
              <div className="flex gap-2 border-t p-3">
                {inv.status === "pending" ? (
                  <>
                    {docs.canReview && <Button variant="ghost" size="icon" title="Delete" disabled={busy} onClick={remove}><Trash2 className="size-4 text-destructive" /></Button>}
                    {docs.canReview && <Button variant="outline" className="flex-1 text-destructive" disabled={busy} onClick={reject}>Reject</Button>}
                    <Button variant="outline" className="flex-1" disabled={busy} onClick={() => run(() => save(false))}>Save</Button>
                    {docs.canReview && <Button className="flex-1" disabled={busy} onClick={approve}>Approve → Tally</Button>}
                  </>
                ) : (
                  <>
                    {docs.canReview && inv.status !== "reading" && <Button variant="outline" className="flex-1 text-destructive" disabled={busy} onClick={remove}>Delete</Button>}
                    <Button variant="outline" className="flex-1" onClick={onClose}>Close{inv.status === "reading" || inv.status === "extract_failed" ? "" : ` (${inv.status === "push_failed" ? "push failed" : inv.status})`}</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type LinesProps = { items: LineItem[]; setLine: (i: number, p: Partial<LineItem>) => void; setItems: React.Dispatch<React.SetStateAction<LineItem[]>>; locked: boolean };

// Purchase lines are stock movements matched to a Tally stock item (or expense lines); others are expense lines.
function StdLines({ items, setLine, setItems, locked, stockMode, stock }: LinesProps & { stockMode: boolean; stock: StockItem[] }) {
  const groups = useMemo(() => {
    const g: Record<string, StockItem[]> = {};
    for (const s of stock) (g[(s.parent || "Other").trim() || "Other"] ||= []).push(s);
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [stock]);
  const recalc = (i: number, li: LineItem) => {
    const q = parseFloat(String(li.qty)), r = parseFloat(String(li.rate));
    setLine(i, { ...li, ...(!isNaN(q) && !isNaN(r) ? { amount: (q * r).toFixed(2) } : {}) });
  };
  if (!items.length) return <div className="text-xs text-muted-foreground">No line items.</div>;
  return (
    <div className="space-y-2">
      {items.map((li0, i) => {
        const li = { ...li0, kind: li0.kind || (stockMode ? "stock" : "expense") } as LineItem;
        const isStock = li.kind === "stock";
        const unmatched = !(li.stock_item_name || "").trim();
        return (
          <div key={i} className="space-y-2 rounded-md border bg-muted/20 p-3">
            {!locked && <button className="float-right text-xs text-destructive" onClick={() => setItems((s) => s.filter((_, j) => j !== i))}>Remove</button>}
            {stockMode && (
              <label className="block space-y-1"><span className="text-xs text-muted-foreground">Type</span>
                <select className={sel} value={li.kind} disabled={locked} onChange={(e) => setLine(i, { kind: e.target.value as "stock" | "expense" })}>
                  <option value="stock">Stock item</option><option value="expense">Expense / service</option>
                </select>
              </label>
            )}
            {isStock ? (
              <>
                <label className="block space-y-1"><span className="text-xs text-muted-foreground">From invoice{li.hsn ? ` · HSN ${li.hsn}` : ""}</span>
                  <Input className="text-xs text-muted-foreground" value={li.description || ""} disabled={locked} onChange={(e) => setLine(i, { description: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span className={cn("text-xs", unmatched ? "font-bold text-warning" : "text-muted-foreground")}>Stock Item{unmatched ? " — pick a match ⚠️" : li.stock_match_score ? " ✓ auto-matched" : ""}</span>
                  <select className={cn(sel, unmatched && "border-warning")} value={li.stock_item_name || ""} disabled={locked}
                    onChange={(e) => { const s = stock.find((x) => x.name === e.target.value); recalc(i, { ...li, stock_item_name: e.target.value, ...(s ? { uom: s.base_units } : {}) }); }}>
                    <option value="">{stock.length ? "— Select stock item —" : "— No stock items synced —"}</option>
                    {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</optgroup>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1"><span className="text-xs text-muted-foreground">Qty ({li.uom || "pcs"})</span><Input type="number" step="any" value={li.qty ?? ""} disabled={locked} onChange={(e) => recalc(i, { ...li, qty: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs text-muted-foreground">Rate</span><Input type="number" step="any" value={li.rate ?? ""} disabled={locked} onChange={(e) => recalc(i, { ...li, rate: e.target.value })} /></label>
                </div>
                <label className="block space-y-1"><span className="text-xs text-muted-foreground">Amount (auto qty × rate)</span><Input type="number" step="any" value={li.amount ?? ""} disabled={locked} onChange={(e) => setLine(i, { amount: e.target.value })} /></label>
              </>
            ) : (
              <>
                <label className="block space-y-1"><span className="text-xs text-muted-foreground">Description</span><Input value={li.description || ""} disabled={locked} onChange={(e) => setLine(i, { kind: li.kind, description: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1"><span className="text-xs text-muted-foreground">HSN</span><Input value={li.hsn || ""} disabled={locked} onChange={(e) => setLine(i, { kind: li.kind, hsn: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs text-muted-foreground">Amount</span><Input type="number" step="any" value={li.amount ?? ""} disabled={locked} onChange={(e) => setLine(i, { kind: li.kind, amount: e.target.value })} /></label>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Bank statement lines: a live Dr/Cr reconciliation against the statement totals, then an editable ledger.
function BankLines({ items, setLine, setItems, locked, target }: LinesProps & { target: { dr: number; cr: number } }) {
  const dr = items.reduce((s, li) => s + Math.max(0, -(Number(li.amount) || 0)), 0);
  const cr = items.reduce((s, li) => s + Math.max(0, Number(li.amount) || 0), 0);
  const drOk = Math.abs(dr - target.dr) < 0.05, crOk = Math.abs(cr - target.cr) < 0.05;
  const setAmt = (i: number, v: string, debit: boolean) => { const n = parseFloat(v) || 0; setLine(i, { amount: debit ? (n > 0 ? -n : 0) : n > 0 ? n : 0 }); };
  async function attach(i: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/invoices/attachment", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setLine(i, { attachment_url: data.file_url });
      showToast("Attachment uploaded — save to keep it", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed", "error");
    }
  }
  async function detach(i: number) {
    try {
      await api("/api/invoices/attachment", { method: "DELETE", body: { url: items[i].attachment_url } });
      setLine(i, { attachment_url: null });
    } catch {
      // api() already toasted
    }
  }
  const cell = "w-full bg-transparent px-1 py-1 text-xs focus:outline-none disabled:opacity-70";
  return (
    <>
      <div className={cn("mb-3 grid grid-cols-2 gap-3 rounded-lg border p-3", drOk && crOk && "border-success bg-success/5")}>
        <div><div className="text-[9px] font-semibold text-muted-foreground uppercase">Live Withdrawals (Dr Sum)</div><div className={cn("text-sm font-bold", !drOk && "text-warning")}>{money(dr)}</div><div className="text-[10px] text-muted-foreground">Target: {money(target.dr)}</div></div>
        <div><div className="text-[9px] font-semibold text-muted-foreground uppercase">Live Deposits (Cr Sum)</div><div className={cn("text-sm font-bold", !crOk && "text-warning")}>{money(cr)}</div><div className="text-[10px] text-muted-foreground">Target: {money(target.cr)}</div></div>
        <div className={cn("col-span-2 border-t pt-2 text-[11px] font-bold", drOk && crOk ? "text-success" : "text-warning")}>
          {drOk && crOk ? "✓ Balanced: Statement Ledger Reconciled" : "⚠️ Discrepancy: Ledger values do not match summary goals"}
        </div>
      </div>
      <div className="max-h-[440px] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-[10px] text-muted-foreground uppercase shadow-[0_1px_0_var(--border)]">
            <tr><th className="w-8 p-2">#</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Transaction Remarks</th><th className="p-2 text-right text-destructive">Withdrawal (Dr)</th><th className="p-2 text-right text-success">Deposit (Cr)</th><th className="p-2 text-left">Internal Note &amp; Audit File</th><th className="w-6" /></tr>
          </thead>
          <tbody>
            {items.length ? items.map((li, i) => {
              const a = Number(li.amount) || 0;
              return (
                <tr key={i} className="border-b">
                  <td className="p-1 text-center font-bold text-muted-foreground">{li.si_no || i + 1}</td>
                  <td className="p-1"><input className={cn(cell, "w-[86px]")} value={li.date || ""} disabled={locked} onChange={(e) => setLine(i, { date: e.target.value })} aria-label="Date" /></td>
                  <td className="p-1"><input className={cell} value={li.description || ""} disabled={locked} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Remarks" /></td>
                  <td className="bg-destructive/5 p-1"><input type="number" step="0.01" placeholder="—" className={cn(cell, "text-right font-semibold text-destructive")} value={a < 0 ? -a : ""} disabled={locked} onChange={(e) => setAmt(i, e.target.value, true)} aria-label="Withdrawal" /></td>
                  <td className="bg-success/5 p-1"><input type="number" step="0.01" placeholder="—" className={cn(cell, "text-right font-semibold text-success")} value={a > 0 ? a : ""} disabled={locked} onChange={(e) => setAmt(i, e.target.value, false)} aria-label="Deposit" /></td>
                  <td className="p-1">
                    <div className="flex items-center gap-1.5">
                      <input className="min-w-0 flex-1 rounded border px-2 py-1 text-[11px]" placeholder="Internal comment…" value={li.comment || ""} disabled={locked} onChange={(e) => setLine(i, { comment: e.target.value })} aria-label="Comment" />
                      {!locked && !li.attachment_url && (
                        <label title="Attach Receipt / Voucher File" className="cursor-pointer text-muted-foreground hover:text-foreground"><Paperclip className="size-3.5" />
                          <input type="file" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) attach(i, fl); }} />
                        </label>
                      )}
                      {li.attachment_url && (
                        <span className="flex shrink-0 items-center gap-1">
                          <a href={li.attachment_url} target="_blank" rel="noopener" className="text-[11px] font-bold">View ↗</a>
                          {!locked && <button title="Remove Attached File Only" onClick={() => detach(i)}><X className="size-3.5 text-destructive" /></button>}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-1 text-center">{!locked && <button className="font-bold text-muted-foreground" onClick={() => setItems((s) => s.filter((_, j) => j !== i))}>×</button>}</td>
                </tr>
              );
            }) : <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No records found</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
