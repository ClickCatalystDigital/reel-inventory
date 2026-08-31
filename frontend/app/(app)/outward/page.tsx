"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, PenLine } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty, formatDateTime, nowISTString } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { GELCO_ROLES } from "@/lib/role-allowlist";
import { playSuccessSound, playErrorSound } from "@/lib/scan-sound";
import { useQrScanner } from "@/hooks/use-qr-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
  description: string;
  quantity: number;
  box_number: string;
}
interface Skipped {
  reel_number: string;
  reason: string;
}
interface Company {
  id: number;
  name: string;
}
interface POOption {
  id: number;
  po_number: string;
  expected_dispatch_date: string | null;
}
interface POItem {
  item_code: string;
  description: string;
  quantity_ordered: number;
}
interface PO {
  id: number;
  po_number: string;
  items: POItem[];
}
interface OutwardRow {
  id: number;
  reel_number: string;
  box_number: string | null;
  item_code: string;
  description?: string;
  customer_name: string;
  invoice_number: string;
  quantity_shipped: number;
  outward_type: "Full" | "Partial";
  outward_date: string;
}
type Issue =
  | { type: "missing"; item_code: string; description: string; needed: number }
  | { type: "short" | "over"; item_code: string; description: string; needed: number; have: number }
  | { type: "extra"; item_code: string; description: string; qty: number };

export default function OutwardPage() {
  const { user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const isGelco = !!user && GELCO_ROLES.includes(user.role);

  const [stores, setStores] = useState<Store[]>([]);
  const [storeCode, setStoreCode] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [poOptions, setPoOptions] = useState<POOption[]>([]);
  const [poId, setPoId] = useState("");
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [recentOutwards, setRecentOutwards] = useState<OutwardRow[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [summaryRows, setSummaryRows] = useState<{ item_code: string; description?: string; reels: number; total_qty: number }[]>([]);
  const [summaryCount, setSummaryCount] = useState(0);
  const [summaryTotal, setSummaryTotal] = useState(0);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  // loadStores() below is only ever invoked once, from the mount effect — its
  // closure captures whatever `isGelco` was on that very first render (almost
  // always false, since useAuth()'s user fetch hasn't resolved yet). Reading a
  // ref instead of the closed-over variable means its setStoreCode call always
  // sees the real, current role once the async fetch actually resolves.
  const isGelcoRef = useRef(isGelco);
  useEffect(() => {
    isGelcoRef.current = isGelco;
  }, [isGelco]);

  const scanner = useQrScanner("reader", (text) => {
    setScanInput(text);
    void addToCart(text);
  }, (msg) => showToast(msg, "error"));

  useEffect(() => {
    // One-off data fetch on mount — a legitimate effect use.
    (async () => {
      try {
        setCompanies(await api<Company[]>("/api/po/companies"));
      } catch {
        // api() already toasted
      }
    })();
  }, []);

  async function loadStores() {
    try {
      const list = await api<Store[]>("/api/stores");
      setStores(list);
      const preferred = selectedStore !== "all" ? selectedStore : "primary";
      setStoreCode(isGelcoRef.current ? "secondary" : preferred);
    } catch {
      // api() already toasted
    }
  }

  async function loadRecentOutwards(page = 1, pageSize = 10) {
    try {
      const sp = storeQueryParam(selectedStore);
      const offset = (page - 1) * pageSize;
      const data = await api<{ rows: OutwardRow[]; total: number }>(
        `/api/outward/recent?limit=${pageSize}&offset=${offset}${sp ? "&" + sp : ""}`
      );
      setRecentOutwards(data.rows);
      setRecentTotal(data.total);
    } catch {
      // api() already toasted
    }
  }

  async function loadOutwardSummary() {
    try {
      const sp = storeQueryParam(selectedStore);
      const data = await api<{ rows: OutwardRow[] }>(`/api/outward/recent?limit=500${sp ? "&" + sp : ""}`);
      const byItem: Record<string, { item_code: string; description?: string; reels: number; total_qty: number }> = {};
      let grand = 0;
      for (const o of data.rows) {
        if (!byItem[o.item_code]) byItem[o.item_code] = { item_code: o.item_code, description: o.description, reels: 0, total_qty: 0 };
        byItem[o.item_code].reels++;
        byItem[o.item_code].total_qty += o.quantity_shipped || 0;
        grand += o.quantity_shipped || 0;
      }
      setSummaryRows(Object.values(byItem).sort((a, b) => b.total_qty - a.total_qty));
      setSummaryCount(data.rows.length);
      setSummaryTotal(grand);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // useAuth() resolves after this mount, so loadStores() above can run while
    // isGelco is still stale-false and lock the dropdown open on the wrong store.
    // Re-force it once the real role is known.
    if (isGelco) setStoreCode("secondary");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGelco]);

  useEffect(() => {
    // Data fetch reacting to the store selector — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecentOutwards(1, 10);
    loadOutwardSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  // Close customer suggestions when clicking away.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const customerMatches = companies.filter((c) => c.name.toLowerCase().includes(customerName.trim().toLowerCase())).slice(0, 8);

  function onCustomerInput(value: string) {
    setCustomerName(value);
    setCompanyId(null);
    resetPO();
    setSuggestOpen(!!value.trim());
  }

  function pickCustomer(c: Company) {
    setCustomerName(c.name);
    setCompanyId(c.id);
    setSuggestOpen(false);
    loadPOsForCompany(c.id);
  }

  function resetPO() {
    setPoOptions([]);
    setPoId("");
    setSelectedPO(null);
  }

  async function loadPOsForCompany(id: number) {
    try {
      const pos = await api<POOption[]>(`/api/po/companies/${id}/open`);
      setPoOptions(pos);
      setPoId("");
      setSelectedPO(null);
    } catch {
      resetPO();
    }
  }

  async function onPOChange(value: string) {
    setPoId(value);
    setSelectedPO(null);
    if (!value) return;
    try {
      setSelectedPO(await api<PO>(`/api/po/${value}`));
    } catch {
      showToast("Failed to load PO details", "error");
    }
  }

  // === PO validation, derived from cart + selectedPO ===
  let issues: Issue[] = [];
  if (selectedPO) {
    const cartByItem: Record<string, number> = {};
    for (const r of cart) cartByItem[r.item_code] = (cartByItem[r.item_code] || 0) + r.quantity;
    const poItems = (selectedPO.items || []).filter((i) => i.item_code);
    if ((selectedPO.items || []).length === 0 || poItems.length === 0) {
      issues = [{ type: "extra", item_code: "", description: (selectedPO.items || []).length === 0 ? "no-items" : "no-codes", qty: 0 }];
    } else {
      const poItemCodes = new Set(poItems.map((i) => i.item_code));
      for (const pi of poItems) {
        const have = cartByItem[pi.item_code] || 0;
        if (have === 0) issues.push({ type: "missing", item_code: pi.item_code, description: pi.description, needed: pi.quantity_ordered });
        else if (have !== pi.quantity_ordered)
          issues.push({ type: have < pi.quantity_ordered ? "short" : "over", item_code: pi.item_code, description: pi.description, needed: pi.quantity_ordered, have });
      }
      for (const [itemCode, qty] of Object.entries(cartByItem)) {
        if (!poItemCodes.has(itemCode)) {
          const reel = cart.find((r) => r.item_code === itemCode);
          issues.push({ type: "extra", item_code: itemCode, description: reel?.description || "", qty });
        }
      }
    }
  }
  const poBlocked = selectedPO !== null && issues.length > 0;
  const canSubmit = cart.length > 0 && !poBlocked;

  // === Cart operations ===
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
    const reel = await api<{ reel_number: string; item_code: string; description: string; quantity: number; box_number: string | null }>(
      `/api/outward/reel/${reelNumber}`
    );
    setCart((prev) => [
      { reel_number: reel.reel_number, item_code: reel.item_code, description: reel.description, quantity: reel.quantity, box_number: reel.box_number || "—" },
      ...prev,
    ]);
    playSuccessSound();
    showToast(`Added ${reel.reel_number}`);
  }

  async function addBoxToCart(boxNumber: string) {
    const data = await api<{ box: { box_number: string }; reels: { reel_number: string; item_code: string; description: string; quantity: number; status: string; store_code: string }[] }>(
      `/api/outward/box/${boxNumber}`
    );
    let added = 0;
    const newSkipped: Skipped[] = [];
    const newItems: CartItem[] = [];
    for (const reel of data.reels) {
      if (reel.status === "Outwarded") {
        newSkipped.push({ reel_number: reel.reel_number, reason: "Already outwarded" });
        continue;
      }
      if (isGelco && reel.store_code !== "secondary") {
        newSkipped.push({ reel_number: reel.reel_number, reason: "Not at Gelco Stores" });
        continue;
      }
      if (cart.find((r) => r.reel_number === reel.reel_number) || newItems.find((r) => r.reel_number === reel.reel_number)) continue;
      newItems.push({ reel_number: reel.reel_number, item_code: reel.item_code, description: reel.description, quantity: reel.quantity, box_number: data.box.box_number });
      added++;
    }
    if (newItems.length) setCart((prev) => [...newItems, ...prev]);
    if (newSkipped.length) setSkipped((prev) => [...prev, ...newSkipped.filter((s) => !prev.find((p) => p.reel_number === s.reel_number))]);
    if (added > 0) {
      playSuccessSound();
      showToast(`Added ${added} reel(s) from ${boxNumber}`);
    } else if (newSkipped.length > 0) {
      playErrorSound();
      showToast(`No eligible reels in ${boxNumber} — already outwarded, not at this store, or already in cart`, "error");
    }
  }

  function removeFromCart(reelNumber: string) {
    setCart((prev) => prev.filter((r) => r.reel_number !== reelNumber));
    showToast(`Removed ${reelNumber}`);
  }

  function clearCart() {
    setCart([]);
    setSkipped([]);
    setCustomerName("");
    setCompanyId(null);
    setInvoiceNumber("");
    setNotes("");
    resetPO();
    scanInputRef.current?.focus();
  }

  async function downloadPackingList(customer: string, invoice: string, reels: CartItem[], notesVal: string) {
    try {
      const res = await fetch("/api/labels/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: customer, invoice_number: invoice, reels, notes: notesVal }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `packing_list_${invoice}_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // best-effort — matches legacy's console.error-only handling
    }
  }

  async function submitCart() {
    if (cart.length === 0) return showToast("Cart is empty", "error");
    if (!isGelco) {
      if (!companyId) return showToast("Select a customer from the suggestions (must be a CRM company)", "error");
      if (!invoiceNumber.trim()) return showToast("Invoice number is required", "error");
    }
    if (poBlocked) return showToast("Resolve PO mismatches before submitting", "error");

    setSubmitting(true);
    const byItem: Record<string, CartItem[]> = {};
    for (const reel of cart) (byItem[reel.item_code] ||= []).push(reel);

    // Gelco outward skips the CRM customer/PO tie-in entirely — a fixed
    // customer label and today's date/time (shared across every item group
    // in this submission, so they stay groupable for reprint) stand in for
    // the fields a real customer shipment would need.
    const shipmentCustomer = isGelco ? "Gelco Stores" : customerName.trim();
    const shipmentInvoice = isGelco ? nowISTString() : invoiceNumber.trim();

    let successCount = 0;
    let pendingCount = 0;
    const errors: string[] = [];
    for (const [item_code, reels] of Object.entries(byItem)) {
      try {
        const result = await api<{ pending?: boolean }>("/api/outward/grouped", {
          method: "POST",
          body: {
            item_code,
            reel_numbers: reels.map((r) => r.reel_number),
            customer_name: shipmentCustomer,
            invoice_number: shipmentInvoice,
            outward_type: "Full",
            notes: notes.trim() || undefined,
            company_id: isGelco ? null : companyId,
            po_id: isGelco ? null : (poId ? parseInt(poId) : null),
            store_code: storeCode,
          },
        });
        if (result.pending) pendingCount += reels.length;
        else successCount += reels.length;
      } catch (err) {
        errors.push(`${item_code}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    if (successCount > 0) {
      showToast(`${successCount} reel(s) outwarded successfully`);
      await downloadPackingList(shipmentCustomer, shipmentInvoice, cart, notes);
    }
    if (pendingCount > 0) showToast(`${pendingCount} reel(s) submitted for approval (grouped by item)`);
    if (errors.length > 0) showToast(`${errors.length} item(s) failed: ${errors[0]}`, "error");

    clearCart();
    loadRecentOutwards(1, 10);
    loadOutwardSummary();
    setSubmitting(false);
  }

  async function regenPackingList(customer: string, invoice: string) {
    try {
      const matching = await api<OutwardRow[]>(`/api/outward/for-reprint?customer_name=${encodeURIComponent(customer)}&invoice_number=${encodeURIComponent(invoice)}`);
      if (!matching.length) return showToast("No outwards found for this invoice", "error");
      const reels: CartItem[] = matching.map((o) => ({ reel_number: o.reel_number, item_code: o.item_code, box_number: o.box_number || "—", quantity: o.quantity_shipped, description: "" }));
      await downloadPackingList(customer, invoice, reels, "");
      showToast("Packing list downloaded");
    } catch {
      showToast("Failed to generate packing list", "error");
    }
  }

  async function undoOutward(outwardId: number, reelNumber: string) {
    const password = window.prompt(`Undo outward for ${reelNumber}?\n\nThis will:\n• Delete the outward record\n• Restore reel to In Stock\n\nEnter password to confirm:`);
    if (!password) return;
    try {
      const result = await api<{ message: string }>("/api/outward/undo", { method: "POST", body: { outward_id: outwardId, password } });
      showToast(result.message);
      loadRecentOutwards(1, 10);
      loadOutwardSummary();
    } catch {
      // api() already toasted
    }
  }

  const totalPcs = cart.reduce((s, r) => s + (r.quantity || 0), 0);
  const uniqueItems = new Set(cart.map((r) => r.item_code)).size;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Outward Stock</h1>
        <p className="text-sm text-muted-foreground">Scan reels or boxes to build a shipment, then submit</p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
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
            placeholder="Scan QR or type number — keeps adding to cart"
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
          Scan a reel to add it. Scan a box to add all its in-stock reels. Keep scanning to build your shipment.
        </div>
      </Card>

      {(cart.length > 0 || skipped.length > 0) && (
        <Card className="overflow-visible p-5">
          <div className="mb-3 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Shipment Cart
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">{cart.length}</span>
          </div>
          <div className="mb-2.5 border-b border-border pb-2.5 text-xs text-muted-foreground">
            <strong>{cart.length}</strong> reel(s) &middot; <strong>{uniqueItems}</strong> item(s) &middot; <strong>{formatQty(totalPcs)}</strong> pcs total
          </div>
          <div className="space-y-1.5">
            {cart.map((r) => (
              <div key={r.reel_number} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-bold">{r.reel_number}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.item_code} &middot; {formatQty(r.quantity)} pcs &middot; {r.box_number}
                  </span>
                </div>
                <button className="px-1 text-lg font-bold text-destructive" onClick={() => removeFromCart(r.reel_number)} title="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>
          {skipped.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] text-warning">Skipped:</div>
              {skipped.map((s) => (
                <div key={s.reel_number} className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm line-through text-muted-foreground">
                  <span>{s.reel_number}</span>
                  <span className="text-xs">{s.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-4 border-t border-border pt-4">
            {isGelco ? (
              <div className="space-y-1.5">
                <Label>Shipment Label</Label>
                <Input disabled value={formatDateTime(nowISTString())} />
                <p className="text-[11px] text-muted-foreground">
                  Gelco outward doesn&apos;t need a customer or invoice — today&apos;s date &amp; time is recorded as the shipment label.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div ref={customerBoxRef} className="relative space-y-1.5">
                    <Label>Customer Name</Label>
                    <Input
                      autoComplete="off"
                      placeholder="Start typing a CRM company…"
                      value={customerName}
                      onChange={(e) => onCustomerInput(e.target.value)}
                      onFocus={() => setSuggestOpen(!!customerName.trim())}
                    />
                    {suggestOpen && (
                      <div className="absolute top-full right-0 left-0 z-50 max-h-[220px] overflow-y-auto rounded-b-md border border-t-0 border-border bg-card shadow-lg">
                        {customerMatches.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground italic">No CRM company matches — add them in the CRM first</div>
                        ) : (
                          customerMatches.map((c) => (
                            <div
                              key={c.id}
                              className="cursor-pointer border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-secondary"
                              onMouseDown={() => pickCustomer(c)}
                            >
                              {c.name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Number</Label>
                    <Input placeholder="e.g. INV-2025-001" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Purchase Order <span className="font-normal text-muted-foreground">(optional — confirmed POs only)</span>
                  </Label>
                  <select
                    disabled={!companyId || poOptions.length === 0}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm disabled:opacity-60"
                    value={poId}
                    onChange={(e) => onPOChange(e.target.value)}
                  >
                    {!companyId ? (
                      <option value="">Select a customer first</option>
                    ) : poOptions.length === 0 ? (
                      <option value="">No confirmed POs for this customer</option>
                    ) : (
                      <>
                        <option value="">— No PO (optional) —</option>
                        {poOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.po_number}
                            {p.expected_dispatch_date ? ` · exp ${p.expected_dispatch_date}` : ""}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                {selectedPO && <POValidationPanel po={selectedPO} issues={issues} />}
              </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Shipping Store</Label>
                <select
                  disabled={isGelco}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm disabled:opacity-60"
                  value={storeCode}
                  onChange={(e) => setStoreCode(e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Input placeholder="e.g. Urgent shipment" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" variant="secondary" onClick={submitCart} disabled={!canSubmit || submitting}>
                {submitting ? "Processing..." : `Outward ${cart.length} Reel(s)`}
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
          title="Recent Outwards"
          mode="server"
          data={recentOutwards}
          totalCount={recentTotal}
          pageSize={10}
          onPageChange={(page, size) => loadRecentOutwards(page, size)}
          getRowKey={(o) => o.id}
          columns={[
            { label: "Reel", render: (o) => <strong>{o.reel_number}</strong> },
            { label: "Box", render: (o) => o.box_number || "—" },
            { label: "Item", render: (o) => o.item_code },
            { label: "Customer", render: (o) => o.customer_name },
            { label: "Invoice", render: (o) => o.invoice_number },
            { label: "Qty", render: (o) => formatQty(o.quantity_shipped) },
            {
              label: "Type",
              render: (o) => (
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", o.outward_type === "Full" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                  {o.outward_type}
                </span>
              ),
            },
            { label: "Date", render: (o) => formatDateTime(o.outward_date) },
            {
              key: "actions",
              label: "",
              render: (o) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => regenPackingList(o.customer_name, o.invoice_number)}>
                    PDF
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => undoOutward(o.id, o.reel_number)}>
                    Undo
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {summaryRows.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outward Summary — Last 500 Records</div>
          <DataTable
            title=""
            data={summaryRows}
            getRowKey={(r) => r.item_code}
            columns={[
              { label: "Item Code", render: (r) => <strong>{r.item_code}</strong> },
              { label: "Description", render: (r) => r.description || "—" },
              { label: "Reels", render: (r) => r.reels },
              { label: "Total Qty", render: (r) => formatQty(r.total_qty) },
            ]}
          />
          <div className="mt-2 flex justify-between border-t-2 border-border pt-2 text-sm font-bold">
            <span>TOTAL</span>
            <span>
              {summaryCount} reels &middot; {formatQty(summaryTotal)}
            </span>
          </div>
        </Card>
      )}

      <Fab
        secondary
        title="Type Reel Number"
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

function POValidationPanel({ po, issues }: { po: PO; issues: Issue[] }) {
  if ((po.items || []).length === 0) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
        ⚠ PO {po.po_number} has no line items — add items to this PO in the CRM before outward.
      </div>
    );
  }
  const poItemsWithCodes = po.items.filter((i) => i.item_code);
  if (poItemsWithCodes.length === 0) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
        ⚠ PO {po.po_number} items have no assigned item codes yet — assign them in the CRM before outward.
      </div>
    );
  }
  if (issues.length === 0) {
    return (
      <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">✓ Cart matches PO {po.po_number}</div>
    );
  }
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <div className="mb-1.5 text-[10px] font-bold tracking-wide text-destructive uppercase">
        PO {po.po_number} — {issues.length} mismatch{issues.length !== 1 ? "es" : ""}
      </div>
      {issues.map((issue, i) => {
        if (issue.type === "missing") {
          return (
            <div key={i} className="flex items-center justify-between border-b border-border py-1.5 text-xs last:border-b-0">
              <div>
                <span className="font-extrabold text-destructive">MISSING</span> <span className="ml-1.5 font-bold">{issue.item_code}</span>{" "}
                {issue.description && <span className="text-muted-foreground">{issue.description}</span>}
              </div>
              <span className="ml-2 font-bold whitespace-nowrap text-destructive">needs {formatQty(issue.needed)} pcs</span>
            </div>
          );
        }
        if (issue.type === "short" || issue.type === "over") {
          const color = issue.type === "short" ? "text-warning" : "text-destructive";
          const diff = issue.type === "short" ? `${formatQty(issue.needed - issue.have)} still needed` : `${formatQty(issue.have - issue.needed)} excess`;
          return (
            <div key={i} className="flex items-center justify-between border-b border-border py-1.5 text-xs last:border-b-0">
              <div>
                <span className={cn("font-extrabold", color)}>{issue.type === "short" ? "SHORT" : "OVER"}</span>{" "}
                <span className="ml-1.5 font-bold">{issue.item_code}</span>{" "}
                {issue.description && <span className="text-muted-foreground">{issue.description}</span>}
              </div>
              <span className={cn("ml-2 font-bold whitespace-nowrap", color)}>
                {formatQty(issue.have)} / {formatQty(issue.needed)} pcs &middot; {diff}
              </span>
            </div>
          );
        }
        const extra = issue as Extract<Issue, { type: "extra" }>;
        return (
          <div key={i} className="flex items-center justify-between border-b border-border py-1.5 text-xs last:border-b-0">
            <div>
              <span className="font-extrabold text-destructive">NOT IN PO</span> <span className="ml-1.5 font-bold">{extra.item_code}</span>{" "}
              {extra.description && <span className="text-muted-foreground">{extra.description}</span>}
            </div>
            <span className="ml-2 font-bold whitespace-nowrap text-destructive">{formatQty(extra.qty)} pcs in cart</span>
          </div>
        );
      })}
    </div>
  );
}
