"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { GELCO_ROLES } from "@/lib/role-allowlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table/DataTable";
import { Fab } from "@/components/layout/Fab";
import { PdfOverlay } from "@/components/layout/PdfOverlay";

interface Item {
  item_code: string;
  description: string;
  default_spq: number;
}

interface Store {
  code: string;
  name: string;
}

interface Reel {
  reel_number: string;
  box_number: string | null;
  item_code: string;
  quantity: number;
  status: string;
  inward_date: string;
}

interface InwardResult {
  message: string;
  pending?: boolean;
  boxes: { box_number: string; reel_count: number; reels: { reel_number: string }[] }[];
  reels: { reel_number: string }[];
}

export default function InwardPage() {
  const { user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const isGelco = !!user && GELCO_ROLES.includes(user.role);

  const [items, setItems] = useState<Item[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [itemCode, setItemCode] = useState("");
  const [inputMode, setInputMode] = useState<"reels" | "qty">("reels");
  const [numReelsRaw, setNumReelsRaw] = useState("");
  const [reelsPerBox, setReelsPerBox] = useState("0");
  const [storeCode, setStoreCode] = useState("");
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<InwardResult | null>(null);
  const [recent, setRecent] = useState<Reel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState<{ active: boolean; message: string }>({ active: false, message: "" });

  const formRef = useRef<HTMLDivElement>(null);
  const itemSelectRef = useRef<HTMLButtonElement>(null);

  async function loadItems() {
    try {
      const list = await api<Item[]>("/api/items");
      list.sort((a, b) => a.item_code.localeCompare(b.item_code));
      setItems(list);
    } catch {
      // api() already toasted
    }
  }

  async function loadStores() {
    try {
      const list = await api<Store[]>("/api/stores");
      setStores(list);
      const preferred = selectedStore !== "all" ? selectedStore : "primary";
      setStoreCode(isGelco ? "secondary" : preferred);
    } catch {
      // api() already toasted
    }
  }

  async function loadRecent() {
    try {
      const sp = storeQueryParam(selectedStore);
      const reels = await api<Reel[]>(`/api/inward/recent?limit=500${sp ? "&" + sp : ""}`);
      setRecent(reels);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems();
    loadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Data fetch reacting to the store selector — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  const selectedItem = items.find((i) => i.item_code === itemCode);
  const perBox = parseInt(reelsPerBox) || 0;
  const raw = parseInt(numReelsRaw) || 0;

  let numReels = 0;
  let warning: string | null = null;
  if (selectedItem && raw) {
    if (inputMode === "qty") {
      const spq = selectedItem.default_spq;
      const exact = raw / spq;
      numReels = Math.round(exact);
      if (exact !== numReels) warning = `${raw} ÷ ${spq} (SPQ) = ${exact.toFixed(2)} — rounded to ${numReels} reel(s)`;
    } else {
      numReels = raw;
    }
  }

  function switchMode(mode: "reels" | "qty") {
    setInputMode(mode);
    setNumReelsRaw("");
  }

  async function submitInward(e: React.FormEvent) {
    e.preventDefault();
    if (!itemCode) return showToast("Select an item", "error");
    if (!numReels || numReels < 1) return showToast("Enter a valid number of reels or quantity", "error");
    if (warning && !window.confirm(`${warning}\n\nProceed with ${numReels} reel(s)?`)) return;
    if (perBox > 0 && numReels % perBox !== 0) {
      return showToast(`${numReels} reels is not evenly divisible by ${perBox} per box`, "error");
    }
    const numBoxes = perBox > 0 ? numReels / perBox : 0;

    setOverlay({ active: true, message: "Generating PDF..." });
    try {
      const data = await api<InwardResult>("/api/inward", {
        method: "POST",
        body: { item_code: itemCode, num_reels: numReels, num_boxes: numBoxes, notes, store_code: storeCode },
      });
      showToast(data.message);
      setResult(data);
      if (!data.pending) loadRecent();
      if (!data.pending) {
        // Approved immediately — keep the form filled state minimal, matching legacy resetForm() only on pending.
      } else {
        resetForm(false);
      }
    } catch {
      // api() already toasted
    } finally {
      setOverlay({ active: false, message: "" });
    }
  }

  function resetForm(clearResult = true) {
    setItemCode("");
    setNumReelsRaw("");
    setReelsPerBox("0");
    setNotes("");
    if (clearResult) setResult(null);
  }

  async function downloadPDF(url: string, body: unknown, prefix: string) {
    setOverlay({ active: true, message: "Generating PDF..." });
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const blob = await res.blob();
      const link = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = link;
      a.download = `${prefix}_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(link);
      showToast("PDF downloaded");
    } catch {
      showToast("Failed to generate PDF", "error");
    } finally {
      setOverlay({ active: false, message: "" });
    }
  }

  async function reprintSelected() {
    if (!selected.size) return showToast("Select at least one reel", "error");
    const rows = recent.filter((r) => selected.has(r.reel_number));
    const boxNumbers = [...new Set(rows.map((r) => r.box_number).filter((b): b is string => !!b))];
    if (boxNumbers.length > 0) {
      const printBoxes = window.confirm(
        `Selected reels belong to ${boxNumbers.length} box(es).\n\nOK = Download Box Labels\nCancel = Download Reel Labels`
      );
      if (printBoxes) {
        await downloadPDF("/api/labels/generate-box", { box_numbers: boxNumbers }, "box_labels_reprint");
        return;
      }
    }
    await downloadPDF("/api/labels/generate", { reel_numbers: [...selected] }, "labels_reprint");
  }

  async function undoSelected() {
    if (!selected.size) return showToast("Select at least one reel", "error");
    const password = window.prompt(
      `Undo inward for ${selected.size} reel(s)?\n\nThis will mark them as Deleted and clean up empty boxes.\nOutwarded reels will be skipped.\n\nEnter password to confirm:`
    );
    if (!password) return;
    try {
      const result = await api<{ message: string }>("/api/inward/undo", {
        method: "POST",
        body: { reel_numbers: [...selected], password },
      });
      showToast(result.message);
      setSelected(new Set());
      loadRecent();
    } catch {
      // api() already toasted
    }
  }

  function toggleSelected(reelNumber: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(reelNumber);
      else next.delete(reelNumber);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div ref={formRef}>
        <h1 className="text-xl font-bold">Inward Stock</h1>
        <p className="text-sm text-muted-foreground">Receive new reels, assign to boxes, and generate QR labels</p>
      </div>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receive Reels</div>
        <form onSubmit={submitInward} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Item Code</Label>
              <Select value={itemCode} onValueChange={setItemCode}>
                <SelectTrigger ref={itemSelectRef} className="w-full">
                  <SelectValue placeholder="— Select Item —" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.item_code} value={i.item_code}>
                      {i.item_code} — {i.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{inputMode === "qty" ? "Total Stock Quantity" : "Number of Reels"}</Label>
              <Tabs value={inputMode} onValueChange={(v) => switchMode(v as "reels" | "qty")} className="mb-2">
                <TabsList>
                  <TabsTrigger value="reels">By Reels</TabsTrigger>
                  <TabsTrigger value="qty">By Total Qty</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input
                type="number"
                min={1}
                max={inputMode === "reels" ? 500 : undefined}
                required
                placeholder={inputMode === "qty" ? "e.g. 5000" : "e.g. 50"}
                value={numReelsRaw}
                onChange={(e) => setNumReelsRaw(e.target.value)}
              />
              {warning && <div className="mt-1 text-[11px] text-muted-foreground">⚠️ {warning}</div>}
            </div>
            <div className="space-y-1.5">
              <Label>Reels Per Box</Label>
              <Input
                type="number"
                min={0}
                max={500}
                placeholder="0 = no box"
                value={reelsPerBox}
                onChange={(e) => setReelsPerBox(e.target.value)}
              />
            </div>
          </div>

          {selectedItem && (
            <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-secondary p-3 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Description</div>
                <div className="font-medium">{selectedItem.description}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Default SPQ</div>
                <div className="font-medium">{formatQty(selectedItem.default_spq)} per reel</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Reels</div>
                <div className="font-medium">{numReels ? `${numReels} reel(s)` : "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Boxes</div>
                <div className="font-medium">
                  {perBox === 0
                    ? "No boxes"
                    : numReels > 0 && numReels % perBox !== 0
                      ? `⚠️ ${numReels} not divisible by ${perBox}`
                      : numReels > 0
                        ? `${numReels / perBox} box(es), ${perBox} per box`
                        : "—"}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-1.5 sm:flex-1">
              <Label>Receiving Store</Label>
              <Select value={storeCode} onValueChange={setStoreCode} disabled={isGelco}>
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
            <div className="space-y-1.5 sm:flex-1">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g. Supplier batch #, PO number"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button type="submit" className="sm:shrink-0">
              Inward Reels
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {result.pending ? "Pending Approval" : result.boxes.length > 0 ? "Reels & Boxes Created" : "Reels Created"}
          </div>
          {result.pending ? (
            <div className="py-4 text-center text-muted-foreground">
              <div className="mb-2 text-3xl">⏳</div>
              <div className="text-sm font-semibold">Submitted for Approval</div>
              <div className="mt-1 text-xs">An approver will review and approve this inward request.</div>
            </div>
          ) : result.boxes.length > 0 ? (
            result.boxes.map((box) => (
              <div key={box.box_number} className="mb-3">
                <strong>{box.box_number}</strong> — {box.reel_count} reel(s)
                <div className="mt-1 text-xs text-muted-foreground">{box.reels.map((r) => r.reel_number).join(", ")}</div>
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">{result.reels.map((r) => r.reel_number).join(", ")}</div>
          )}
          {!result.pending && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => downloadPDF("/api/labels/generate", { reel_numbers: result.reels.map((r) => r.reel_number) }, "reel_labels")}>
                Download Reel Labels
              </Button>
              {result.boxes.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => downloadPDF("/api/labels/generate-box", { box_numbers: result.boxes.map((b) => b.box_number) }, "box_labels")}
                >
                  Download Box Labels
                </Button>
              )}
              <Button variant="ghost" onClick={() => resetForm(true)}>
                Inward More
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <DataTable
          title="Recent Inwards"
          data={recent}
          getRowKey={(r) => r.reel_number}
          columns={[
            {
              key: "select",
              label: "",
              render: (r) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.reel_number}`}
                  checked={selected.has(r.reel_number)}
                  onChange={(e) => toggleSelected(r.reel_number, e.target.checked)}
                />
              ),
            },
            { label: "Reel", render: (r) => <strong>{r.reel_number}</strong> },
            { label: "Box", render: (r) => r.box_number || "—" },
            { label: "Item", render: (r) => r.item_code },
            { label: "Qty", render: (r) => formatQty(r.quantity) },
            { label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { label: "Date & Time", render: (r) => formatDateTime(r.inward_date) },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={reprintSelected}>
            Reprint Selected Labels
          </Button>
          <Button variant="destructive" size="sm" onClick={undoSelected}>
            Undo Selected Inward
          </Button>
        </div>
      </Card>

      <Fab
        title="New Inward"
        onClick={() => {
          formRef.current?.scrollIntoView({ behavior: "smooth" });
          itemSelectRef.current?.focus();
        }}
        icon={<Plus className="size-6" />}
      />
      <PdfOverlay active={overlay.active} message={overlay.message} />
    </div>
  );
}
