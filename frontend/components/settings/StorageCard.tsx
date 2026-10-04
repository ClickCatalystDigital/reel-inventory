"use client";

import { useEffect, useState } from "react";
import type { ChartConfiguration } from "chart.js";
import { api } from "@/lib/api";
import { formatBytes, formatQty } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table/DataTable";
import { ChartCanvas } from "@/components/charts/ChartCanvas";

interface UsageItem {
  name: string;
  category: string;
  bytes: number;
  rows?: number | null; // Turso tables
  objects?: number; // R2 prefixes
}
interface Usage {
  available?: boolean; // Turso only
  configured?: boolean; // R2 only
  error?: string;
  total_bytes?: number;
  items?: UsageItem[];
}
interface StorageResponse {
  turso: Usage;
  r2: Usage;
}

// One fixed colour per category, shared by the bar, the pie, the legend dots and the table.
const COLORS: Record<string, string> = {
  Reels: "#2563eb",
  Outwards: "#16a34a",
  Transfers: "#f59e0b",
  "Items & boxes": "#8b5cf6",
  Other: "#94a3b8",
  "CRM (shared)": "#ec4899",
  "Inventory docs": "#2563eb",
  "CRM files": "#ec4899",
};
const colorOf = (category: string) => COLORS[category] ?? "#94a3b8";

function Dot({ category }: { category: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: colorOf(category) }} />;
}

// Apple-style storage panel: stacked colour bar + legend on the left, pie on the right, table below.
function UsagePanel({ usage, countLabel }: { usage: Usage; countLabel: string }) {
  const items = usage.items ?? [];
  const total = usage.total_bytes ?? 0;

  const byCategory = Object.entries(
    items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.category]: (acc[i.category] ?? 0) + i.bytes }), {})
  )
    .map(([category, bytes]) => ({ category, bytes }))
    .filter((c) => c.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return (
    <div className="space-y-5">
      <div className="grid items-center gap-5 md:grid-cols-[1fr_180px]">
        <div>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{formatBytes(total)}</span>
            <span className="text-sm text-muted-foreground">used</span>
          </div>
          <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {total > 0 &&
              byCategory.map((c) => (
                <div
                  key={c.category}
                  title={`${c.category} — ${formatBytes(c.bytes)}`}
                  className="h-full min-w-[3px] first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(c.bytes / total) * 100}%`, background: colorOf(c.category) }}
                />
              ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {byCategory.map((c) => (
              <span key={c.category} className="flex items-center gap-1.5">
                <Dot category={c.category} />
                <span className="text-foreground">{c.category}</span>
                <span className="text-muted-foreground">{formatBytes(c.bytes)}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[180px]">
          {total > 0 && (
            <ChartCanvas
              height={180}
              config={
                {
                type: "doughnut",
                data: {
                  labels: byCategory.map((c) => c.category),
                  datasets: [{ data: byCategory.map((c) => c.bytes), backgroundColor: byCategory.map((c) => colorOf(c.category)), borderWidth: 0 }],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: "62%",
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx: { label: string; parsed: number }) => ` ${ctx.label}: ${formatBytes(ctx.parsed)}` } },
                  },
                },
                // ChartCanvas takes the untyped ChartConfiguration; `cutout` only exists on the doughnut typing.
                } as unknown as ChartConfiguration
              }
            />
          )}
        </div>
      </div>

      <DataTable
        title="Breakdown"
        data={items}
        pageSize={8}
        getRowKey={(i) => i.name}
        columns={[
          {
            label: "Name",
            render: (i) => (
              <span className="flex items-center gap-2">
                <Dot category={i.category} />
                <strong>{i.name}</strong>
              </span>
            ),
          },
          { label: "Category", render: (i) => i.category },
          { label: countLabel, render: (i) => (i.rows ?? i.objects) == null ? "—" : formatQty(i.rows ?? i.objects) },
          { label: "Size", render: (i) => formatBytes(i.bytes) },
          { label: "%", render: (i) => (total ? `${((i.bytes / total) * 100).toFixed(1)}%` : "—") },
        ]}
      />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function StorageCard() {
  const [data, setData] = useState<StorageResponse | null>(null);

  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    api<StorageResponse>("/api/settings/storage")
      .then(setData)
      .catch(() => {
        // api() already toasted
      });
  }, []);

  const { turso, r2 } = data ?? {};

  return (
    <Card className="p-5">
      <Tabs defaultValue="turso">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Storage</div>
          <TabsList>
            <TabsTrigger value="turso">Turso</TabsTrigger>
            <TabsTrigger value="r2">Cloudflare R2</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="turso" className="mt-3">
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : turso?.available ? (
            <UsagePanel usage={turso} countLabel="Rows" />
          ) : (
            <Notice>Database size isn&apos;t available on this database ({turso?.error ?? "unknown error"}).</Notice>
          )}
        </TabsContent>

        <TabsContent value="r2" className="mt-3">
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : !r2?.configured ? (
            <Notice>Cloudflare R2 isn&apos;t configured on this server.</Notice>
          ) : r2.error ? (
            <Notice>Couldn&apos;t read R2 usage ({r2.error}).</Notice>
          ) : (
            <UsagePanel usage={r2} countLabel="Objects" />
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
