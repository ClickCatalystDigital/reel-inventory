"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatQty, formatDateTime } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/DataTable";

interface OutwardEvent {
  id: number;
  reel_number: string;
  box_number: string | null;
  item_code: string;
  customer_name: string;
  invoice_number: string;
  quantity_shipped: number;
  outward_type: "Full" | "Partial";
  outward_date: string;
}

export default function NotificationsPage() {
  const { selectedStore } = useSelectedStore();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<OutwardEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  async function loadNotifications(page = 1, size = pageSize, from = dateFrom, to = dateTo) {
    const params = new URLSearchParams();
    params.set("limit", String(size));
    params.set("offset", String((page - 1) * size));
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    const sp = storeQueryParam(selectedStore);
    if (sp) params.set("store", selectedStore);
    try {
      const data = await api<{ rows: OutwardEvent[]; total: number }>(`/api/outward/recent?${params}`);
      setRows(data.rows);
      setTotal(data.total);
      setPageSize(size);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch reacting to the store selector — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Notifications</h1>
        <p className="text-sm text-muted-foreground">Every outward event, with timestamp and date filtering</p>
      </div>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filter</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>From Date</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To Date</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => loadNotifications(1, pageSize)}>Apply</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              loadNotifications(1, pageSize, "", "");
            }}
          >
            Clear
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <DataTable
          title="Outward Events"
          mode="server"
          data={rows}
          totalCount={total}
          pageSize={pageSize}
          onPageChange={(page, size) => loadNotifications(page, size)}
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
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium",
                    o.outward_type === "Full"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-warning/10 text-warning"
                  )}
                >
                  {o.outward_type}
                </span>
              ),
            },
            { label: "Date & Time", render: (o) => formatDateTime(o.outward_date) },
          ]}
        />
      </Card>
    </div>
  );
}
