"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table/DataTable";
import { ChartCanvas } from "@/components/charts/ChartCanvas";
import { cn } from "@/lib/utils";

interface AgingRow {
  reel_number: string;
  item_code: string;
  days_in_stock: number;
}
interface CustomerRow {
  customer_name: string;
  reel_count: number;
  total_quantity: number;
  invoice_count: number;
}
interface Analytics {
  monthlyTrends: { month: string; inwarded: number; outwarded: number }[];
  agingOutwarded: { item_code: string; avg_days_to_ship: number }[];
  velocity: { item_code: string; outward_count: number; total_shipped: number }[];
  topCustomers: CustomerRow[];
  inventoryTimeline: { month: string; quantity: number }[];
  agingInStock: AgingRow[];
}

export default function AnalyticsPage() {
  const { selectedStore } = useSelectedStore();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function loadAnalytics() {
    try {
      const sp = storeQueryParam(selectedStore);
      setAnalytics(await api<Analytics>(`/api/dashboard/analytics${sp ? "?" + sp : ""}`));
    } catch {
      showToast("Failed to load analytics", "error");
    }
  }

  useEffect(() => {
    // Data fetch reacting to the store selector (and on mount) — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Trends, velocity, and aging across your inventory</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly Inward vs Outward</div>
          {analytics && (
            <ChartCanvas
              config={{
                type: "bar",
                data: {
                  labels: analytics.monthlyTrends.map((m) => m.month),
                  datasets: [
                    { label: "Inwarded", data: analytics.monthlyTrends.map((m) => m.inwarded), backgroundColor: "#16a34a" },
                    { label: "Outwarded", data: analytics.monthlyTrends.map((m) => m.outwarded), backgroundColor: "#dc2626" },
                  ],
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: "top" } } },
              }}
            />
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inventory Over Time</div>
          {analytics && (
            <ChartCanvas
              config={{
                type: "line",
                data: {
                  labels: analytics.inventoryTimeline.map((m) => m.month),
                  datasets: [
                    {
                      label: "Cumulative Inventory",
                      data: analytics.inventoryTimeline.map((m) => m.quantity),
                      borderColor: "#2563eb",
                      backgroundColor: "rgba(37, 99, 235, 0.1)",
                      fill: true,
                      tension: 0.3,
                    },
                  ],
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } },
              }}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item Velocity — Last 90 Days</div>
          {analytics && (
            <ChartCanvas
              config={{
                type: "bar",
                data: {
                  labels: analytics.velocity.map((v) => v.item_code),
                  datasets: [
                    { label: "Reels Shipped", data: analytics.velocity.map((v) => v.outward_count), backgroundColor: "#2563eb" },
                    { label: "Qty Shipped", data: analytics.velocity.map((v) => v.total_shipped), backgroundColor: "#93c5fd" },
                  ],
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: "top" } } },
              }}
            />
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg Days to Ship (by Item)</div>
          {analytics && (
            <ChartCanvas
              config={{
                type: "bar",
                data: {
                  labels: analytics.agingOutwarded.map((a) => a.item_code),
                  datasets: [{ label: "Avg Days to Ship", data: analytics.agingOutwarded.map((a) => a.avg_days_to_ship), backgroundColor: "#d97706" }],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: "y",
                  scales: { x: { beginAtZero: true } },
                  plugins: { legend: { display: false } },
                },
              }}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <DataTable
            title="Stock Aging — Oldest In-Stock Reels"
            data={analytics?.agingInStock || []}
            pageSize={5}
            getRowKey={(r) => r.reel_number}
            columns={[
              { label: "Reel", render: (r) => <strong>{r.reel_number}</strong> },
              { label: "Item", render: (r) => r.item_code },
              {
                label: "Days in Stock",
                render: (r) => (
                  <span className={cn("font-bold", r.days_in_stock > 30 ? "text-destructive" : r.days_in_stock > 14 ? "text-warning" : "text-success")}>
                    {r.days_in_stock} days
                  </span>
                ),
              },
            ]}
          />
        </Card>
        <Card className="p-5">
          <DataTable
            title="Top Customers"
            data={analytics?.topCustomers || []}
            pageSize={5}
            getRowKey={(c) => c.customer_name}
            columns={[
              { label: "Customer", render: (c) => <strong>{c.customer_name}</strong> },
              { label: "Reels", render: (c) => c.reel_count },
              { label: "Quantity", render: (c) => formatQty(c.total_quantity) },
              { label: "Invoices", render: (c) => c.invoice_count },
            ]}
          />
        </Card>
      </div>

      <Card className="p-5">
        <div
          className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          onClick={() => setHelpOpen((v) => !v)}
        >
          ℹ️ How Analytics Are Calculated <span className="float-right text-[10px]">click to expand</span>
        </div>
        {helpOpen && (
          <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong>Dead Stock (30+ days)</strong> — Items that have reels in stock but no outward in the last 30 days. If an item was never
              outwarded, it shows &quot;Never sold&quot;. Calculated by comparing today&apos;s date with the most recent outward date per item.
            </p>
            <p>
              <strong>Low Stock (below 5 reels)</strong> — Items with fewer than 5 reels currently in stock. Red = 0 reels (out of stock), Yellow =
              1-2 reels (critical), Normal = 3-4 reels (low). Threshold is 5 reels.
            </p>
            <p>
              <strong>Monthly Inward vs Outward</strong> — Count of reels inwarded and outwarded each month for the last 12 months. Helps spot if
              you&apos;re stocking more than you&apos;re selling or vice versa.
            </p>
            <p>
              <strong>Inventory Over Time</strong> — Running total of inventory quantity (inwards minus outwards) over the last 12 months. Shows if
              your overall stock is growing or shrinking.
            </p>
            <p>
              <strong>Item Velocity (90 days)</strong> — How many reels and total quantity shipped per item in the last 90 days. Items on the right
              move fastest. Items missing from the chart had zero outwards.
            </p>
            <p>
              <strong>Avg Days to Ship</strong> — For outwarded reels, the average number of days between inward date and outward date, grouped by
              item. Higher = slower moving stock.
            </p>
            <p>
              <strong>Stock Aging</strong> — The 20 oldest reels currently in stock, sorted by how many days they&apos;ve been sitting. Green =
              under 14 days, Yellow = 14-30 days, Red = over 30 days.
            </p>
            <p>
              <strong>Top Customers</strong> — Customers ranked by total quantity shipped across all their invoices.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
