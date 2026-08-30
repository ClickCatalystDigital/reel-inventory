"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty, formatDateTime } from "@/lib/format";
import { useSelectedStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table/DataTable";

interface Store {
  code: string;
  name: string;
}

interface ReelLookupData {
  reel_number: string;
  item_code: string;
  quantity: number;
  store_code: string;
}

interface BoxLookupData {
  box: { box_number: string; store_code: string };
  reels: { reel_number: string }[];
}

type Lookup =
  | { kind: "reel"; number: string; actual_store: string; data: ReelLookupData }
  | { kind: "box"; number: string; actual_store: string; data: BoxLookupData };

interface Transfer {
  id: number;
  reel_number: string | null;
  box_number: string | null;
  from_store: string;
  to_store: string;
  quantity: number;
  transferred_by: string;
  transferred_at: string;
  notes: string | null;
}

export default function TransferPage() {
  const { selectedStore } = useSelectedStore();
  const [stores, setStores] = useState<Store[]>([]);
  const [fromStore, setFromStore] = useState("");
  const [toStore, setToStore] = useState("");
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeLabel = (code: string) => stores.find((s) => s.code === code)?.name || code;

  useEffect(() => {
    (async () => {
      try {
        const list = await api<Store[]>("/api/stores");
        setStores(list);
        const preferred = selectedStore !== "all" ? selectedStore : "primary";
        setFromStore(preferred);
      } catch {
        // api() already toasted
      }
    })();
    loadRecentTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changing From Store clears a To Store that's no longer valid — handled in
  // the select's own onChange (see below) rather than a separate effect
  // watching both, per React's guidance on adjusting state in the event that
  // causes the change instead of reactively.
  function onFromStoreChange(value: string) {
    setFromStore(value);
    if (toStore === value) setToStore("");
  }

  async function lookupNumber(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!value) {
      setLookup(null);
      return;
    }
    try {
      if (value.startsWith("BOX")) {
        const data = await api<BoxLookupData>(`/api/transfer/box/${value}`);
        setLookup({ kind: "box", number: data.box.box_number, actual_store: data.box.store_code, data });
      } else {
        const reelNumber = value.startsWith("REEL") ? value : `REEL-${value}`;
        const data = await api<ReelLookupData>(`/api/transfer/reel/${reelNumber}`);
        setLookup({ kind: "reel", number: data.reel_number, actual_store: data.store_code, data });
      }
    } catch {
      setLookup(null);
    }
  }

  function onNumberChange(value: string) {
    setNumber(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => lookupNumber(value), 400);
  }

  function onNumberKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      lookupNumber(number);
    }
  }

  const mismatched = !!lookup && lookup.actual_store !== fromStore;
  const canSubmit = !!lookup && !!toStore && toStore !== fromStore && !mismatched;

  async function loadRecentTransfers() {
    try {
      const { rows } = await api<{ rows: Transfer[] }>("/api/transfer/recent?limit=50");
      setTransfers(rows);
    } catch {
      // api() already toasted
    }
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!lookup) return showToast("Look up a valid reel or box first", "error");
    if (lookup.actual_store !== fromStore)
      return showToast("Selected From Store does not match the item's actual store", "error");
    if (toStore === fromStore) return showToast("Source and destination store cannot be the same", "error");

    setSubmitting(true);
    try {
      const result = await api<{ message: string }>("/api/transfer", {
        method: "POST",
        body: { kind: lookup.kind, number: lookup.number, to_store: toStore, notes: notes.trim() || undefined },
      });
      showToast(result.message);
      setNumber("");
      setNotes("");
      setLookup(null);
      loadRecentTransfers();
    } catch {
      // api() already toasted
    } finally {
      setSubmitting(false);
    }
  }

  async function undoLastTransfer() {
    const id = window.prompt("Enter the Transfer ID to undo (see Recent Transfers table):");
    if (!id) return;
    const password = window.prompt("Enter password to confirm undo:");
    if (!password) return;
    try {
      const result = await api<{ message: string }>("/api/transfer/undo", {
        method: "POST",
        body: { transfer_id: parseInt(id), password },
      });
      showToast(result.message);
      loadRecentTransfers();
    } catch {
      // api() already toasted
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Stock Transfer</h1>
        <p className="text-sm text-muted-foreground">Move reels or boxes between stores</p>
      </div>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transfer Stock</div>
        <form onSubmit={submitTransfer} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>From Store</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={fromStore}
                onChange={(e) => onFromStoreChange(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>To Store</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={toStore}
                onChange={(e) => setToStore(e.target.value)}
              >
                <option value="">Select...</option>
                {stores
                  .filter((s) => s.code !== fromStore)
                  .map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reel / Box Number</Label>
            <Input
              autoFocus
              placeholder="Scan or type REEL-##### or BOX-####"
              value={number}
              onChange={(e) => onNumberChange(e.target.value)}
              onKeyDown={onNumberKeyDown}
            />
            {lookup && (
              <div
                className={
                  mismatched
                    ? "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    : "rounded-md border border-border bg-secondary p-3 text-sm"
                }
              >
                {mismatched ? (
                  <>
                    This {lookup.kind} is currently at <strong>{storeLabel(lookup.actual_store)}</strong>, not{" "}
                    {storeLabel(fromStore)}. Select the correct From Store, or re-check the number.
                  </>
                ) : lookup.kind === "reel" ? (
                  <>
                    <strong>{lookup.data.reel_number}</strong> — {lookup.data.item_code} ·{" "}
                    {formatQty(lookup.data.quantity)} pcs · currently at{" "}
                    <strong>{storeLabel(lookup.actual_store)}</strong>
                  </>
                ) : (
                  <>
                    <strong>{lookup.data.box.box_number}</strong> — {lookup.data.reels.length} reel(s) · currently at{" "}
                    <strong>{storeLabel(lookup.actual_store)}</strong>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input placeholder="e.g. Rebalancing stock" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit || submitting}>
            Transfer
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <DataTable
          title="Recent Transfers"
          data={transfers}
          getRowKey={(t) => t.id}
          columns={[
            { label: "Item", render: (t) => <strong>{t.reel_number || t.box_number}</strong> },
            { label: "From", render: (t) => storeLabel(t.from_store) },
            { label: "To", render: (t) => storeLabel(t.to_store) },
            { label: "Qty", render: (t) => formatQty(t.quantity) },
            { label: "By", render: (t) => t.transferred_by },
            { label: "Date", render: (t) => formatDateTime(t.transferred_at) },
            { label: "Notes", render: (t) => t.notes || "—" },
          ]}
        />
        <div className="mt-3">
          <Button variant="destructive" size="sm" onClick={undoLastTransfer}>
            Undo a Transfer
          </Button>
        </div>
      </Card>
    </div>
  );
}
