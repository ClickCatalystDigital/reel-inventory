"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, PenLine } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty, formatDateTime } from "@/lib/format";
import { useSelectedStore } from "@/lib/store-context";
import { playSuccessSound, playErrorSound } from "@/lib/scan-sound";
import { useQrScanner } from "@/hooks/use-qr-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table/DataTable";
import { Fab } from "@/components/layout/Fab";
import { cn } from "@/lib/utils";

interface Store {
  code: string;
  name: string;
}
interface CartItem {
  reel_number: string;
  item_code: string;
  quantity: number;
  box_number: string | null;
}
interface Skipped {
  reel_number: string;
  reason: string;
}
interface ReelLookup {
  reel_number: string;
  item_code: string;
  quantity: number;
  store_code: string;
  box_number: string | null;
}
interface BoxLookup {
  box: { box_number: string; store_code: string };
  reels: { reel_number: string; item_code: string; quantity: number; store_code: string; status: string }[];
}
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
  const [notes, setNotes] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [boxTotals, setBoxTotals] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const scanInputRef = useRef<HTMLInputElement>(null);

  const scanner = useQrScanner("reader", (text) => {
    setScanInput(text);
    void addToCart(text);
  }, (msg) => showToast(msg, "error"));

  const storeLabel = (code: string) => stores.find((s) => s.code === code)?.name || code;

  // One-time setup — store list + default From Store + recent transfers.
  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    (async () => {
      try {
        const list = await api<Store[]>("/api/stores");
        setStores(list);
        setFromStore(selectedStore !== "all" ? selectedStore : "primary");
      } catch {
        // api() already toasted
      }
    })();
    loadRecentTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRecentTransfers() {
    try {
      const { rows } = await api<{ rows: Transfer[] }>("/api/transfer/recent?limit=50");
      setTransfers(rows);
    } catch {
      // api() already toasted
    }
  }

  // Changing From Store invalidates every eligibility check the current cart was
  // built against — clearing it is the simplest, unambiguous response (same
  // reset-on-context-switch spirit as Outward's clearCart()), rather than trying
  // to reason about which entries might still happen to be valid.
  function onFromStoreChange(value: string) {
    if (cart.length > 0 || skipped.length > 0) {
      showToast("From Store changed — cart cleared");
    }
    setCart([]);
    setSkipped([]);
    setBoxTotals({});
    setFromStore(value);
    if (toStore === value) setToStore("");
  }

  async function ensureBoxTotal(boxNumber: string) {
    if (boxTotals[boxNumber] !== undefined) return;
    try {
      const data = await api<BoxLookup>(`/api/transfer/box/${boxNumber}`);
      const total = data.reels.filter((r) => r.status === "In Stock").length;
      setBoxTotals((prev) => ({ ...prev, [boxNumber]: total }));
    } catch {
      // best-effort — box completeness just won't show a total if this fails
    }
  }

  async function addToCart(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!value) return;
    setScanInput("");
    scanInputRef.current?.focus();
    const inputs = value.includes(",") ? value.split(",").map((s) => s.trim()).filter(Boolean) : [value];
    for (const input of inputs) await addSingleToCart(input);
  }

  async function addSingleToCart(input: string) {
    if (input.startsWith("BOX")) {
      await addBoxToCart(input);
    } else if (/^\d+$/.test(input)) {
      try {
        await addReelToCart("REEL-" + input);
      } catch {
        try {
          await addBoxToCart("BOX-" + input);
        } catch {
          showToast("Not found as reel or box", "error");
        }
      }
    } else if (input.startsWith("REEL")) {
      await addReelToCart(input);
    } else {
      try {
        await addReelToCart(input);
      } catch {
        showToast("Not found", "error");
      }
    }
  }

  async function addReelToCart(reelNumber: string) {
    if (cart.find((r) => r.reel_number === reelNumber)) {
      playErrorSound();
      showToast(`${reelNumber} already in cart`, "error");
      return;
    }
    const reel = await api<ReelLookup>(`/api/transfer/reel/${reelNumber}`);
    if (reel.store_code !== fromStore) {
      playErrorSound();
      showToast(`${reelNumber} is at ${storeLabel(reel.store_code)}, not ${storeLabel(fromStore)}`, "error");
      return;
    }
    setCart((prev) => [
      { reel_number: reel.reel_number, item_code: reel.item_code, quantity: reel.quantity, box_number: reel.box_number || null },
      ...prev,
    ]);
    if (reel.box_number) void ensureBoxTotal(reel.box_number);
    playSuccessSound();
    showToast(`Added ${reel.reel_number}`);
  }

  async function addBoxToCart(boxNumber: string) {
    const data = await api<BoxLookup>(`/api/transfer/box/${boxNumber}`);
    const total = data.reels.filter((r) => r.status === "In Stock").length;
    setBoxTotals((prev) => ({ ...prev, [data.box.box_number]: total }));

    let added = 0;
    const newSkipped: Skipped[] = [];
    const newItems: CartItem[] = [];
    for (const reel of data.reels) {
      if (reel.status !== "In Stock") {
        newSkipped.push({ reel_number: reel.reel_number, reason: reel.status === "Outwarded" ? "Already outwarded" : "Deleted" });
        continue;
      }
      if (reel.store_code !== fromStore) {
        newSkipped.push({ reel_number: reel.reel_number, reason: `At ${storeLabel(reel.store_code)}` });
        continue;
      }
      if (cart.find((r) => r.reel_number === reel.reel_number) || newItems.find((r) => r.reel_number === reel.reel_number)) continue;
      newItems.push({ reel_number: reel.reel_number, item_code: reel.item_code, quantity: reel.quantity, box_number: data.box.box_number });
      added++;
    }
    if (newItems.length) setCart((prev) => [...newItems, ...prev]);
    if (newSkipped.length) setSkipped((prev) => [...prev, ...newSkipped.filter((s) => !prev.find((p) => p.reel_number === s.reel_number))]);
    if (added > 0) {
      playSuccessSound();
      showToast(`Added ${added} reel(s) from ${boxNumber}`);
    } else if (newSkipped.length > 0) {
      playErrorSound();
      showToast(`No eligible reels added from ${boxNumber}`, "error");
    }
  }

  function removeFromCart(reelNumber: string) {
    setCart((prev) => prev.filter((r) => r.reel_number !== reelNumber));
    showToast(`Removed ${reelNumber}`);
  }

  function clearCart() {
    setCart([]);
    setSkipped([]);
    setBoxTotals({});
    setNotes("");
    scanInputRef.current?.focus();
  }

  const groupedCart = useMemo(() => {
    const standalone: CartItem[] = [];
    const boxes: Record<string, CartItem[]> = {};
    for (const item of cart) {
      if (item.box_number) (boxes[item.box_number] ||= []).push(item);
      else standalone.push(item);
    }
    return { standalone, boxes };
  }, [cart]);

  async function submitCart() {
    if (cart.length === 0) return showToast("Cart is empty", "error");
    if (!toStore) return showToast("Select a destination store", "error");

    setSubmitting(true);

    const { standalone, boxes } = groupedCart;
    // A box only submits as one atomic kind:'box' call when the cart holds every
    // currently-eligible reel of that box. Anything less — including a box that
    // can never be "complete" because some of its reels have already scattered
    // to another store — submits as individual kind:'reel' calls instead, which
    // the backend now genuinely supports.
    const units: ({ type: "box"; boxNumber: string; items: CartItem[] } | { type: "reel"; item: CartItem })[] = [];
    for (const [boxNumber, items] of Object.entries(boxes)) {
      const total = boxTotals[boxNumber];
      if (total !== undefined && items.length === total) {
        units.push({ type: "box", boxNumber, items });
      } else {
        items.forEach((item) => units.push({ type: "reel", item }));
      }
    }
    standalone.forEach((item) => units.push({ type: "reel", item }));

    let successReels = 0;
    let successBoxes = 0;
    let pendingReels = 0;
    const errors: string[] = [];
    // "Handled" = removed from the cart — both an immediate transfer and a
    // queued-for-approval request are done as far as this cart is concerned,
    // they just haven't necessarily moved yet (non-approver roles queue a
    // pending request here exactly like every other write in this app — see
    // routes/transfer.js POST /). Report the two outcomes separately so a
    // pending submission never gets reported as an already-completed transfer.
    const handled = new Set<string>();

    for (const unit of units) {
      try {
        const result = await api<{ pending?: boolean }>("/api/transfer", {
          method: "POST",
          body: {
            kind: unit.type,
            number: unit.type === "box" ? unit.boxNumber : unit.item.reel_number,
            to_store: toStore,
            notes: notes.trim() || undefined,
          },
        });
        const reelNumbers = unit.type === "box" ? unit.items.map((i) => i.reel_number) : [unit.item.reel_number];
        reelNumbers.forEach((rn) => handled.add(rn));
        if (result.pending) {
          pendingReels += reelNumbers.length;
        } else {
          successReels += reelNumbers.length;
          if (unit.type === "box") successBoxes++;
        }
      } catch (err) {
        const label = unit.type === "box" ? unit.boxNumber : unit.item.reel_number;
        errors.push(`${label}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    setCart((prev) => prev.filter((item) => !handled.has(item.reel_number)));

    if (successReels > 0) {
      showToast(`${successReels} reel(s)${successBoxes ? ` — ${successBoxes} as whole box${successBoxes > 1 ? "es" : ""}` : ""} transferred`);
    }
    if (pendingReels > 0) {
      showToast(`${pendingReels} reel(s) submitted for approval`);
    }
    if (errors.length > 0) {
      showToast(`${errors.length} failed: ${errors[0]}`, "error");
    }
    if (successReels === 0 && pendingReels === 0 && errors.length === 0) {
      showToast("Nothing to transfer", "error");
    }

    loadRecentTransfers();
    setSubmitting(false);
  }

  async function undoTransfer(transferId: number, label: string) {
    const password = window.prompt(`Undo transfer of ${label}?\n\nEnter password to confirm:`);
    if (!password) return;
    try {
      const result = await api<{ message: string }>("/api/transfer/undo", { method: "POST", body: { transfer_id: transferId, password } });
      showToast(result.message);
      loadRecentTransfers();
    } catch {
      // api() already toasted
    }
  }

  const totalReels = cart.length;
  const uniqueBoxes = Object.keys(groupedCart.boxes).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Stock Transfer</h1>
        <p className="text-sm text-muted-foreground">Scan reels or boxes to build a transfer, then submit</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>From Store</Label>
            <Select value={fromStore} onValueChange={onFromStoreChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>To Store</Label>
            <Select value={toStore} onValueChange={setToStore}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {stores
                  .filter((s) => s.code !== fromStore)
                  .map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant={scanner.active ? "default" : "secondary"}
            size="icon"
            title={scanner.active ? "Close Camera" : "Open Camera Scanner"}
            onClick={() => scanner.setActive((v) => !v)}
          >
            {scanner.active ? <CameraOff /> : <Camera />}
          </Button>
          <Input
            ref={scanInputRef}
            autoFocus
            className="min-w-48 flex-1"
            placeholder="Scan or type REEL-##### or BOX-####"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addToCart(scanInput);
              }
            }}
          />
          <Button onClick={() => addToCart(scanInput)}>Add to Cart</Button>
        </div>
        {scanner.active && (
          <div className="mt-3.5 overflow-hidden rounded-md border border-border">
            <div id="reader" />
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted-foreground">
          Scan a reel to add it. Scan a box to add all its in-stock reels. A box only transfers as one atomic move when every eligible reel is in the cart — otherwise its reels transfer individually.
        </div>
      </Card>

      {(cart.length > 0 || skipped.length > 0) && (
        <Card className="p-5">
          <div className="mb-3 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transfer Cart
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">{cart.length}</span>
          </div>
          <div className="mb-2.5 border-b border-border pb-2.5 text-xs text-muted-foreground">
            <strong>{totalReels}</strong> reel(s) &middot; <strong>{uniqueBoxes}</strong> box group(s)
          </div>

          <div className="space-y-3">
            {Object.entries(groupedCart.boxes).map(([boxNumber, items]) => {
              const total = boxTotals[boxNumber];
              const complete = total !== undefined && items.length === total;
              return (
                <div key={boxNumber} className={cn("rounded-md border p-2.5", complete ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")}>
                  <div className={cn("mb-1.5 text-xs font-bold", complete ? "text-success" : "text-warning")}>
                    {boxNumber} — {items.length} of {total ?? "?"} reels in cart {complete ? "(will transfer as one box)" : "(will transfer individually)"}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((r) => (
                      <div key={r.reel_number} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="font-bold">{r.reel_number}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.item_code} &middot; {formatQty(r.quantity)} pcs
                          </span>
                        </div>
                        <button className="px-1 text-lg font-bold text-destructive" onClick={() => removeFromCart(r.reel_number)} title="Remove">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {groupedCart.standalone.map((r) => (
              <div key={r.reel_number} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-bold">{r.reel_number}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.item_code} &middot; {formatQty(r.quantity)} pcs
                  </span>
                </div>
                <button className="px-1 text-lg font-bold text-destructive" onClick={() => removeFromCart(r.reel_number)} title="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>

          {skipped.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] text-warning">Skipped (not eligible from {storeLabel(fromStore)}):</div>
              {skipped.map((s) => (
                <div key={s.reel_number} className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm line-through text-muted-foreground">
                  <span>{s.reel_number}</span>
                  <span className="text-xs">{s.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input placeholder="e.g. Rebalancing stock" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" variant="secondary" onClick={submitCart} disabled={cart.length === 0 || !toStore || submitting}>
                {submitting ? "Processing..." : `Transfer ${cart.length} Reel(s)`}
              </Button>
              <Button variant="ghost" onClick={clearCart}>
                Clear Cart
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <DataTable
          title="Recent Transfers"
          data={transfers}
          getRowKey={(t) => t.id}
          columns={[
            { label: "Item", render: (t) => <strong>{t.reel_number || t.box_number}</strong> },
            { label: "Box", render: (t) => (t.reel_number ? t.box_number || "—" : "—") },
            { label: "From", render: (t) => storeLabel(t.from_store) },
            { label: "To", render: (t) => storeLabel(t.to_store) },
            { label: "Qty", render: (t) => formatQty(t.quantity) },
            { label: "By", render: (t) => t.transferred_by },
            { label: "Date", render: (t) => formatDateTime(t.transferred_at) },
            { label: "Notes", render: (t) => t.notes || "—" },
            {
              key: "actions",
              label: "",
              render: (t) => (
                <Button size="sm" variant="destructive" onClick={() => undoTransfer(t.id, t.reel_number || t.box_number || String(t.id))}>
                  Undo
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Fab
        secondary
        title="Type Reel/Box Number"
        onClick={() => {
          scanInputRef.current?.focus();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        icon={<PenLine className="size-5" />}
      />
      <Fab
        title="Open Camera Scanner"
        onClick={() => {
          scanner.setActive((v) => !v);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        icon={<Camera className="size-6" />}
      />
    </div>
  );
}
