"use client";

import { cn } from "@/lib/utils";
import { LINE_STATUSES, PO_STAGES, PO_STAGE_HINT } from "@/lib/po-stages";

const TONE: Record<string, string> = {
  "Not planned": "border-dashed text-muted-foreground",
  Ready: "border-success/40 bg-success/10 text-success",
  Dispatch: "border-foreground/30 bg-foreground/5",
  Completed: "border-success bg-success text-white",
};

// A line's / PO's derived status (utils/poProgress.js).
export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  return (
    <span title={PO_STAGE_HINT[stage]} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[stage] || "border-warning/40 bg-warning/10 text-warning", className)}>
      {stage}
    </span>
  );
}

// The stages as a row of steps (customer portal).
export function StageSteps({ stage, compact }: { stage: string | null; compact?: boolean }) {
  const at = stage ? LINE_STATUSES.indexOf(stage as (typeof LINE_STATUSES)[number]) - 1 : -1;
  return (
    <ol className={cn("grid gap-1", compact ? "grid-cols-8" : "grid-cols-4 sm:grid-cols-8")}>
      {PO_STAGES.map((s, i) => (
        <li key={s} className="space-y-1" title={s}>
          <div className={cn("h-1 rounded-full", i <= at ? "bg-foreground" : "bg-muted")} />
          {!compact && <div className={cn("text-[10px] leading-tight", i === at ? "font-semibold" : "text-muted-foreground")}>{s}</div>}
        </li>
      ))}
    </ol>
  );
}
