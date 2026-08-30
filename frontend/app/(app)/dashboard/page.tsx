"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate, formatQty } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { Download, FileDown, X } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { ChartCanvas } from "@/components/charts/ChartCanvas";
import { cn } from "@/lib/utils";

interface StockSummaryRow {
  item_code: string;
  description: string;
  default_spq: number;
  total_reels: number;
  in_stock_reels: number;
  total_quantity: number;
}
interface SearchResultRow {
  reel_number: string;
  item_code: string;
  quantity: number;
  status: string;
  inward_date: string;
  outward_history: { customer_name: string; invoice_number: string; outward_date: string }[];
}
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
interface DeadStockRow {
  item_code: string;
  description: string;
  in_stock_reels: number;
  total_quantity: number;
  last_outward_date: string | null;
  days_since_last_outward: number;
}
interface LowStockRow {
  item_code: string;
  description: string;
  in_stock_reels: number;
  total_quantity: number;
}
interface Analytics {
  monthlyTrends: { month: string; inwarded: number; outwarded: number }[];
  agingOutwarded: { item_code: string; avg_days_to_ship: number }[];
  velocity: { item_code: string; outward_count: number; total_shipped: number }[];
  topCustomers: CustomerRow[];
  inventoryTimeline: { month: string; quantity: number }[];
  agingInStock: AgingRow[];
  deadStock: DeadStockRow[];
  lowStock: LowStockRow[];
}
interface ItemTrendRow {
  month: string;
  inwarded: number;
  outwarded: number;
}

export default function DashboardPage() {
  const { selectedStore } = useSelectedStore();

  const [summary, setSummary] = useState<StockSummaryRow[]>([]);
  const [trendItem, setTrendItem] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<ItemTrendRow[]>([]);
  const trendCardRef = useRef<HTMLDivElement>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

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

  async function loadAnalytics() {
    try {
      const sp = storeQueryParam(selectedStore);
      setAnalytics(await api<Analytics>(`/api/dashboard/analytics${sp ? "?" + sp : ""}`));
    } catch {
      showToast("Failed to load analytics", "error");
    }
  }

  async function doSearch(page = 1, pageSize = 10, qVal = q, statusVal = status, fromVal = dateFrom, toVal = dateTo) {
    const active = !!(qVal.trim() || statusVal || fromVal || toVal);
    setSearchActive(active);
    if (!active) return;
    const params = new URLSearchParams();
    if (qVal.trim()) params.set("q", qVal.trim());
    if (statusVal) params.set("status", statusVal);
    if (fromVal) params.set("date_from", fromVal);
    if (toVal) params.set("date_to", toVal);
    const sp = storeQueryParam(selectedStore);
    if (sp) params.set("store", selectedStore);
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));
    try {
      const data = await api<{ rows: SearchResultRow[]; total: number }>(`/api/dashboard/search?${params}`);
      setResults(data.rows);
      setResultsTotal(data.total);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Data fetch reacting to the store selector — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (searchActive) doSearch(1, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  function onSearchInput(value: string) {
    setQ(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => doSearch(1, 10, value), 300);
  }

  function clearSearch() {
    setQ("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setSearchActive(false);
    setSelected(new Set());
  }

  function exportCSV() {
    // Exports exactly what the Search row currently shows — same filters as doSearch().
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const sp = storeQueryParam(selectedStore);
    if (sp) params.set("store", selectedStore);
    // Triggers a file download from the Express API, not a page navigation —
    // router.push()/redirect() don't apply here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/dashboard/export${params.toString() ? "?" + params : ""}`;
    showToast("CSV download started");
  }

  function exportStockCSV() {
    const sp = storeQueryParam(selectedStore);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/dashboard/export-stock${sp ? "?" + sp : ""}`;
    showToast("Stock export started");
  }

  async function deleteSelected() {
    if (!selected.size) return showToast("Select at least one reel", "error");
    const reelNumbers = [...selected];
    try {
      const preview = await api<{ total: number; in_stock: number; outwarded: number; already_deleted: number; total_quantity: number }>(
        "/api/dashboard/delete-preview",
        { method: "POST", body: { reel_numbers: reelNumbers } }
      );
      const confirmMsg = `You are about to delete ${preview.total} reel(s):\n\n• In Stock: ${preview.in_stock}\n• Outwarded: ${preview.outwarded}\n• Already Deleted: ${preview.already_deleted}\n• Total Quantity: ${formatQty(
        preview.total_quantity
      )}\n\nEnter password to confirm:`;
      const password = window.prompt(confirmMsg);
      if (!password) return;
      const result = await api<{ message: string }>("/api/dashboard/delete", { method: "POST", body: { reel_numbers: reelNumbers, password } });
      showToast(result.message);
      setSelected(new Set());
      doSearch(1, 10);
      loadSummary();
    } catch {
      // api() already toasted
    }
  }

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
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Search, trace, and export your inventory</p>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-4 text-center">
          <Stat label="Items" value={summary.length} />
          <Separator orientation="vertical" className="h-10" />
          <Stat label="Total Reels" value={totalReels} />
          <Separator orientation="vertical" className="h-10" />
          <Stat label="In Stock" value={inStockReels} />
          <Separator orientation="vertical" className="h-10" />
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

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-48 flex-1"
            autoComplete="off"
            placeholder="Search reel, item, customer, invoice, or box…"
            value={q}
            onChange={(e) => onSearchInput(e.target.value)}
          />
          <Select
            value={status || "all"}
            onValueChange={(v) => {
              const s = v === "all" ? "" : v;
              setStatus(s);
              doSearch(1, 10, q, s);
            }}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="In Stock">In Stock</SelectItem>
              <SelectItem value="Outwarded">Outwarded</SelectItem>
              <SelectItem value="Deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="w-auto"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              doSearch(1, 10, q, status, e.target.value);
            }}
          />
          <Input
            type="date"
            className="w-auto"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              doSearch(1, 10, q, status, dateFrom, e.target.value);
            }}
          />
          <Button variant="ghost" size="icon" title="Export filtered results as CSV" onClick={exportCSV}>
            <Download />
          </Button>
          <Button variant="ghost" size="icon" title="Export current stock summary as CSV" onClick={exportStockCSV}>
            <FileDown />
          </Button>
          <Button variant="ghost" size="icon" title="Clear filters" onClick={clearSearch}>
            <X />
          </Button>
        </div>
      </Card>

      {searchActive && (
        <Card className="p-5">
          <DataTable
            title="Results"
            mode="server"
            data={results}
            totalCount={resultsTotal}
            pageSize={10}
            onPageChange={(page, size) => doSearch(page, size)}
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
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.reel_number);
                        else next.delete(r.reel_number);
                        return next;
                      })
                    }
                  />
                ),
              },
              { label: "Reel", render: (r) => <strong>{r.reel_number}</strong> },
              { label: "Item", render: (r) => r.item_code },
              { label: "Qty", render: (r) => formatQty(r.quantity) },
              { label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { label: "Inwarded", render: (r) => formatDate(r.inward_date) },
              { label: "Customer", render: (r) => r.outward_history.at(-1)?.customer_name || "—" },
              { label: "Invoice", render: (r) => r.outward_history.at(-1)?.invoice_number || "—" },
              { label: "Outwarded", render: (r) => (r.outward_history.at(-1) ? formatDate(r.outward_history.at(-1)!.outward_date) : "—") },
            ]}
          />
          <Button variant="destructive" size="sm" className="mt-3" onClick={deleteSelected}>
            Delete Selected
          </Button>
        </Card>
      )}

      {analytics && (analytics.deadStock.length > 0 || analytics.lowStock.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-l-[3px] border-l-destructive p-5">
            <DataTable
              title="⚠️ Dead Stock — No Movement 30+ Days"
              data={analytics.deadStock}
              pageSize={5}
              getRowKey={(d) => d.item_code}
              columns={[
                { label: "Item", render: (d) => <strong>{d.item_code}</strong> },
                { label: "Description", render: (d) => d.description },
                { label: "In Stock", render: (d) => d.in_stock_reels },
                { label: "Qty", render: (d) => formatQty(d.total_quantity) },
                {
                  label: "Last Outward",
                  render: (d) => (
                    <span className="font-bold text-destructive">
                      {d.last_outward_date ? `${formatDate(d.last_outward_date)} (${d.days_since_last_outward}d ago)` : "Never sold"}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
          <Card className="border-l-[3px] border-l-warning p-5">
            <DataTable
              title="⚠️ Low Stock — Below 5 Reels"
              data={analytics.lowStock}
              pageSize={5}
              getRowKey={(l) => l.item_code}
              columns={[
                { label: "Item", render: (l) => <strong>{l.item_code}</strong> },
                { label: "Description", render: (l) => l.description },
                {
                  label: "Reels",
                  render: (l) => (
                    <span className={cn("font-bold", l.in_stock_reels === 0 ? "text-destructive" : l.in_stock_reels <= 2 ? "text-warning" : "")}>
                      {l.in_stock_reels || 0} reels
                    </span>
                  ),
                },
                { label: "Qty", render: (l) => formatQty(l.total_quantity || 0) },
              ]}
            />
          </Card>
        </div>
      )}

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="text-2xl font-bold">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
