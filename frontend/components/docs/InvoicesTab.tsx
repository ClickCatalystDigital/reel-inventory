"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plane, Plus, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { INV_TYPES, lines, money, type Invoice } from "@/lib/docs";
import { Chips, Kpi, StatusPill } from "./bits";
import { useDocs } from "./context";

const TYPE_LABEL: Record<string, string> = { purchase_invoice: "Purchase", freight_invoice: "Freight", bill_of_entry: "Bill of Entry" };
type Stage = "all" | "pending" | "approved" | "pushed" | "rejected";
const round = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

// Purchase + freight invoices: GST credit in the pipeline, cost per piece / per kg, shipment details.
export function InvoicesTab() {
  const docs = useDocs();
  const [all, setAll] = useState<Invoice[]>([]);
  const [stage, setStage] = useState<Stage>("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Invoice[]>("/api/invoices").then((r) => setAll(r.filter((d) => INV_TYPES.includes(d.doc_type || "")))).catch(() => {});
  }, [docs.version]);

  const shown = useMemo(() => {
    const t = q.toLowerCase();
    return all.filter((d) =>
      (stage === "all" || d.status === stage) && (type === "all" || d.doc_type === type) &&
      (!t || [d.invoice_no, d.party_name, d.commodity, d.mawb_no].some((v) => v && v.toLowerCase().includes(t))));
  }, [all, stage, type, q]);

  const pending = all.filter((d) => d.status === "pending");
  const errors = all.filter((d) => ["extract_failed", "push_failed"].includes(d.status)).length;
  const pipeline = all.filter((d) => ["pending", "approved"].includes(d.status));
  const sum = (k: "cgst" | "sgst" | "igst") => pipeline.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const [cgst, sgst, igst] = [sum("cgst"), sum("sgst"), sum("igst")];
  const filterCount = (stage !== "all" ? 1 : 0) + (type !== "all" ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi value={pending.length} label="Pending Approval" sub={round(pending.reduce((s, d) => s + (Number(d.net_amount) || 0), 0))} tone="text-warning" />
        <Kpi value={round(cgst + sgst + igst)} label="GST Recoverable" sub="Input Credit Available" tone="text-success" />
        {errors > 0 && <Kpi value={errors} label="Need Attention" sub="Stalled pipelines" tone="text-destructive" className="border-destructive/40" />}
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">GST Input Credit Ledger (Pipeline)</div>
          <div className="flex gap-4">
            {[["CGST", cgst], ["SGST", sgst], ["IGST", igst]].filter(([, v]) => (v as number) > 0).map(([l, v]) => (
              <div key={l as string}><div className="text-sm font-bold">{round(v as number)}</div><div className="text-[9px] font-semibold text-muted-foreground uppercase">{l}</div></div>
            ))}
            {cgst + sgst + igst === 0 && <div className="text-xs text-muted-foreground">No credits in pipeline</div>}
          </div>
        </div>
      </div>

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm"><Plus className="size-4" /> Create <ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => docs.manual("purchase_invoice")}>Purchase Invoice</DropdownMenuItem>
              <DropdownMenuItem onClick={() => docs.manual("freight_invoice")}>Freight Invoice</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* no hint: the AI decides purchase vs freight */}
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}><Upload className="size-4" /> Upload</Button>
          <input ref={file} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) docs.upload(f, null); }} />
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search number, vendor, commodity…" value={q} onChange={(e) => setQ(e.target.value.trim())} className="pl-8" />
          </div>
          <Button size="sm" variant={panel || filterCount ? "secondary" : "outline"} onClick={() => setPanel(!panel)}>
            <SlidersHorizontal className="size-4" /> Filters{filterCount ? ` (${filterCount})` : ""}
          </Button>
        </div>
        {panel && (
          <div className="flex flex-wrap items-start gap-5 rounded-lg border bg-muted/30 p-3">
            <label className="text-xs">
              <div className="mb-1 text-muted-foreground">Doc Category</div>
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="all">All Classifications</option>
                <option value="purchase_invoice">Purchase Invoices</option>
                <option value="freight_invoice">Freight Log Invoices</option>
              </select>
            </label>
            <div className="text-xs">
              <div className="mb-1 text-muted-foreground">Stage</div>
              <Chips<Stage> value={stage} onChange={setStage} options={[{ value: "all", label: "All" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "pushed", label: "Pushed" }, { value: "rejected", label: "Rejected" }]} />
            </div>
          </div>
        )}
        <DataTable
          title="Invoices"
          data={shown}
          pageSize={12}
          getRowKey={(d) => d.id}
          columns={[
            { label: "Document", render: (d) => <button className="font-semibold hover:underline" onClick={() => docs.openReview(d.id)}>{d.invoice_no || d.original_filename || "Untitled"}</button> },
            {
              label: "Party / Vendor",
              render: (d) => (
                <div>
                  <div className="font-semibold">{d.party_name || "—"}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="rounded border px-1 text-[9px] font-bold text-muted-foreground uppercase">{TYPE_LABEL[d.doc_type || ""] || d.doc_type}</span>
                    {d.party_gstin && <span className="font-mono text-[10px] text-muted-foreground">{d.party_gstin}</span>}
                  </div>
                </div>
              ),
            },
            { label: "Document Insights", render: (d) => <Insights d={d} />, className: "hidden md:table-cell" },
            { label: "Shipment Tracking", render: (d) => <Shipment d={d} all={all} />, className: "hidden lg:table-cell" },
            { label: "Stage", render: (d) => <StatusPill status={d.status} /> },
            { label: "Added", render: (d) => <span className="text-xs text-muted-foreground">{formatDate(d.created_at)}</span>, className: "hidden sm:table-cell" },
          ]}
        />
      </Card>
    </div>
  );
}

function Insights({ d }: { d: Invoice }) {
  const net = Number(d.net_amount) || 0;
  let sub: React.ReactNode = d.doc_type === "bill_of_entry" ? "Customs Duty" : "Net Document Value";
  if (d.doc_type === "purchase_invoice") {
    const qty = lines(d).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    sub = qty > 0 ? <>Purchase Value · <b className="text-foreground">{qty.toLocaleString("en-IN")} pcs</b> (₹{(net / qty).toFixed(2)}/component)</> : "Purchase Value";
  } else if (d.doc_type === "freight_invoice") {
    const kg = Number(d.gross_weight) || 0;
    sub = kg > 0 ? <>Logistics Charges · <b className="text-foreground">{kg} kg shipment</b> (₹{(net / kg).toFixed(2)}/kg)</> : "Logistics Charges";
  }
  return (
    <div>
      <div className="text-sm font-bold">{money(net)}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// Shipment details for a MAWB, filled from the freight invoice for the same MAWB where this row lacks them.
function Shipment({ d, all }: { d: Invoice; all: Invoice[] }) {
  if (!d.mawb_no) return <span className="text-xs text-muted-foreground">Inland / Local Delivery</span>;
  const log = all.find((r) => r.doc_type === "freight_invoice" && r.mawb_no === d.mawb_no);
  const v = (k: "flight_no" | "origin_airport" | "dest_airport" | "gross_weight") => d[k] || log?.[k] || "—";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"><Plane className="size-3.5" /> Attached Shipment</button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs">
        <div className="mb-2 font-semibold">Shipment Manifest Summary</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <span className="text-muted-foreground">MAWB</span><span>{d.mawb_no}</span>
          <span className="text-muted-foreground">Flight</span><span>{v("flight_no")}</span>
          <span className="text-muted-foreground">Gross Weight</span><span>{v("gross_weight")} KG</span>
          <span className="text-muted-foreground">Route</span><span>{v("origin_airport")} → {v("dest_airport")}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
