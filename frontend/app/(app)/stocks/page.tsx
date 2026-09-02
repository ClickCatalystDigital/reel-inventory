"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/data-table/DataTable";

interface Store {
  code: string;
  name: string;
}
interface StockSummaryRow {
  item_code: string;
  description: string;
  default_spq: number;
  total_reels: number;
  in_stock_reels: number;
  total_quantity: number;
}

// gelco_manager's own Stock Summary view — same data/shape as Reports > Stock
// Summary, but with its own store dropdown (LS Stores / Gelco Stores), since
// the global top-nav selector is locked to Gelco Stores for this role and
// Reports itself is outside their page allowlist. Lets them see either
// store's stock to decide what to order.
export default function StocksPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [store, setStore] = useState("secondary");
  const [summary, setSummary] = useState<StockSummaryRow[]>([]);

  useEffect(() => {
    api<Store[]>("/api/stores").then(setStores).catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await api<StockSummaryRow[]>(`/api/dashboard/stock-summary?store=${encodeURIComponent(store)}`);
        data.sort((a, b) => a.item_code.localeCompare(b.item_code));
        setSummary(data);
      } catch {
        // api() already toasted
      }
    }
    load();
  }, [store]);

  const totalReels = summary.reduce((s, i) => s + (i.total_reels || 0), 0);
  const inStockReels = summary.reduce((s, i) => s + (i.in_stock_reels || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Stocks</h1>
          <p className="text-sm text-muted-foreground">Per-item stock levels — pick a store to see what to order</p>
        </div>
        <select
          className="h-9 rounded-md border border-border bg-secondary px-2 text-xs text-secondary-foreground"
          value={store}
          onChange={(e) => setStore(e.target.value)}
        >
          {stores.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <Card className="p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 text-center sm:flex sm:items-center">
          <Stat label="Items" value={summary.length} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Total Reels" value={totalReels} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="In Stock" value={inStockReels} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Outwarded" value={totalReels - inStockReels} />
        </div>
        <DataTable
          title="Stock by Item"
          data={summary}
          pageSize={10}
          getRowKey={(s) => s.item_code}
          columns={[
            { label: "Item Code", render: (s) => <strong>{s.item_code}</strong> },
            { label: "Description", render: (s) => s.description },
            { label: "SPQ", render: (s) => formatQty(s.default_spq) },
            { label: "In Stock Reels", render: (s) => s.in_stock_reels || 0 },
            { label: "Total Qty", render: (s) => formatQty(s.total_quantity || 0) },
          ]}
        />
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="text-2xl font-bold">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
