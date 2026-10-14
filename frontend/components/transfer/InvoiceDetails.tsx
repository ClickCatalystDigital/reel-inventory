"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isApproverRole } from "@/lib/crm";
import { BRAND } from "@/lib/brand";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Item { item_code: string; description: string | null; invoice_name: string | null; hsn_code: string | null; sale_rate: number | null; gst_rate: number | null }
type Draft = { invoice_name: string; hsn_code: string; sale_rate: string; gst_rate: string };
const ready = (i?: Item) => !!i && i.sale_rate != null && !!(i.hsn_code || "").trim();

// Reels moving to the partner store take their item's invoice details with them (they print on the
// partner's invoices). Shows those details for the cart's items; admin/manager fill in any that are missing.
export function InvoiceDetails({ itemCodes, onReady }: { itemCodes: string[]; onReady: (ok: boolean) => void }) {
  const { user } = useAuth();
  const canEdit = isApproverRole(user?.role);
  const [items, setItems] = useState<Record<string, Item>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const key = itemCodes.join("|");

  const load = useCallback(async () => {
    try {
      const all = await api<Item[]>("/api/items");
      const by = Object.fromEntries(all.map((i) => [i.item_code, i]));
      setItems(by);
      setDrafts(Object.fromEntries(itemCodes.map((c) => {
        const i = by[c];
        return [c, { invoice_name: i?.invoice_name || i?.description || "", hsn_code: i?.hsn_code || "", sale_rate: i?.sale_rate != null ? String(i.sale_rate) : "", gst_rate: String(i?.gst_rate ?? 18) }];
      })));
    } catch {
      // api() already toasted
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const missing = itemCodes.filter((c) => !ready(items[c]));
  useEffect(() => {
    onReady(Object.keys(items).length > 0 && missing.length === 0);
  }, [items, missing.length, onReady]);

  async function save(code: string) {
    const d = drafts[code];
    if (!d.sale_rate || !d.hsn_code.trim()) return showToast("Rate and HSN are required", "error");
    try {
      await api(`/api/items/${encodeURIComponent(code)}/invoice`, { method: "PUT", body: d });
      showToast(`Invoice details saved for ${code}`, "success");
      load();
    } catch {
      // api() already toasted
    }
  }
  const set = (code: string, patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [code]: { ...s[code], ...patch } }));

  if (!itemCodes.length) return null;
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", missing.length ? "border-warning/50 bg-warning/5" : "bg-muted/20")}>
      <div className="text-xs font-semibold">
        Invoice details for {BRAND.partnerStore}
        <span className="ml-1 font-normal text-muted-foreground">
          {missing.length ? `— ${missing.length} item(s) need a rate and HSN before they can move${canEdit ? "" : " (ask an admin or manager)"}` : "— saved on each reel when it moves"}
        </span>
      </div>
      {itemCodes.map((c) => {
        const d = drafts[c];
        const ok = ready(items[c]);
        if (!d) return null;
        const editing = canEdit && !ok;
        return (
          <div key={c} className="grid grid-cols-2 items-center gap-2 text-xs sm:grid-cols-[110px_1fr_90px_80px_60px_auto]">
            <div className="col-span-2 font-semibold sm:col-span-1">{c}</div>
            {editing ? (
              <>
                <Input className="col-span-2 h-8 text-xs sm:col-span-1" placeholder="Description on invoice" value={d.invoice_name} onChange={(e) => set(c, { invoice_name: e.target.value })} aria-label={`Invoice description for ${c}`} />
                <Input className="h-8 text-xs" placeholder="HSN" value={d.hsn_code} onChange={(e) => set(c, { hsn_code: e.target.value })} aria-label={`HSN for ${c}`} />
                <Input className="h-8 text-xs" type="number" step="0.01" min={0} placeholder="Rate" value={d.sale_rate} onChange={(e) => set(c, { sale_rate: e.target.value })} aria-label={`Rate for ${c}`} />
                <Input className="h-8 text-xs" type="number" step="0.01" min={0} placeholder="GST %" value={d.gst_rate} onChange={(e) => set(c, { gst_rate: e.target.value })} aria-label={`GST % for ${c}`} />
                <Button size="sm" className="h-8" onClick={() => save(c)}>Save</Button>
              </>
            ) : ok ? (
              <span className="col-span-2 text-muted-foreground sm:col-span-5">
                {items[c].invoice_name || items[c].description} · HSN {items[c].hsn_code} · ₹{items[c].sale_rate} · GST {items[c].gst_rate ?? 18}%
              </span>
            ) : (
              <span className="col-span-2 text-warning sm:col-span-5">Missing rate / HSN</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
