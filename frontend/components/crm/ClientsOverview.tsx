import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { capitalize, PIPELINE_STAGES, type Metrics } from "@/lib/crm";

const BAR: Record<string, string> = {
  new: "bg-muted-foreground/40",
  contacted: "bg-primary",
  qualified: "bg-warning",
  customer: "bg-success",
  lost: "bg-destructive",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

// KPI boxes + pipeline-by-stage bars (GET /api/clients/meta/metrics).
export function ClientsOverview({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <Skeleton className="h-28 w-full" />;
  const max = Math.max(1, ...PIPELINE_STAGES.map((s) => metrics.byStatus[s] || 0));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Stat label="Total contacts" value={metrics.total} />
      <Stat label="Qualified" value={metrics.qualified} />
      <Stat label="Customers" value={metrics.customers} />
      <Stat label="Conversion" value={`${metrics.conversion}%`} />
      <Card className="col-span-2 gap-2 p-4">
        <p className="text-xs text-muted-foreground">Pipeline by stage</p>
        <div className="space-y-1">
          {PIPELINE_STAGES.map((s) => {
            const n = metrics.byStatus[s] || 0;
            return (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-muted-foreground">{capitalize(s)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${BAR[s]}`} style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <span className="w-5 text-right tabular-nums">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
