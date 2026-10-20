"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check, Clock, Pencil, User, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { askText } from "@/components/layout/AskDialog";
import { formatDateTime } from "@/lib/format";
import { useSelectedStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ReqStatus = "pending" | "approved" | "rejected";
type ReqType = "inward" | "outward" | "transfer";

interface RequestPayload {
  store_code?: string;
  item_code?: string;
  num_reels?: number;
  num_boxes?: number;
  notes?: string | null;
  kind?: "reel" | "box";
  number?: string;
  from_store?: string;
  to_store?: string;
  customer_name?: string;
  invoice_number?: string;
  reel_numbers?: string[];
  reel_number?: string;
}

interface RequestItem {
  id: number;
  type: ReqType;
  created_by: string;
  created_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  reject_reason?: string;
  payload: RequestPayload;
}

const TYPE_META: Record<ReqType, { label: string; icon: LucideIcon }> = {
  inward: { label: "Inward", icon: ArrowDownToLine },
  transfer: { label: "Transfer", icon: ArrowLeftRight },
  outward: { label: "Outward", icon: ArrowUpFromLine },
};

// One label/value cell of a request's details grid.
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3" : undefined}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{children}</div>
    </div>
  );
}
const BORDER_CLASS: Record<ReqStatus, string> = {
  pending: "border-l-warning",
  approved: "border-l-success",
  rejected: "border-l-destructive",
};

export default function RequestsPage() {
  const { selectedStore } = useSelectedStore();
  const [tab, setTab] = useState<ReqStatus>("pending");
  const [requests, setRequests] = useState<RequestItem[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState(false);

  async function loadRequests(status: ReqStatus) {
    setRequests(null);
    setError(false);
    try {
      const list = await api<RequestItem[]>(`/api/requests?status=${status}`);
      setRequests(list);
    } catch {
      setError(true);
    }
  }

  const matchesStore = (r: RequestItem) => {
    const { store_code, from_store, to_store } = r.payload;
    // A request whose payload never recorded a store (older submissions, before
    // routes/transfer.js started writing from_store) can't be known to NOT match
    // the selected store — hide it only for a store it's actually tagged with.
    if (!store_code && !from_store && !to_store) return true;
    return selectedStore === "all" || store_code === selectedStore || from_store === selectedStore || to_store === selectedStore;
  };

  const visibleRequests = requests?.filter(matchesStore) ?? null;

  useEffect(() => {
    // Data fetch reacting to the active tab — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRequests(tab);
  }, [tab]);

  useEffect(() => {
    // Pending badge tracks the store-filtered count, not the raw fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "pending" && requests) setPendingCount(requests.filter(matchesStore).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, requests, selectedStore]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Approval Requests</h1>
        <p className="text-sm text-muted-foreground">Review, approve, or reject pending inward and outward requests</p>
      </div>

      <Card className="p-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReqStatus)}>
          <TabsList>
            <TabsTrigger value="pending">
              Pending
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1.5">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4">
          {error ? (
            <div className="py-8 text-center text-destructive">Failed to load requests</div>
          ) : visibleRequests === null ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : visibleRequests.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No {tab} requests</div>
          ) : (
            visibleRequests.map((r) => (
              <RequestCard key={r.id} request={r} status={tab} onChanged={() => loadRequests(tab)} />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function RequestCard({
  request: r,
  status,
  onChanged,
}: {
  request: RequestItem;
  status: ReqStatus;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const p = r.payload;
  const isPending = status === "pending";
  const Type = TYPE_META[r.type];

  async function approve() {
    try {
      await api(`/api/requests/${r.id}/approve`, { method: "POST" });
      showToast(`Request #${r.id} approved`);
      onChanged();
    } catch {
      // api() already toasted
    }
  }

  async function reject() {
    const reason = await askText({ title: `Reject request #${r.id}?`, inputLabel: "Reason (optional)", placeholder: "Shown to the person who sent it", confirmLabel: "Reject", destructive: true });
    if (reason === null) return;
    try {
      await api(`/api/requests/${r.id}/reject`, { method: "POST", body: { reject_reason: reason } });
      showToast(`Request #${r.id} rejected`);
      onChanged();
    } catch {
      // api() already toasted
    }
  }

  return (
    <div className={cn("mb-3 rounded-md border border-l-[3px] border-border bg-card p-4", BORDER_CLASS[status])}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
          <Type.icon className="size-3.5" /> {Type.label} <span className="text-muted-foreground">#{r.id}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <User className="size-3.5" /> <strong className="text-foreground">{r.created_by}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" /> {formatDateTime(r.created_at)}
        </span>
        {!isPending && (
          <span>
            Reviewed by <strong>{r.reviewed_by}</strong> · {formatDateTime(r.reviewed_at)}
          </span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-sm sm:grid-cols-3">
        {r.type === "inward" && (
          <>
            <Field label="Item">{p.item_code}</Field>
            <Field label="Reels">{p.num_reels}</Field>
            <Field label="Boxes">{p.num_boxes || 0}</Field>
            {p.store_code && <Field label="Store">{p.store_code}</Field>}
          </>
        )}
        {r.type === "transfer" && (
          <>
            <Field label={p.kind === "box" ? "Box" : "Reel"}>{p.number}</Field>
            <Field label="From store">{p.from_store || "—"}</Field>
            <Field label="To store">{p.to_store}</Field>
          </>
        )}
        {r.type === "outward" && (() => {
          const reels = p.reel_numbers || (p.reel_number ? [p.reel_number] : []);
          return (
            <>
              <Field label="Item">{p.item_code || "—"}</Field>
              <Field label="Customer">{p.customer_name}</Field>
              <Field label="Invoice">{p.invoice_number}</Field>
              {p.store_code && <Field label="Store">{p.store_code}</Field>}
              <Field label={`Reels (${reels.length})`} wide={!p.store_code}>{reels.map((rn) => rn.replace("REEL-", "")).join(", ")}</Field>
            </>
          );
        })()}
        {p.notes && <Field label="Notes" wide>{p.notes}</Field>}
      </div>

      {r.reject_reason && <div className="mb-1.5 text-xs text-destructive">Reason: {r.reject_reason}</div>}

      {isPending && (r.type === "inward" || r.type === "outward") && editing && (
        <EditFields request={r} onCancel={() => setEditing(false)} onSaved={onChanged} />
      )}

      {isPending && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="text-success" onClick={approve}>
            <Check /> Approve
          </Button>
          {(r.type === "inward" || r.type === "outward") && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> Edit &amp; Approve
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={reject}>
            <X /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function EditFields({
  request: r,
  onCancel,
  onSaved,
}: {
  request: RequestItem;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const p = r.payload;
  const [itemCode, setItemCode] = useState(p.item_code || "");
  const [numReels, setNumReels] = useState(String(p.num_reels || ""));
  const [numBoxes, setNumBoxes] = useState(String(p.num_boxes || 0));
  const [customer, setCustomer] = useState(p.customer_name || "");
  const [invoice, setInvoice] = useState(p.invoice_number || "");
  const [notes, setNotes] = useState(p.notes || "");
  const reels = p.reel_numbers || (p.reel_number ? [p.reel_number] : []);
  const [checked, setChecked] = useState<Record<string, boolean>>(Object.fromEntries(reels.map((rn) => [rn, true])));

  async function editApprove() {
    let payload: Record<string, unknown>;
    if (r.type === "inward") {
      const code = itemCode.trim().toUpperCase();
      const reels = parseInt(numReels);
      if (!code || !reels) return showToast("Item code and reels are required", "error");
      payload = { item_code: code, num_reels: reels, num_boxes: parseInt(numBoxes) || 0, notes: notes.trim() || null };
    } else {
      const selected = reels.filter((rn) => checked[rn]);
      if (!selected.length) return showToast("Select at least one reel to approve", "error");
      const cust = customer.trim();
      const inv = invoice.trim();
      if (!cust || !inv) return showToast("Customer and invoice are required", "error");
      payload = {
        item_code: p.item_code,
        customer_name: cust,
        invoice_number: inv,
        reel_numbers: selected,
        outward_type: "Full",
        notes: notes.trim() || null,
      };
    }
    try {
      await api(`/api/requests/${r.id}/edit-approve`, { method: "POST", body: { payload } });
      showToast(`Request #${r.id} edited and approved`);
      onSaved();
    } catch {
      // api() already toasted
    }
  }

  return (
    <div className="mt-2.5 space-y-3">
      {r.type === "inward" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Item Code</Label>
            <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Number of Reels</Label>
            <Input type="number" min={1} value={numReels} onChange={(e) => setNumReels(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Num Boxes</Label>
            <Input type="number" min={0} value={numBoxes} onChange={(e) => setNumBoxes(e.target.value)} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice</Label>
              <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Label>Reels — uncheck to remove from this approval</Label>
              <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => setChecked(Object.fromEntries(reels.map((rn) => [rn, true])))}>All</button>
              <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => setChecked({})}>None</button>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              {reels.map((rn) => (
                <label key={rn} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!!checked[rn]}
                    onChange={(e) => setChecked((c) => ({ ...c, [rn]: e.target.checked }))}
                  />
                  {rn.replace("REEL-", "")}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-success" onClick={editApprove}>
          <Check /> Approve {r.type === "inward" ? "Edited" : "Selected"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
