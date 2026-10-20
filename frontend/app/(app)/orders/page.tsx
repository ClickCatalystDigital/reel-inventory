"use client";

import { askConfirm } from "@/components/layout/AskDialog";
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table/DataTable";
import { SearchPicker } from "@/components/SearchPicker";
import { PoSheet } from "@/components/orders/PoSheet";
import { StageBadge } from "@/components/orders/StageSelect";
import { ProcurementTab } from "@/components/orders/ProcurementTab";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isApproverRole } from "@/lib/crm";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { LINE_STATUSES, type PoDetail } from "@/lib/po-stages";

interface PoRow {
  id: number; po_number: string; status: string; order_date: string | null; expected_dispatch_date: string | null;
  company_name: string | null; stage: string; qty_ordered: number; qty_dispatched: number; qty_reserved: number; qty_needed: number; doc_count: number;
}
interface LotRow {
  id: number; po_id: number; po_number: string; company_name: string | null; item_code: string; description: string | null;
  quantity: number; dispatch_date: string | null; notes: string | null; stage: string | null; updated_at: string; updated_by: string;
}
type LotForm = { id?: number; po_id: number | null; item_code: string | null; quantity: string; dispatch_date: string; notes: string };
const EMPTY_LOT: LotForm = { po_id: null, item_code: null, quantity: "", dispatch_date: "", notes: "" };

export default function OrdersPage() {
  const { user } = useAuth();
  const canEdit = isApproverRole(user?.role);
  const [pos, setPos] = useState<PoRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [openPo, setOpenPo] = useState<number | null>(null);
  const [lot, setLot] = useState<LotForm | null>(null);
  const [lotLines, setLotLines] = useState<{ item_code: string; quantity_ordered: number }[]>([]);
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      const [p, l] = await Promise.all([api<PoRow[]>("/api/orders"), api<LotRow[]>("/api/orders/dispatches")]);
      setPos(p);
      setLots(l);
    } catch {
      // api() already toasted
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, []);

  // Item choices follow the picked PO.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!lot?.po_id) return setLotLines([]);
    api<PoDetail>(`/api/orders/${lot.po_id}`).then((d) => setLotLines(d.lines.filter((l): l is typeof l & { item_code: string } => !!l.item_code))).catch(() => setLotLines([]));
  }, [lot?.po_id]);

  const shownPos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pos.filter(
      (p) =>
        (stageFilter === "all" || p.stage === stageFilter) &&
        (!t || p.po_number.toLowerCase().includes(t) || (p.company_name ?? "").toLowerCase().includes(t))
    );
  }, [pos, q, stageFilter]);

  async function saveLot() {
    if (!lot) return;
    setSaving(true);
    try {
      const body = { po_id: lot.po_id, item_code: lot.item_code, quantity: Number(lot.quantity), dispatch_date: lot.dispatch_date || null, notes: lot.notes };
      await api(lot.id ? `/api/orders/dispatches/${lot.id}` : "/api/orders/dispatches", { method: lot.id ? "PUT" : "POST", body });
      showToast(lot.id ? "Dispatch updated" : "Dispatch added", "success");
      setLot(null);
      reload();
    } catch {
      // api() already toasted
    } finally {
      setSaving(false);
    }
  }

  async function deleteLot(id: number) {
    if (!(await askConfirm({ title: "Delete this dispatch row?", confirmLabel: "Delete", destructive: true }))) return;
    try {
      await api(`/api/orders/dispatches/${id}`, { method: "DELETE" });
      reload();
    } catch {
      // api() already toasted
    }
  }

  const poLink = (id: number, number: string) => (
    <button className="font-semibold underline-offset-2 hover:underline" onClick={() => setOpenPo(id)}>
      {number}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="text-sm text-muted-foreground">Production stage and dispatch lots per customer PO — customers see these on their portal</p>
      </div>

      <Tabs defaultValue="pos">
        <TabsList>
          <TabsTrigger value="pos">POs</TabsTrigger>
          <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
          <TabsTrigger value="procurement">Procurement</TabsTrigger>
        </TabsList>

        <TabsContent value="pos">
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Search PO or customer" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                aria-label="Filter by stage"
              >
                <option value="all">All stages</option>
                {LINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <DataTable
              title="Purchase orders"
              data={shownPos}
              getRowKey={(p) => p.id}
              pageSize={20}
              columns={[
                { label: "PO", render: (p) => poLink(p.id, p.po_number) },
                { label: "Customer", render: (p) => p.company_name ?? "—" },
                { label: "Ordered", render: (p) => formatDate(p.order_date), className: "hidden md:table-cell" },
                { label: "Due", render: (p) => formatDate(p.expected_dispatch_date), className: "hidden md:table-cell" },
                { label: "CRM", render: (p) => <Badge variant="outline">{p.status}</Badge>, className: "hidden lg:table-cell" },
                { label: "Status", render: (p) => <StageBadge stage={p.stage} /> },
                { label: "Needed", render: (p) => (p.qty_needed ? <span className="font-semibold text-warning">{formatQty(p.qty_needed)}</span> : "—"), className: "hidden md:table-cell" },
                { label: "Dispatched", render: (p) => `${formatQty(p.qty_dispatched)} / ${formatQty(p.qty_ordered)}`, className: "hidden sm:table-cell" },
                { label: "Docs", render: (p) => p.doc_count || "—", className: "hidden sm:table-cell" },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="dispatch">
          <Card className="space-y-3 p-4">
            {canEdit && (
              <div>
                <Button size="sm" onClick={() => setLot(EMPTY_LOT)}>
                  <Plus className="size-4" /> Add dispatch
                </Button>
              </div>
            )}
            <DataTable
              title="Dispatch lots"
              data={lots}
              getRowKey={(d) => d.id}
              pageSize={20}
              columns={[
                { label: "Last Updated", render: (d) => formatDateTime(d.updated_at), className: "hidden md:table-cell" },
                { label: "Item", render: (d) => <strong>{d.item_code}</strong> },
                { label: "Qty", render: (d) => formatQty(d.quantity) },
                { label: "PO", render: (d) => poLink(d.po_id, d.po_number) },
                { label: "Status", render: (d) => <StageBadge stage={d.stage ?? "Not planned"} /> },
                { label: "Dispatch Date", render: (d) => (d.dispatch_date ? formatDate(d.dispatch_date) : "—") },
                ...(canEdit
                  ? [{
                      label: "",
                      render: (d: LotRow) => (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => setLot({ id: d.id, po_id: d.po_id, item_code: d.item_code, quantity: String(d.quantity), dispatch_date: d.dispatch_date ?? "", notes: d.notes ?? "" })}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteLot(d.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ),
                    }]
                  : []),
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="procurement">
          <ProcurementTab canEdit={canEdit} onOpenPo={setOpenPo} />
        </TabsContent>
      </Tabs>

      <Dialog open={lot != null} onOpenChange={(o) => !o && setLot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lot?.id ? "Edit dispatch" : "Add dispatch"}</DialogTitle>
          </DialogHeader>
          {lot && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">PO</Label>
                <SearchPicker
                  options={pos.map((p) => ({ value: p.id, label: `${p.po_number} — ${p.company_name ?? ""}` }))}
                  value={lot.po_id}
                  onChange={(v) => setLot({ ...lot, po_id: v, item_code: null })}
                  placeholder="Pick a PO"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Item</Label>
                <SearchPicker
                  options={lotLines.map((l) => ({ value: l.item_code, label: `${l.item_code} (ordered ${formatQty(l.quantity_ordered)})` }))}
                  value={lot.item_code}
                  onChange={(v) => setLot({ ...lot, item_code: v })}
                  placeholder={lot.po_id ? "Pick an item on this PO" : "Pick a PO first"}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Qty</Label>
                  <Input type="number" min={1} value={lot.quantity} onChange={(e) => setLot({ ...lot, quantity: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Dispatch date</Label>
                  <Input type="date" value={lot.dispatch_date} onChange={(e) => setLot({ ...lot, dispatch_date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Input value={lot.notes} onChange={(e) => setLot({ ...lot, notes: e.target.value })} placeholder="Optional — e.g. lot 2 of 3, courier" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLot(null)}>Cancel</Button>
            <Button onClick={saveLot} disabled={saving || !lot?.po_id || !lot?.item_code || !lot?.quantity}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PoSheet poId={openPo} canEdit={canEdit} onClose={() => setOpenPo(null)} onChanged={reload} />
    </div>
  );
}
