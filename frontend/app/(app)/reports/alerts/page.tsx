"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate, formatQty } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table/DataTable";
import { cn } from "@/lib/utils";

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
interface Alerts {
  deadStock: DeadStockRow[];
  lowStock: LowStockRow[];
}

export default function AlertsPage() {
  const { selectedStore } = useSelectedStore();
  const [alerts, setAlerts] = useState<Alerts | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const sp = storeQueryParam(selectedStore);
        setAlerts(await api<Alerts>(`/api/dashboard/analytics${sp ? "?" + sp : ""}`));
      } catch {
        showToast("Failed to load alerts", "error");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [selectedStore]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Dead & Low Stock</h1>
        <p className="text-sm text-muted-foreground">Items needing attention — no movement, or running out</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-l-[3px] border-l-destructive p-5">
          <DataTable
            title="⚠️ Dead Stock — No Movement 30+ Days"
            data={alerts?.deadStock || []}
            pageSize={10}
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
            data={alerts?.lowStock || []}
            pageSize={10}
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
    </div>
  );
}
