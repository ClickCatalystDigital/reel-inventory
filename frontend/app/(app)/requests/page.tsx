"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
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

const TYPE_LABEL: Record<ReqType, string> = { inward: "📥 Inward", transfer: "🔄 Transfer", outward: "📤 Outward" };
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

  const matchesStore = (r: RequestItem) =>
    selectedStore === "all" ||
    r.payload.store_code === selectedStore ||
    r.payload.from_store === selectedStore ||
    r.payload.to_store === selectedStore;

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
  const storeTag = p.store_code ? ` | Store: ${p.store_code}` : "";

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
    const reason = window.prompt("Reject reason (optional):");
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
      <div className="mb-2.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          <strong>#{r.id}</strong>
        </span>
        <span>{TYPE_LABEL[r.type]}</span>
        <span>
          By <strong>{r.created_by}</strong>
        </span>
        <span>{formatDateTime(r.created_at)}</span>
        {!isPending && (
          <span>
            Reviewed by <strong>{r.reviewed_by}</strong> · {formatDateTime(r.reviewed_at)}
          </span>
        )}
      </div>

      <div className="mb-2.5 rounded border border-border bg-background px-3 py-2 text-xs">
        {r.type === "inward" && (
          <>
            <strong>Item:</strong> {p.item_code} | <strong>Reels:</strong> {p.num_reels} | <strong>Boxes:</strong>{" "}
            {p.num_boxes || 0} | <strong>Notes:</strong> {p.notes || "—"}
            {storeTag}
          </>
        )}
        {r.type === "transfer" && (
          <>
            <strong>{p.kind === "box" ? "Box" : "Reel"}:</strong> {p.number} | <strong>From Store:</strong>{" "}
            {p.from_store || "—"} | <strong>To Store:</strong> {p.to_store} | <strong>Notes:</strong> {p.notes || "—"}
          </>
        )}
        {r.type === "outward" && (() => {
          const reels = p.reel_numbers || (p.reel_number ? [p.reel_number] : []);
          return (
            <>
              <strong>Item:</strong> {p.item_code || "—"} | <strong>Customer:</strong> {p.customer_name} |{" "}
              <strong>Invoice:</strong> {p.invoice_number} | <strong>Reels ({reels.length}):</strong>{" "}
              {reels.map((rn) => rn.replace("REEL-", "")).join(", ")} | <strong>Notes:</strong> {p.notes || "—"}
              {storeTag}
            </>
          );
        })()}
      </div>

      {r.reject_reason && <div className="mb-1.5 text-xs text-destructive">Reason: {r.reject_reason}</div>}

      {isPending && (r.type === "inward" || r.type === "outward") && editing && (
        <EditFields request={r} onCancel={() => setEditing(false)} onSaved={onChanged} />
      )}

      {isPending && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="text-success" onClick={approve}>
            ✓ Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            ✏️ Edit &amp; Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={reject}>
            ✕ Reject
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
            <Label>Reels — uncheck to remove from this approval</Label>
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
          Approve {r.type === "inward" ? "Edited" : "Selected"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
