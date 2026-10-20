"use client";

import { askConfirm } from "@/components/layout/AskDialog";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Landmark, ClipboardList, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { DOC_TYPE_LABEL, PO_STATUS_LABEL, money, type Invoice, type PoRow } from "@/lib/docs";
import { Chips, Kpi, StatusPill } from "./bits";
import { useDocs } from "./context";

// One list over both tables: crm_invoices rows and crm_purchase_orders rows (flagged _po).
type Row = (Invoice & { _po?: false }) | (PoRow & { _po: true; net_amount?: undefined; party_name?: undefined; doc_type?: undefined; invoice_no?: undefined; original_filename?: undefined; deleted_at?: undefined });
type Status = "all" | "pending" | "approved" | "pushed" | "rejected";

const TYPE_COLOR: Record<string, string> = { bank_statement: "#7c3aed", purchase_order: "#2563eb", purchase_invoice: "#16a34a", freight_invoice: "#ea580c", bill_of_entry: "#0891b2" };
const title = (d: Row) => (d._po ? d.po_number || "PO" : d.invoice_no || d.original_filename || "Untitled");
const party = (d: Row) => (d._po ? d.company_name : d.party_name) || "";

export function AllTab() {
  const docs = useDocs();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>("all");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(false);
  const [docType, setDocType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        let r: Row[];
        if (deleted) r = await api<Invoice[]>("/api/invoices?status=deleted");
        else if (status === "all") {
          const [d, p] = await Promise.all([api<Invoice[]>("/api/invoices"), api<PoRow[]>("/api/po").catch(() => [])]);
          r = [...d, ...p.map((x) => ({ ...x, _po: true as const }))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        } else r = await api<Invoice[]>(`/api/invoices?status=${status}`);
        setRows(r);
        setSel(new Set());
      } catch {
        // api() already toasted
      }
    })();
  }, [status, deleted, docs.version]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((d) => {
      if (t && !title(d).toLowerCase().includes(t) && !party(d).toLowerCase().includes(t)) return false;
      if (docType) {
        if (docType === "purchase_order" && !d._po) return false;
        if (docType !== "purchase_order" && (d._po || d.doc_type !== docType)) return false;
      }
      if (from && d.created_at && new Date(d.created_at) < new Date(from)) return false;
      if (to && d.created_at && new Date(d.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [rows, q, docType, from, to]);

  // Metrics over what's on screen (as ls_crm).
  const m = useMemo(() => {
    let backlog = 0, backlogVal = 0, blocked = 0, ready = 0, readyVal = 0;
    const types: Record<string, number> = { bank_statement: 0, purchase_order: 0, purchase_invoice: 0, freight_invoice: 0, bill_of_entry: 0 };
    for (const d of shown) {
      const amt = Number(d.net_amount) || 0;
      if (d._po) { if (d.status === "draft") backlog++; types.purchase_order++; continue; }
      if (d.status === "pending") { backlog++; if (d.doc_type !== "bank_statement") backlogVal += amt; }
      if (d.status === "extract_failed" || d.status === "push_failed") blocked++;
      if (d.status === "approved") { ready++; if (d.doc_type !== "bank_statement") readyVal += amt; }
      if (d.doc_type && types[d.doc_type] !== undefined) types[d.doc_type]++;
    }
    return { backlog, backlogVal, blocked, ready, readyVal, types };
  }, [shown]);
  const maxType = Math.max(1, ...Object.values(m.types));
  const filterCount = [docType, from, to].filter(Boolean).length + (deleted ? 1 : 0);
  const key = (d: Row) => (d._po ? "po-" : "doc-") + d.id;

  async function remove(list: Row[]) {
    const pushed = list.some((d) => !d._po && d.status === "pushed");
    const one = list.length === 1;
    const title = one ? (list[0]._po ? "Delete this Purchase Order?" : pushed ? "Archive this record?" : "Delete this record?") : `Delete ${list.length} selected record(s)?`;
    const description = pushed
      ? one ? "It was already pushed to Tally. This only archives it here — the voucher stays in Tally." : "Invoices already pushed to Tally are only archived here (their vouchers stay in Tally); the rest are deleted permanently."
      : "This cannot be undone.";
    if (!(await askConfirm({ title, description, confirmLabel: one && pushed && !list[0]._po ? "Archive" : "Delete", destructive: true }))) return;
    let archived = 0, del = 0, failed = 0;
    for (const d of list) {
      try {
        const res = await fetch(d._po ? `/api/po/${d.id}` : `/api/invoices/${d.id}`, { method: "DELETE" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        if (j.soft) archived++; else del++;
      } catch {
        failed++;
      }
    }
    showToast([del && `${del} deleted`, archived && `${archived} archived`, failed && `${failed} failed${!docs.canReview ? " (admin/manager only)" : ""}`].filter(Boolean).join(", ") || "Done", failed ? "error" : "success");
    docs.changed();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr]">
        <Kpi value={m.backlog} label="Approval Backlog" sub={`${money(m.backlogVal)} total`} tone="text-warning" />
        <Kpi value={m.blocked} label="Ingestion Blocked" sub={m.blocked === 1 ? "1 actionable issue" : `${m.blocked} issues pending`} tone="text-destructive" />
        <Kpi value={m.ready} label="Ready For Tally" sub={`${money(m.readyVal)} staged`} tone="text-success" />
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Queue Mix by Classification</div>
          {Object.entries(m.types).map(([t, n]) => (
            <div key={t} className="mb-1 flex items-center gap-2 text-[10px]">
              <div className="w-28 truncate font-semibold uppercase">{DOC_TYPE_LABEL[t]}</div>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${Math.round((n / maxType) * 100)}%`, background: TYPE_COLOR[t] }} /></div>
              <div className="w-5 text-right font-bold">{n}</div>
            </div>
          ))}
        </div>
      </div>

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" /> Add</Button>
          {shown.length > 2 && (
            <Button size="sm" variant="outline" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map(key)))}>
              {sel.size === shown.length ? "Clear all" : "Select all"}
            </Button>
          )}
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Button size="sm" variant={panel || filterCount ? "secondary" : "outline"} onClick={() => setPanel(!panel)}>
            <SlidersHorizontal className="size-4" /> Filters{filterCount ? ` (${filterCount})` : ""}
          </Button>
        </div>
        {panel && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
            <label className="text-xs">
              <div className="mb-1 text-muted-foreground">Doc Type</div>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All types</option>
                {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs"><div className="mb-1 text-muted-foreground">Added from</div><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" /></label>
            <label className="text-xs"><div className="mb-1 text-muted-foreground">Added to</div><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" /></label>
            <Button size="sm" variant="ghost" onClick={() => { setDocType(""); setFrom(""); setTo(""); setDeleted(false); }}>Clear</Button>
            <div className="flex w-full flex-wrap items-center gap-3">
              <div className={deleted ? "pointer-events-none opacity-40" : ""}>
                <Chips<Status> value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "pushed", label: "Pushed" }, { value: "rejected", label: "Rejected" }]} />
              </div>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={deleted} onCheckedChange={(v) => setDeleted(!!v)} /> Show deleted records</label>
            </div>
          </div>
        )}
        {sel.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-foreground/30 bg-muted/40 px-3 py-2 text-xs font-semibold">
            {sel.size} selected
            <Button size="sm" variant="destructive" onClick={() => remove(shown.filter((d) => sel.has(key(d))))}>Delete</Button>
          </div>
        )}
        <DataTable
          title="Documents"
          data={shown}
          pageSize={10}
          getRowKey={key}
          columns={[
            {
              label: "",
              render: (d) => (
                <Checkbox
                  aria-label={`Select ${title(d)}`}
                  checked={sel.has(key(d))}
                  onCheckedChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(key(d)); else n.delete(key(d)); return n; })}
                />
              ),
            },
            {
              label: "Document",
              render: (d) => (
                <span>
                  <button className="font-semibold hover:underline" onClick={() => (d._po ? docs.openPo(d.id) : docs.openReview(d.id))}>{title(d)}</button>
                  {d._po && d.po_source !== "manual" && <span className="ml-1.5 rounded border px-1 text-[9px] font-bold text-muted-foreground">{d.po_source === "upload" ? "IMPORTED" : "SYS"}</span>}
                </span>
              ),
            },
            { label: "Type", render: (d) => <span className="text-xs">{d._po ? "Purchase Order" : DOC_TYPE_LABEL[d.doc_type || ""] || d.doc_type || "—"}</span>, className: "hidden sm:table-cell" },
            { label: "Party", render: (d) => party(d) || "—", className: "hidden md:table-cell" },
            { label: "Amount", render: (d) => (!d._po && d.net_amount ? money(d.net_amount) : "—") },
            { label: "Stage", render: (d) => <StatusPill status={d.status} label={d._po ? PO_STATUS_LABEL[d.status] : undefined} /> },
            { label: "Added", render: (d) => formatDate(d.created_at), className: "hidden lg:table-cell" },
            {
              label: "",
              render: (d) => (!d._po && d.deleted_at) || !docs.canReview ? null : (
                <Button variant="ghost" size="icon" title="Delete" onClick={() => remove([d])}><Trash2 className="size-4 text-destructive" /></Button>
              ),
            },
          ]}
        />
      </Card>

      <AddDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const TYPES = [
  { key: "invoice", name: "Invoice", sub: "Purchase / freight → Tally", icon: FileText },
  { key: "bank_statement", name: "Bank statement", sub: "Transactions → Tally", icon: Landmark },
  { key: "purchase_order", name: "Purchase order", sub: "Own lifecycle · no Tally", icon: ClipboardList },
] as const;

// "What are you adding?" → Upload PDF (AI) / Enter manually / (PO) Generate.
function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const docs = useDocs();
  const [type, setType] = useState<(typeof TYPES)[number] | null>(null);
  // "Invoice" sends no hint: the AI decides purchase vs freight.
  const hint = type && type.key !== "invoice" ? type.key : null;
  const close = () => { setType(null); onClose(); };
  const action = (Icon: typeof Upload, name: string, sub: string, run: () => void) => (
    <button onClick={run} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span><span className="block text-sm font-semibold">{name}</span><span className="block text-xs text-muted-foreground">{sub}</span></span>
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? type.name : "What are you adding?"}</DialogTitle>
          <DialogDescription>{type ? "How would you like to add it?" : "Choose a document type to begin"}</DialogDescription>
        </DialogHeader>
        {!type ? (
          <div className="grid gap-2">{TYPES.map((t) => action(t.icon, t.name, t.sub, () => setType(t)))}</div>
        ) : (
          <div className="grid gap-2">
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setType(null)}><ArrowLeft className="size-3.5" /> Back</button>
            <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted">
              <Upload className="size-5 shrink-0 text-muted-foreground" />
              <span><span className="block text-sm font-semibold">Upload PDF</span><span className="block text-xs text-muted-foreground">{type.key === "purchase_order" ? "Read a PO document and import it" : "Read it automatically with AI"}</span></span>
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { docs.upload(f, hint); close(); } }} />
            </label>
            {action(Pencil, "Enter manually", "Fill in the fields yourself", () => { close(); if (type.key === "purchase_order") docs.openPo("new"); else docs.manual(hint); })}
            {type.key === "purchase_order" && action(Plus, "Generate", "Create a system PO (SYS-XXX) from scratch", () => { close(); docs.openPo("new"); })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
