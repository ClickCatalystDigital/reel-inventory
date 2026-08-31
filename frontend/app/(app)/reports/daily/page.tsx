"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatQty, formatDateTime } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/data-table/DataTable";
import { FileDown } from "lucide-react";

interface ItemQty {
  item_code: string;
  reel_count: number;
  total_qty: number;
}
interface TransferRow {
  reel_number: string | null;
  box_number: string | null;
  from_store: string;
  to_store: string;
  from_store_name: string | null;
  to_store_name: string | null;
  quantity: number;
  transferred_by: string;
  transferred_at: string;
}
interface DailyReport {
  date: string;
  inward: ItemQty[];
  outward: ItemQty[];
  transfers: TransferRow[];
  deadStock: { item_code: string; description: string }[];
  lowStock: { item_code: string; description: string; in_stock_reels: number }[];
  pendingApprovals: number;
}

export default function DailyReportPage() {
  const { selectedStore } = useSelectedStore();
  const [report, setReport] = useState<DailyReport | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const sp = storeQueryParam(selectedStore);
        setReport(await api<DailyReport>(`/api/dashboard/daily-report${sp ? "?" + sp : ""}`));
      } catch {
        showToast("Failed to load daily report", "error");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [selectedStore]);

  function downloadPDF() {
    const sp = storeQueryParam(selectedStore);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/labels/daily-report${sp ? "?" + sp : ""}`;
    showToast("PDF download started");
  }

  const inwardReels = report?.inward.reduce((s, r) => s + (r.reel_count || 0), 0) || 0;
  const inwardQty = report?.inward.reduce((s, r) => s + (r.total_qty || 0), 0) || 0;
  const outwardReels = report?.outward.reduce((s, r) => s + (r.reel_count || 0), 0) || 0;
  const outwardQty = report?.outward.reduce((s, r) => s + (r.total_qty || 0), 0) || 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Daily Report</h1>
          <p className="text-sm text-muted-foreground">Today&apos;s key numbers{report ? ` — ${report.date}` : ""}</p>
        </div>
        <Button variant="outline" size="sm" onClick={downloadPDF}>
          <FileDown /> Download PDF
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 text-center sm:flex sm:items-center">
          <Stat label="Inward Reels" value={inwardReels} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Inward Qty" value={inwardQty} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Outward Reels" value={outwardReels} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Outward Qty" value={outwardQty} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Transfers" value={report?.transfers.length || 0} />
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <Stat label="Pending Approvals" value={report?.pendingApprovals || 0} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <DataTable
            title="Inward Today"
            data={report?.inward || []}
            pageSize={10}
            getRowKey={(r) => r.item_code}
            columns={[
              { label: "Item", render: (r) => <strong>{r.item_code}</strong> },
              { label: "Reels", render: (r) => r.reel_count },
              { label: "Qty", render: (r) => formatQty(r.total_qty || 0) },
            ]}
          />
        </Card>
        <Card className="p-5">
          <DataTable
            title="Outward Today"
            data={report?.outward || []}
            pageSize={10}
            getRowKey={(r) => r.item_code}
            columns={[
              { label: "Item", render: (r) => <strong>{r.item_code}</strong> },
              { label: "Reels", render: (r) => r.reel_count },
              { label: "Qty", render: (r) => formatQty(r.total_qty || 0) },
            ]}
          />
        </Card>
      </div>

      <Card className="p-5">
        <DataTable
          title="Transfers Today"
          data={report?.transfers || []}
          pageSize={10}
          getRowKey={(t) => `${t.reel_number || t.box_number}-${t.transferred_at}`}
          columns={[
            { label: "Item", render: (t) => <strong>{t.reel_number || t.box_number}</strong> },
            { label: "From", render: (t) => t.from_store_name || t.from_store },
            { label: "To", render: (t) => t.to_store_name || t.to_store },
            { label: "Qty", render: (t) => formatQty(t.quantity) },
            { label: "By", render: (t) => t.transferred_by },
            { label: "At", render: (t) => formatDateTime(t.transferred_at) },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-l-[3px] border-l-destructive p-5">
          <DataTable
            title={`⚠️ Dead Stock (${report?.deadStock.length || 0})`}
            data={report?.deadStock || []}
            pageSize={5}
            getRowKey={(d) => d.item_code}
            columns={[
              { label: "Item", render: (d) => <strong>{d.item_code}</strong> },
              { label: "Description", render: (d) => d.description },
            ]}
          />
        </Card>
        <Card className="border-l-[3px] border-l-warning p-5">
          <DataTable
            title={`⚠️ Low Stock (${report?.lowStock.length || 0})`}
            data={report?.lowStock || []}
            pageSize={5}
            getRowKey={(l) => l.item_code}
            columns={[
              { label: "Item", render: (l) => <strong>{l.item_code}</strong> },
              { label: "Description", render: (l) => l.description },
              { label: "Reels", render: (l) => l.in_stock_reels || 0 },
            ]}
          />
        </Card>
      </div>
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
