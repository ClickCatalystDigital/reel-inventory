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
import { StatusBadge } from "@/components/ui/status-badge";
import { Download, FileDown, X } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";

interface SearchResultRow {
  reel_number: string;
  item_code: string;
  quantity: number;
  status: string;
  inward_date: string;
  outward_history: { customer_name: string; invoice_number: string; outward_date: string }[];
}

export default function SearchTracePage() {
  const { selectedStore } = useSelectedStore();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } catch {
      // api() already toasted
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Search & Trace</h1>
        <p className="text-sm text-muted-foreground">Search, trace, and export your inventory</p>
      </div>

      <Card className="space-y-3 p-5">
        <Input
          className="w-full"
          autoComplete="off"
          placeholder="Search reel, item, customer, invoice, or box…"
          value={q}
          onChange={(e) => onSearchInput(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status || "all"}
            onValueChange={(v) => {
              const s = v === "all" ? "" : v;
              setStatus(s);
              doSearch(1, 10, q, s);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-36">
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
            className="w-full sm:w-auto"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              doSearch(1, 10, q, status, e.target.value);
            }}
          />
          <Input
            type="date"
            className="w-full sm:w-auto"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              doSearch(1, 10, q, status, dateFrom, e.target.value);
            }}
          />
          <div className="flex items-center gap-1 sm:ml-auto">
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
    </div>
  );
}
