"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable } from "@/components/data-table/DataTable";
import { api, downloadFile } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { BRAND } from "@/lib/brand";
import { docDate, money } from "@/lib/docs";
import { Kpi, StatusPill } from "./bits";
import { useDocs } from "./context";

interface InvLine { item_code: string; description: string; hsn_code: string | null; rate: number | null; gst_rate: number | null; qty: number; reels: number; amount: number; cgst: number; sgst: number; total: number }
interface Invoice { invoice_no: string; invoice_date: string; customer_name: string; created_by: string; updated_by: string | null; taxable: number; cgst: number; sgst: number; round_off: number; total: number; qty: number; missing_rates: number; items?: number; lines?: InvLine[] }

async function downloadPdf(no: string) {
  const res = await fetch(`/api/sales-invoices/${encodeURIComponent(no)}/pdf`);
  try {
    await downloadFile(res, `invoice_${no}.pdf`);
  } catch {
    showToast("Could not build the invoice PDF", "error");
  }
}

// Tax invoices issued for partner-store shipments (same number as the packing list). Other customers'
// invoices come from Tally and are uploaded on the other tabs.
export function SalesTab() {
  const docs = useDocs();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api<Invoice[]>("/api/sales-invoices").then(setRows).catch(() => {});
  }, [docs.version]);
  const drafts = rows.filter((r) => r.missing_rates > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi value={rows.length} label={`${BRAND.partnerStore} invoices`} />
        <Kpi value={drafts.length} label="Need rates" sub="print as DRAFT until filled" tone={drafts.length ? "text-warning" : ""} />
        <Kpi value={money(rows.reduce((s, r) => s + r.total, 0), 0)} label="Invoiced (listed)" />
      </div>
      <Card className="gap-3 p-4">
        <p className="text-xs text-muted-foreground">
          Created automatically with each {BRAND.partnerStore} packing list. Quantities follow the shipment&apos;s outwards; description, HSN, rate and GST are set here.
        </p>
        <DataTable
          title="Sales invoices"
          data={rows}
          pageSize={15}
          getRowKey={(r) => r.invoice_no}
          columns={[
            { label: "Invoice No.", render: (r) => <button className="font-semibold hover:underline" onClick={() => setOpen(r.invoice_no)}>{r.invoice_no}</button> },
            { label: "Date", render: (r) => docDate(r.invoice_date) },
            { label: "Items", render: (r) => r.items, className: "hidden sm:table-cell" },
            { label: "Qty", render: (r) => formatQty(r.qty), className: "hidden sm:table-cell" },
            { label: "Total", render: (r) => <strong>{money(r.total)}</strong> },
            { label: "Status", render: (r) => (r.missing_rates ? <StatusPill status="pending" label={`Draft · ${r.missing_rates} without rate`} /> : <StatusPill status="approved" label="Ready" />) },
            { label: "", render: (r) => <Button variant="ghost" size="icon" title="Download PDF" onClick={() => downloadPdf(r.invoice_no)}><Download className="size-4" /></Button> },
          ]}
        />
      </Card>
      <InvoiceSheet no={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function InvoiceSheet({ no, onClose }: { no: string | null; onClose: () => void }) {
  const docs = useDocs();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvLine[]>([]);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!no) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInv(null);
    api<Invoice>(`/api/sales-invoices/${encodeURIComponent(no)}`, { method: "POST" }).then((d) => { setInv(d); setLines(d.lines || []); }).catch(() => onClose());
  }, [no, onClose]);

  const set = (i: number, patch: Partial<InvLine>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  async function save() {
    if (!inv) return;
    setBusy(true);
    try {
      const d = await api<Invoice>(`/api/sales-invoices/${encodeURIComponent(inv.invoice_no)}`, {
        method: "PUT",
        body: { remember, lines: lines.map(({ item_code, description, hsn_code, rate, gst_rate }) => ({ item_code, description, hsn_code, rate, gst_rate })) },
      });
      setInv(d);
      setLines(d.lines || []);
      showToast("Invoice saved", "success");
      docs.changed();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={no != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>Invoice {no}</SheetTitle>
          <SheetDescription>{inv ? `${docDate(inv.invoice_date)} · ${inv.customer_name}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {inv && (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] text-muted-foreground uppercase">
                    <tr><th className="p-2 text-left">Item / description on invoice</th><th className="p-2 text-left">HSN</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">GST %</th><th className="p-2 text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.item_code} className="border-t align-top">
                        <td className="p-2">
                          <div className="mb-1 font-semibold">{l.item_code} <span className="font-normal text-muted-foreground">· {l.reels} reel{l.reels !== 1 ? "s" : ""}</span></div>
                          <Input className="h-8 text-xs" value={l.description} disabled={!docs.canReview} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" />
                        </td>
                        <td className="p-2"><Input className="h-8 w-24 text-xs" value={l.hsn_code ?? ""} disabled={!docs.canReview} onChange={(e) => set(i, { hsn_code: e.target.value })} aria-label="HSN" /></td>
                        <td className="p-2 text-right whitespace-nowrap">{formatQty(l.qty)}</td>
                        <td className="p-2"><Input type="number" step="0.01" min={0} className="ml-auto h-8 w-20 text-right text-xs" value={l.rate ?? ""} disabled={!docs.canReview} onChange={(e) => set(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Rate" /></td>
                        <td className="p-2"><Input type="number" step="0.01" min={0} className="ml-auto h-8 w-16 text-right text-xs" value={l.gst_rate ?? ""} disabled={!docs.canReview} onChange={(e) => set(i, { gst_rate: e.target.value === "" ? null : Number(e.target.value) })} aria-label="GST %" /></td>
                        <td className="p-2 text-right whitespace-nowrap">{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto w-64 space-y-1 text-xs">
                {[["Taxable", inv.taxable], ["CGST", inv.cgst], ["SGST", inv.sgst], ["Round off", inv.round_off]].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{money(v as number)}</span></div>
                ))}
                <div className="flex justify-between border-t pt-1 text-sm font-bold"><span>Total</span><span>{money(inv.total)}</span></div>
                <p className="text-[10px] text-muted-foreground">Totals refresh after saving.</p>
              </div>
              {docs.canReview && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} /> Use these as the defaults for these items on future invoices
                </label>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2 border-t p-3">
          <Button variant="outline" className="flex-1" onClick={() => no && downloadPdf(no)}><Download className="size-4" /> PDF</Button>
          {docs.canReview && <Button className="flex-1" disabled={busy || !inv} onClick={save}>Save</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
