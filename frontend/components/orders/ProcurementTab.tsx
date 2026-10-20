"use client";

import { askConfirm } from "@/components/layout/AskDialog";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable } from "@/components/data-table/DataTable";
import { SearchPicker } from "@/components/SearchPicker";
import { api } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PROC_STAGES } from "@/lib/po-stages";
import { StageBadge } from "./StageSelect";

interface ShortLine { po_item_id: number; po_id: number; po_number: string; company_name: string | null; expected_dispatch_date: string | null; needed: number }
interface Short { item_code: string; description: string | null; supplier: string | null; free_stock: number; needed: number; lines: ShortLine[] }
interface OrderRow { id: number; number: string; supplier: string; status: string; expected_date: string | null; items: number; item_codes: string[]; qty_ordered: number; qty_received: number; stage: string | null; created_at: string }
interface Alloc { id: number; po_item_id: number; qty: number; po_id: number; po_number: string; company_name: string | null; expected_dispatch_date: string | null }
interface OrderItem { id: number; item_code: string; description: string | null; qty_ordered: number; qty_received: number; stage: string; unit_cost: number | null; currency: string | null; allocations: Alloc[]; for_ls_stock: number }
interface Order { id: number; number: string; supplier: string; status: string; expected_date: string | null; notes: string | null; items: OrderItem[] }

const STATUS_TONE: Record<string, string> = { draft: "text-muted-foreground", ordered: "text-foreground font-semibold", closed: "text-success", cancelled: "text-destructive line-through" };

// Procurement (China) orders: what open customer POs still need, pooled by item → draft orders with a stage
// per item. Customer PO lines follow those stages; receiving happens on Inward ("against procurement order").
export function ProcurementTab({ canEdit, onOpenPo }: { canEdit: boolean; onOpenPo: (id: number) => void }) {
  const [view, setView] = useState<"shortfall" | "orders">("shortfall");
  const [short, setShort] = useState<Short[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  const reload = useCallback(() => {
    api<Short[]>("/api/procurement/shortfall").then(setShort).catch(() => {});
    api<OrderRow[]>("/api/procurement").then(setOrders).catch(() => {});
  }, []);
  useEffect(() => {
     
    reload();
  }, [reload]);

  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["shortfall", "orders"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={cn("rounded-md border px-3 py-1.5 text-xs font-semibold", view === v ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}>
            {v === "shortfall" ? `To procure (${short.length})` : `Procurement orders (${orders.filter((o) => !["closed", "cancelled"].includes(o.status)).length} open)`}
          </button>
        ))}
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {view === "shortfall" && picked.size ? `Create draft order (${picked.size})` : "New order"}
          </Button>
        )}
      </div>

      {view === "shortfall" ? (
        <Card className="gap-0 overflow-hidden p-0">
          {!short.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Every open PO line is covered by reserved stock or a procurement order.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground uppercase">
                <tr>{canEdit && <th className="w-8 p-2" />}<th className="p-2">Item</th><th className="p-2 text-right">Still needed</th><th className="hidden p-2 text-right sm:table-cell">Free at LS</th><th className="hidden p-2 md:table-cell">Waiting POs</th></tr>
              </thead>
              <tbody>
                {short.map((g) => (
                  <Fragment key={g.item_code}>
                    <tr className="border-t align-top">
                      {canEdit && <td className="p-2"><Checkbox aria-label={`Select ${g.item_code}`} checked={picked.has(g.item_code)} onCheckedChange={() => setPicked((s) => toggle(s, g.item_code))} /></td>}
                      <td className="p-2">
                        <button className="flex items-center gap-1 font-semibold" onClick={() => setOpen((s) => toggle(s, g.item_code))}>
                          {open.has(g.item_code) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{g.item_code}
                        </button>
                        {g.description && <div className="pl-5 text-xs text-muted-foreground">{g.description}</div>}
                      </td>
                      <td className="p-2 text-right font-semibold text-warning">{formatQty(g.needed)}</td>
                      <td className="hidden p-2 text-right sm:table-cell">
                        {formatQty(g.free_stock)}
                        {g.free_stock > 0 && <div className="text-[10px] text-muted-foreground">reserve it on the PO first</div>}
                      </td>
                      <td className="hidden p-2 text-xs text-muted-foreground md:table-cell">{g.lines.map((l) => l.po_number).join(", ")}</td>
                    </tr>
                    {open.has(g.item_code) && g.lines.map((l) => (
                      <tr key={l.po_item_id} className="bg-muted/20 text-xs">
                        {canEdit && <td />}
                        <td className="p-2 pl-7"><button className="font-semibold hover:underline" onClick={() => onOpenPo(l.po_id)}>{l.po_number}</button> · {l.company_name}</td>
                        <td className="p-2 text-right">{formatQty(l.needed)}</td>
                        <td className="hidden p-2 text-right sm:table-cell" />
                        <td className="hidden p-2 text-muted-foreground md:table-cell">{l.expected_dispatch_date ? `due ${formatDate(l.expected_dispatch_date)}` : "no due date"}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="p-4">
          <DataTable
            title="Procurement orders"
            data={orders}
            pageSize={15}
            getRowKey={(o) => o.id}
            columns={[
              { label: "Order", render: (o) => <button className="font-semibold hover:underline" onClick={() => setOrderId(o.id)}>{o.number}</button> },
              { label: "Supplier", render: (o) => o.supplier },
              { label: "Items", render: (o) => <span className="text-xs">{o.item_codes.join(", ")}</span>, className: "hidden md:table-cell" },
              { label: "Received", render: (o) => `${formatQty(o.qty_received)} / ${formatQty(o.qty_ordered)}`, className: "hidden sm:table-cell" },
              { label: "Stage", render: (o) => (o.stage ? <StageBadge stage={o.stage} /> : "—") },
              { label: "Status", render: (o) => <span className={cn("text-xs capitalize", STATUS_TONE[o.status])}>{o.status}</span> },
              { label: "Expected", render: (o) => formatDate(o.expected_date), className: "hidden lg:table-cell" },
            ]}
          />
        </Card>
      )}

      {creating && (
        <CreateOrder
          items={short.filter((g) => picked.has(g.item_code))}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setPicked(new Set()); setView("orders"); reload(); setOrderId(id); }}
        />
      )}
      <OrderSheet id={orderId} canEdit={canEdit} onClose={() => setOrderId(null)} onChanged={reload} onOpenPo={(id) => { setOrderId(null); onOpenPo(id); }} />
    </div>
  );
}

type Row = { item_code: string | null; qty: string; unit_cost: string; currency: string; lines: ShortLine[] };

// Draft order from the picked shortfall items (qty defaults to what POs need; anything above it is for LS
// stock), plus any item added just for LS stock.
function CreateOrder({ items, onClose, onCreated }: { items: Short[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [supplier, setSupplier] = useState(items.find((i) => i.supplier)?.supplier || "");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() => items.map((g) => ({ item_code: g.item_code, qty: String(g.needed), unit_cost: "", currency: "USD", lines: g.lines })));
  const [catalog, setCatalog] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ item_code: string; description: string | null }[]>("/api/po/items").then((r) => setCatalog(r.map((i) => ({ value: i.item_code, label: i.description ? `${i.item_code} — ${i.description}` : i.item_code })))).catch(() => {});
  }, []);
  const set = (i: number, patch: Partial<Row>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ id: number; number: string }>("/api/procurement", {
        method: "POST",
        body: {
          supplier, expected_date: expected || null, notes,
          items: rows.filter((r) => r.item_code).map((r) => {
            // Customers first, earliest due first; whatever is left is for LS stock.
            let left = Number(r.qty) || 0;
            const allocations = r.lines.map((l) => { const q = Math.min(l.needed, left); left -= q; return { po_item_id: l.po_item_id, qty: q }; }).filter((a) => a.qty > 0);
            return { item_code: r.item_code, qty: Number(r.qty), unit_cost: r.unit_cost, currency: r.currency, allocations };
          }),
        },
      });
      showToast(`${r.number} created as a draft`, "success");
      onCreated(r.id);
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>New procurement order</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Supplier</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Expected arrival</Label><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
          </div>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {rows.map((r, i) => {
              const forPo = r.lines.reduce((s, l) => s + l.needed, 0);
              const extra = (Number(r.qty) || 0) - forPo;
              return (
                <div key={i} className="space-y-1.5 rounded-md border p-2.5">
                  <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_100px_90px_70px_auto]">
                    <div className="col-span-2 sm:col-span-1">
                      {r.lines.length ? <div className="text-sm font-semibold">{r.item_code}</div>
                        : <SearchPicker options={catalog} value={r.item_code} onChange={(v) => set(i, { item_code: v })} placeholder="Item for LS stock" searchPlaceholder="Search items…" />}
                    </div>
                    <Input type="number" min={1} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantity" placeholder="Qty" />
                    <Input type="number" step="0.0001" min={0} value={r.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} aria-label="Unit cost" placeholder="Unit cost" />
                    <Input value={r.currency} onChange={(e) => set(i, { currency: e.target.value.toUpperCase() })} aria-label="Currency" />
                    <Button variant="ghost" size="icon" title="Remove" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.lines.length ? <>For {r.lines.map((l) => `${l.po_number} (${formatQty(l.needed)})`).join(", ")}</> : "For LS stock"}
                    {r.lines.length > 0 && extra > 0 && <> · <span className="font-semibold text-foreground">{formatQty(extra)} extra for LS stock</span></>}
                    {r.lines.length > 0 && extra < 0 && <> · <span className="text-warning">{formatQty(-extra)} short — earliest-due POs are served first</span></>}
                  </div>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setRows((s) => [...s, { item_code: null, qty: "", unit_cost: "", currency: "USD", lines: [] }])}>+ Add item for LS stock</Button>
          </div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !supplier.trim() || !rows.some((r) => r.item_code && Number(r.qty) > 0)} onClick={submit}>{busy ? "Creating…" : "Create draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderSheet({ id, canEdit, onClose, onChanged, onOpenPo }: { id: number | null; canEdit: boolean; onClose: () => void; onChanged: () => void; onOpenPo: (id: number) => void }) {
  const [o, setO] = useState<Order | null>(null);
  const [head, setHead] = useState({ supplier: "", expected_date: "", notes: "" });
  const [qty, setQty] = useState<Record<number, string>>({});
  const load = useCallback(async (oid: number) => {
    try {
      const d = await api<Order>(`/api/procurement/${oid}`);
      setO(d);
      setHead({ supplier: d.supplier || "", expected_date: d.expected_date || "", notes: d.notes || "" });
      setQty(Object.fromEntries(d.items.map((i) => [i.id, String(i.qty_ordered)])));
    } catch {
      onClose();
    }
  }, [onClose]);
  useEffect(() => {
    if (id == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setO(null);
    load(id);
  }, [id, load]);

  const editable = canEdit && !!o && !["closed", "cancelled"].includes(o.status);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); showToast(msg, "success"); if (o) load(o.id); onChanged(); } catch { /* api() already toasted */ }
  };
  const save = (status?: string) => run(() => api(`/api/procurement/${o!.id}`, { method: "PUT", body: { ...head, ...(status ? { status } : {}), items: o!.items.map((i) => ({ id: i.id, qty_ordered: Number(qty[i.id]) })) } }), status === "ordered" ? "Marked as ordered" : "Saved");
  const stage = (itemId: number, s: string) => run(() => api(`/api/procurement/${o!.id}/items/${itemId}/stage`, { method: "PUT", body: { stage: s } }), `Stage set to ${s}`);
  const cancel = async () => { if (await askConfirm({ title: "Cancel this procurement order?", description: "The customer POs waiting on it go back to 'Not planned'.", confirmLabel: "Cancel order", destructive: true })) run(() => api(`/api/procurement/${o!.id}/cancel`, { method: "POST", body: {} }), "Order cancelled"); };
  const total = useMemo(() => o?.items.reduce((s, i) => s + (i.unit_cost || 0) * i.qty_ordered, 0) || 0, [o]);

  return (
    <Sheet open={id != null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>{o ? `${o.number} · ${o.supplier}` : "Procurement order"}</SheetTitle>
          <SheetDescription>{o ? <span className={cn("capitalize", STATUS_TONE[o.status])}>{o.status}</span> : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {o && (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Supplier</Label><Input value={head.supplier} disabled={!editable} onChange={(e) => setHead({ ...head, supplier: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Expected arrival</Label><Input type="date" value={head.expected_date} disabled={!editable} onChange={(e) => setHead({ ...head, expected_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Notes</Label><Input value={head.notes} disabled={!editable} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></div>

              {o.items.map((it) => (
                <div key={it.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{it.item_code}</div>
                      {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                    </div>
                    {editable && it.stage !== "Received" ? (
                      <select value={it.stage} onChange={(e) => stage(it.id, e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" aria-label={`Stage for ${it.item_code}`}>
                        {PROC_STAGES.slice(0, -1).map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : <StageBadge stage={it.stage} />}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label className="space-y-1"><span className="text-muted-foreground">Ordered</span>
                      <Input type="number" min={1} className="h-8" value={qty[it.id] ?? ""} disabled={!editable} onChange={(e) => setQty((q) => ({ ...q, [it.id]: e.target.value }))} />
                    </label>
                    <div className="space-y-1"><span className="text-muted-foreground">Received</span><div className="pt-1.5 font-semibold">{formatQty(it.qty_received)}</div></div>
                    <div className="space-y-1"><span className="text-muted-foreground">Unit cost</span><div className="pt-1.5">{it.unit_cost != null ? `${it.unit_cost} ${it.currency || ""}` : "—"}</div></div>
                  </div>
                  <div className="space-y-1 text-xs">
                    {it.allocations.filter((a) => a.qty > 0).map((a) => (
                      <div key={a.id} className="flex justify-between text-muted-foreground">
                        <span><button className="font-semibold text-foreground hover:underline" onClick={() => onOpenPo(a.po_id)}>{a.po_number}</button> · {a.company_name}{a.expected_dispatch_date ? ` · due ${formatDate(a.expected_dispatch_date)}` : ""}</span>
                        <span>{formatQty(a.qty)} awaited</span>
                      </div>
                    ))}
                    {it.for_ls_stock > 0 && <div className="flex justify-between text-muted-foreground"><span>For LS stock</span><span>{formatQty(it.for_ls_stock)}</span></div>}
                  </div>
                </div>
              ))}
              {total > 0 && <div className="text-right text-xs text-muted-foreground">Order value {total.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {o.items[0]?.currency || ""}</div>}
              <p className="text-[11px] text-muted-foreground">Receive goods on Inward → &quot;Against procurement order&quot;; they are reserved to the waiting POs, earliest due first.</p>
            </>
          )}
        </div>
        {editable && o && (
          <div className="flex gap-2 border-t p-3">
            {!o.items.some((i) => i.qty_received > 0) && <Button variant="outline" className="text-destructive" onClick={cancel}>Cancel order</Button>}
            <Button variant="outline" className="flex-1" onClick={() => save()}>Save</Button>
            {o.status === "draft" && <Button className="flex-1" onClick={() => save("ordered")}>Mark ordered</Button>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
