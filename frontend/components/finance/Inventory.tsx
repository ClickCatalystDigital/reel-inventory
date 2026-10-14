"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { INR } from "@/lib/finance";
import { FinCard } from "./bits";

interface StockItem { name: string; parent: string | null; base_units: string | null; closing_qty: string | null; closing_rate: string | null; hsn_code: string | null; gst_applicable: string | null }

const qty = (s: string | null) => parseFloat(s || "0");
const parseQty = (s: string | null) => Math.max(0, parseFloat((s || "").split(" ")[0]) || 0);
const parseRate = (s: string | null) => parseFloat((s || "").split("/")[0]) || 0;

// Tally's stock items (not this app's reels): valuation, negative-stock alert, search.
export function Inventory() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");

  useEffect(() => {
    api<StockItem[]>("/api/finance/inventory").then(setItems).catch(() => {});
  }, []);

  const groups = useMemo(() => [...new Set(items.map((i) => i.parent).filter((g): g is string => !!g))].sort(), [items]);
  const shown = useMemo(() => {
    const t = q.toLowerCase().trim();
    return items.filter((i) => (!t || (i.name || "").toLowerCase().includes(t) || (i.parent || "").toLowerCase().includes(t)) && (!group || i.parent === group));
  }, [items, q, group]);
  const neg = items.filter((i) => qty(i.closing_qty) < 0).length;
  const { byGroup, totalVal } = useMemo(() => {
    const g: Record<string, number> = {};
    let total = 0;
    for (const i of items) {
      if (!i.parent) continue;
      const v = parseQty(i.closing_qty) * parseRate(i.closing_rate);
      g[i.parent] = (g[i.parent] || 0) + v;
      total += v;
    }
    return { byGroup: Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 8), totalVal: total };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input type="search" placeholder="Search item name or group…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[120px] flex-1 sm:max-w-xs" />
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 max-w-[200px] rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Group">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      {neg > 0 && (
        <FinCard title="⚠ Negative Stock Alert" tip="Items with negative closing quantity. These must be corrected in Tally before dispatching more — negative stock means consumption entries exist without matching purchase receipts." className="border-l-4 border-l-warning">
          <p className="text-xs text-muted-foreground">
            {neg} item{neg > 1 ? "s have" : " has"} negative closing quantity — possible data entry issue in Tally. Likely cause: outward entries (sales/production) recorded before matching inward purchase receipts were posted.
          </p>
        </FinCard>
      )}

      {totalVal > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <FinCard title="Stock Valuation by Group" tip="Total inventory value (qty × rate) per product group. Shows how much working capital is tied up in stock — use when negotiating payment terms with suppliers or planning purchases.">
            {byGroup.map(([g, v]) => <ValRow key={g} label={g} value={INR(v)} />)}
          </FinCard>
          <FinCard title="Summary" tip="Negative stock count and total positive stock value. Negative items must be fixed in Tally — they block accurate valuation and can cause dispatch errors.">
            <ValRow label="Total stock value" value={INR(totalVal)} />
            <ValRow label="Negative qty items" value={neg} danger />
            <ValRow label="Total items" value={items.length} />
          </FinCard>
        </div>
      )}

      <FinCard tip="Live inventory from Tally. Negative quantities (red) = dispatch risk. Use before quoting a customer to confirm stock is available. Cross-check with active POs if an item is low.">
        <DataTable
          title="Stock Items"
          data={shown}
          pageSize={20}
          getRowKey={(i) => i.name}
          columns={[
            { label: "Item", render: (i) => <strong>{i.name}</strong> },
            { label: "Group", render: (i) => <span className="text-xs text-muted-foreground">{i.parent || "—"}</span>, className: "hidden md:table-cell" },
            { label: "UOM", render: (i) => i.base_units || "—", className: "hidden sm:table-cell" },
            { label: "Closing Qty", render: (i) => <span className={qty(i.closing_qty) < 0 ? "font-bold text-destructive" : ""}>{i.closing_qty || "0"}</span> },
            { label: "Rate", render: (i) => i.closing_rate || "—", className: "hidden sm:table-cell" },
            { label: "HSN", render: (i) => i.hsn_code || "—", className: "hidden lg:table-cell" },
            { label: "GST", render: (i) => ((i.gst_applicable || "").trim() === "Applicable" ? <Badge className="bg-success text-white">Applicable</Badge> : <span className="text-xs text-muted-foreground">{(i.gst_applicable || "").trim() || "—"}</span>), className: "hidden lg:table-cell" },
          ]}
        />
      </FinCard>
    </div>
  );
}

function ValRow({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`flex justify-between border-b py-2 text-xs last:border-b-0 ${danger ? "text-destructive" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
