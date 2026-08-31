"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/data-table/DataTable";
import { ChartCanvas } from "@/components/charts/ChartCanvas";

interface StockSummaryRow {
  item_code: string;
  description: string;
  default_spq: number;
  total_reels: number;
  in_stock_reels: number;
  total_quantity: number;
}
interface ItemTrendRow {
  month: string;
  inwarded: number;
  outwarded: number;
}

export default function StockSummaryPage() {
  const { selectedStore } = useSelectedStore();

  const [summary, setSummary] = useState<StockSummaryRow[]>([]);
  const [trendItem, setTrendItem] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<ItemTrendRow[]>([]);
  const trendCardRef = useRef<HTMLDivElement>(null);

  async function loadSummary() {
    try {
      const sp = storeQueryParam(selectedStore);
      const data = await api<StockSummaryRow[]>(`/api/dashboard/stock-summary${sp ? "?" + sp : ""}`);
      data.sort((a, b) => a.item_code.localeCompare(b.item_code));
      setSummary(data);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch reacting to the store selector (and on mount) — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  async function showItemTrend(itemCode: string) {
    try {
      const sp = storeQueryParam(selectedStore);
      setTrendData(await api<ItemTrendRow[]>(`/api/dashboard/item-trend?item_code=${itemCode}${sp ? "&" + sp : ""}`));
      setTrendItem(itemCode);
      setTimeout(() => trendCardRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch {
      // api() already toasted
    }
  }

  const totalReels = summary.reduce((s, i) => s + (i.total_reels || 0), 0);
  const inStockReels = summary.reduce((s, i) => s + (i.in_stock_reels || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Stock Summary</h1>
        <p className="text-sm text-muted-foreground">Per-item stock levels across your inventory</p>
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
          pageSize={5}
          getRowKey={(s) => s.item_code}
          columns={[
            {
              label: "Item Code",
              render: (s) => (
                <strong className="cursor-pointer text-primary" onClick={() => showItemTrend(s.item_code)}>
                  {s.item_code}
                </strong>
              ),
            },
            { label: "Description", render: (s) => s.description },
            { label: "SPQ", render: (s) => formatQty(s.default_spq) },
            { label: "In Stock Reels", render: (s) => s.in_stock_reels || 0 },
            { label: "Total Qty", render: (s) => formatQty(s.total_quantity || 0) },
          ]}
        />
      </Card>

      {trendItem && (
        <div ref={trendCardRef}>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Selling Trend — {trendItem}
              <button className="cursor-pointer text-sm" onClick={() => setTrendItem(null)}>
                ✕
              </button>
            </div>
            <ChartCanvas
              config={{
                type: "bar",
                data: {
                  labels: trendData.map((d) => d.month),
                  datasets: [
                    { label: "Inwarded", data: trendData.map((d) => d.inwarded), backgroundColor: "#16a34a" },
                    { label: "Outwarded", data: trendData.map((d) => d.outwarded), backgroundColor: "#dc2626" },
                  ],
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: "top" } } },
              }}
            />
          </Card>
        </div>
      )}
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
