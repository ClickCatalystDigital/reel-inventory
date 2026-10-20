"use client";

import { askConfirm } from "@/components/layout/AskDialog";
import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SearchPicker } from "@/components/SearchPicker";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PO_STATUS_LABEL, docDate, money, type CatalogItem, type Company, type PoFull } from "@/lib/docs";
import { SectionLabel, StatusPill } from "./bits";
import { useDocs } from "./context";

const TYPE_SHORT: Record<string, string> = { purchase_invoice: "Purchase", freight_invoice: "Freight", bill_of_entry: "BOE", bank_statement: "Bank" };
const pdfUrl = (u: string) => u.trim().replace(/^https:\/\/https:\/\//, "https://");
const Field = ({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={cn("space-y-1", className)}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
);

export function PoSheet({ id, onClose }: { id: number | "new" | null; onClose: () => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  useEffect(() => {
    if (id == null || companies.length) return;
    api<Company[]>("/api/po/companies").then(setCompanies).catch(() => {});
    api<CatalogItem[]>("/api/po/items").then(setCatalog).catch(() => {});
  }, [id, companies.length]);
  const itemOptions = catalog.map((it) => ({ value: it.item_code, label: it.description ? `${it.item_code} — ${it.description}` : it.item_code }));
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      {id === "new" ? (
        <NewPo onClose={onClose} companyOptions={companyOptions} itemOptions={itemOptions} />
      ) : id != null ? (
        <ViewPo id={id} onClose={onClose} companyOptions={companyOptions} itemOptions={itemOptions} />
      ) : null}
    </Sheet>
  );
}

type Opt<V> = { value: V; label: string }[];

function ViewPo({ id, onClose, companyOptions, itemOptions }: { id: number; onClose: () => void; companyOptions: Opt<number>; itemOptions: Opt<string> }) {
  const docs = useDocs();
  const [po, setPo] = useState<PoFull | null>(null);
  const [head, setHead] = useState({ company_id: null as number | null, order_date: "", expected: "" });

  async function load() {
    try {
      const p = await api<PoFull>(`/api/po/${id}`);
      setPo(p);
      setHead({ company_id: p.company_id, order_date: p.order_date || "", expected: p.expected_dispatch_date || "" });
    } catch {
      onClose();
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPo(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const editable = !!po && ["draft", "confirmed"].includes(po.status);
  const call = async (method: string, path: string, body: unknown, msg?: string, reload = true) => {
    try {
      await api(path, { method, body });
      if (msg) showToast(msg, "success");
      if (reload) load();
      docs.changed();
      return true;
    } catch {
      return false;
    }
  };
  const saveLine = (itemId: number, field: string, value: string | null) => call("PATCH", `/api/po/${id}/items/${itemId}`, { [field]: value || null }, undefined, field === "item_code");
  const saveHeader = () => call("PATCH", `/api/po/${id}`, { company_id: head.company_id, order_date: head.order_date || null, expected_dispatch_date: head.expected || null }, "Saved");
  const dispatch = async () => {
    if (!head.expected) return showToast("Set a delivery date first", "error");
    if (await call("POST", `/api/po/${id}/dispatch`, { dispatch_date: head.expected }, "PO dispatched", false)) onClose();
  };
  const cancel = async () => {
    if (!(await askConfirm({ title: "Cancel this PO?", description: "This cannot be undone.", confirmLabel: "Cancel PO", destructive: true }))) return;
    if (await call("POST", `/api/po/${id}/cancel`, undefined, "PO cancelled", false)) onClose();
  };

  const total = (po?.items || []).reduce((s, i) => s + (i.quantity_ordered || 0) * (i.unit_price || 0), 0);
  const groups = Object.values((po?.outwards || []).reduce<Record<string, { inv: string; date: string; reels: number; pcs: number }>>((g, o) => {
    const k = o.invoice_number || "—";
    g[k] ||= { inv: k, date: o.outward_date, reels: 0, pcs: 0 };
    g[k].reels++; g[k].pcs += o.quantity_shipped || 0;
    return g;
  }, {})).sort((a, b) => (a.date < b.date ? 1 : -1));
  const dup = po?.notes?.includes("Duplicate PO number");

  return (
    <SheetContent className={cn("gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg", po?.file_url && "data-[side=right]:md:max-w-[min(1100px,96vw)]")}>
      <div className="flex h-full min-h-0">
        {po?.file_url && <iframe title="PO document" src={pdfUrl(po.file_url)} className="hidden h-full min-w-0 flex-1 border-r bg-muted md:block" />}
        <div className={cn("flex h-full min-h-0 w-full flex-col", po?.file_url && "md:w-[480px] md:shrink-0")}>
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle>
              {po ? po.po_number : "PO"}
              {po && po.po_source !== "manual" && <span className="ml-2 rounded border px-1 align-middle text-[9px] font-bold text-muted-foreground">{po.po_source === "upload" ? "IMPORTED" : "SYS"}</span>}
            </SheetTitle>
            <SheetDescription asChild>
              <div className="flex items-center gap-2">
                {po && <StatusPill status={po.status} label={PO_STATUS_LABEL[po.status]} />}
                {po?.file_url && <a href={pdfUrl(po.file_url)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] font-semibold md:hidden"><ExternalLink className="size-3" /> View PDF</a>}
              </div>
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {!po ? <div className="text-muted-foreground">Loading…</div> : (
              <>
                {editable ? (
                  <Field label="Customer">
                    <SearchPicker options={companyOptions} value={head.company_id} onChange={(v) => setHead({ ...head, company_id: v })} placeholder="— Select customer —" />
                  </Field>
                ) : (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{po.company_name}{po.poc_name ? " · " + po.poc_name : ""}</span>
                    {total > 0 && <span className="text-sm font-bold text-foreground">{money(total)}</span>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Order Date"><Input type="date" value={head.order_date} disabled={!editable} onChange={(e) => setHead({ ...head, order_date: e.target.value })} /></Field>
                  <Field label="Expected Delivery"><Input type="date" value={head.expected} disabled={!editable} onChange={(e) => setHead({ ...head, expected: e.target.value })} /></Field>
                </div>
                {po.dispatch_date && <Field label="Dispatched On"><Input value={docDate(po.dispatch_date)} disabled /></Field>}
                {po.notes && (
                  <div className={cn("rounded-md border p-2 text-xs", dup ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-warning/30 bg-warning/5 text-muted-foreground")}>
                    {dup && "⚠ Duplicate import — "}{po.notes}
                  </div>
                )}

                <SectionLabel>Line Items ({po.items.length})</SectionLabel>
                {!po.items.length && <div className="text-xs text-muted-foreground">No line items yet.</div>}
                {po.items.map((it) => (
                  <div key={it.id} className="space-y-2 rounded-md border bg-muted/20 p-3">
                    {!it.item_code && <div className="text-[10px] font-bold text-warning">⚠ Unassigned{it.notes ? " — " + it.notes : ""}</div>}
                    <Field label="Item">
                      {editable
                        ? <SearchPicker options={itemOptions} value={it.item_code} onChange={(v) => saveLine(it.id, "item_code", v)} placeholder="— Select item —" searchPlaceholder="Search items…" />
                        : <div className="font-bold">{it.item_code || "—"}</div>}
                      {it.description && <div className="text-[10px] text-muted-foreground">{it.description}</div>}
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Qty (NOS)"><Input type="number" min={1} defaultValue={it.quantity_ordered || ""} disabled={!editable} className="font-bold" onBlur={(e) => e.target.value !== String(it.quantity_ordered) && saveLine(it.id, "quantity_ordered", e.target.value)} /></Field>
                      <Field label="Unit Price (₹)"><Input type="number" step="0.01" placeholder="—" defaultValue={it.unit_price ?? ""} disabled={!editable} onBlur={(e) => e.target.value !== String(it.unit_price ?? "") && saveLine(it.id, "unit_price", e.target.value)} /></Field>
                    </div>
                    {editable && <Button variant="outline" size="sm" className="w-full text-destructive" onClick={() => call("DELETE", `/api/po/${id}/items/${it.id}`, undefined)}>Remove</Button>}
                  </div>
                ))}
                {editable && <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => call("POST", `/api/po/${id}/items`, { quantity_ordered: 1 })}>+ Add line item</Button>}

                {groups.length > 0 && (
                  <>
                    <SectionLabel>Dispatched — {po.outwards.length} reels · {po.outwards.reduce((s, o) => s + (o.quantity_shipped || 0), 0).toLocaleString("en-IN")} pcs total</SectionLabel>
                    {groups.map((g) => (
                      <div key={g.inv} className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                        <div><div className="text-xs font-bold">Inv: {g.inv}</div><div className="text-[10px] text-muted-foreground">{g.reels} reel{g.reels !== 1 ? "s" : ""} · {docDate(g.date)}</div></div>
                        <div className="text-sm font-bold">{g.pcs.toLocaleString("en-IN")} pcs</div>
                      </div>
                    ))}
                  </>
                )}
                {po.relatedInvoices.length > 0 && (
                  <>
                    <SectionLabel>Invoices — {po.company_name} ({po.relatedInvoices.length})</SectionLabel>
                    {po.relatedInvoices.map((inv) => (
                      <button key={inv.id} onClick={() => docs.openReview(inv.id)} className="flex w-full items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-left hover:bg-muted">
                        <div><div className="text-xs font-bold">{inv.invoice_no || "—"}</div><div className="text-[10px] text-muted-foreground">{TYPE_SHORT[inv.doc_type] || inv.doc_type} · {docDate(inv.invoice_date)}</div></div>
                        <div className="text-right"><div className="text-xs font-bold">{inv.net_amount ? money(inv.net_amount) : "—"}</div><div className="text-[10px] text-muted-foreground">{inv.status}</div></div>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {po && (
            <div className="flex gap-2 border-t p-3">
              {docs.canReview && editable && <Button variant="outline" className="text-destructive" onClick={cancel}>Cancel</Button>}
              {editable ? (
                <>
                  <Button variant="outline" className="flex-1" onClick={saveHeader}>Save</Button>
                  {po.status === "draft"
                    ? <Button className="flex-1" onClick={() => call("POST", `/api/po/${id}/confirm`, undefined, "PO confirmed")}>Confirm PO</Button>
                    : <Button className="flex-1 bg-success text-white hover:bg-success/90" onClick={dispatch}>Mark Dispatched</Button>}
                </>
              ) : <Button variant="outline" className="flex-1" onClick={onClose}>Close ({po.status})</Button>}
            </div>
          )}
        </div>
      </div>
    </SheetContent>
  );
}

function NewPo({ onClose, companyOptions, itemOptions }: { onClose: () => void; companyOptions: Opt<number>; itemOptions: Opt<string> }) {
  const docs = useDocs();
  const [gen, setGen] = useState(false);
  const [num, setNum] = useState("");
  const [company, setCompany] = useState<number | null>(null);
  const [contacts, setContacts] = useState<Opt<number>>([]);
  const [contact, setContact] = useState<number | null>(null);
  const [orderDate, setOrderDate] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([{ item_code: null as string | null, qty: "", price: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContact(null);
    setContacts([]);
    if (!company) return;
    api<{ id: number; poc_name: string; designation: string | null }[]>(`/api/clients?company_id=${company}`)
      .then((cs) => setContacts(cs.map((c) => ({ value: c.id, label: c.designation ? `${c.poc_name} — ${c.designation}` : c.poc_name }))))
      .catch(() => {});
  }, [company]);

  async function create() {
    if (!company) return showToast("Select a company", "error");
    if (!gen && !num.trim()) return showToast("Enter a PO number or auto-generate", "error");
    setBusy(true);
    try {
      const r = await api<{ po_number: string }>("/api/po", {
        method: "POST",
        body: {
          generate_number: gen, po_number: gen ? undefined : num.trim(), company_id: company, contact_id: contact,
          order_date: orderDate || null, expected_dispatch_date: expected || null, notes: notes.trim() || null,
          items: rows.filter((l) => l.item_code && parseInt(l.qty) > 0).map((l) => ({ item_code: l.item_code, quantity_ordered: parseInt(l.qty), unit_price: parseFloat(l.price) || null })),
        },
      });
      showToast(`${r.po_number} created`, "success");
      onClose(); docs.setTab("po"); docs.changed();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
      <SheetHeader className="border-b p-4 pr-12">
        <SheetTitle>New Purchase Order</SheetTitle>
        <SheetDescription asChild><div><StatusPill status="draft" /></div></SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <Field label={<>PO Number <span className="text-destructive">*</span></>}>
          <Input value={num} disabled={gen} placeholder={gen ? "Auto SYS-XXX" : "e.g. PO-2024-001"} onChange={(e) => setNum(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Checkbox checked={gen} onCheckedChange={(v) => { setGen(!!v); if (v) setNum(""); }} /> Auto-generate (SYS-XXX)
        </label>
        <Field label={<>Company <span className="text-destructive">*</span></>}><SearchPicker options={companyOptions} value={company} onChange={setCompany} placeholder="— Select company —" /></Field>
        <Field label="Contact (optional)"><SearchPicker options={contacts} value={contact} onChange={setContact} placeholder="— Select contact —" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order Date"><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
          <Field label="Expected Dispatch"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Input value={notes} placeholder="Any remarks" onChange={(e) => setNotes(e.target.value)} /></Field>
        <SectionLabel>Line items</SectionLabel>
        {rows.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_80px_auto] items-center gap-2">
            <SearchPicker options={itemOptions} value={l.item_code} onChange={(v) => setRows((s) => s.map((x, j) => (j === i ? { ...x, item_code: v } : x)))} placeholder="— Item —" searchPlaceholder="Search items…" />
            <Input type="number" min={1} placeholder="Qty" value={l.qty} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <Input type="number" step="0.01" placeholder="₹" value={l.price} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" title="Remove" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}><X className="size-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setRows((s) => [...s, { item_code: null, qty: "", price: "" }])}>+ Add item</Button>
      </div>
      <div className="flex gap-2 border-t p-3">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" disabled={busy} onClick={create}>Create PO</Button>
      </div>
    </SheetContent>
  );
}
