"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PO_STAGES, PO_STAGE_HINT } from "@/lib/po-stages";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";

// PO stage dropdown; read-only text for roles that can't edit.
export function StageSelect({ poId, stage, canEdit, onChanged }: { poId: number; stage: string | null; canEdit: boolean; onChanged: () => void }) {
  if (!canEdit) return <span className="text-sm">{stage ?? <span className="text-muted-foreground">Not set</span>}</span>;
  async function change(v: string) {
    try {
      await api(`/api/orders/${poId}/stage`, { method: "PUT", body: { stage: v } });
      showToast(`Stage set to ${v}`, "success");
      onChanged();
    } catch {
      // api() already toasted
    }
  }
  return (
    <Select value={stage ?? undefined} onValueChange={change}>
      <SelectTrigger size="sm" className="w-[190px]" onClick={(e) => e.stopPropagation()}>
        <SelectValue placeholder="Not set" />
      </SelectTrigger>
      <SelectContent>
        {PO_STAGES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
            {PO_STAGE_HINT[s] && <span className="text-muted-foreground"> ({PO_STAGE_HINT[s]})</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Customer-facing progress: the 8 stages as a row of steps.
export function StageSteps({ stage }: { stage: string | null }) {
  const at = stage ? PO_STAGES.indexOf(stage as (typeof PO_STAGES)[number]) : -1;
  return (
    <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
      {PO_STAGES.map((s, i) => (
        <li key={s} className="space-y-1">
          <div className={i <= at ? "h-1.5 rounded-full bg-foreground" : "h-1.5 rounded-full bg-muted"} />
          <div className={i === at ? "text-[11px] font-semibold" : "text-[11px] text-muted-foreground"}>{s}</div>
        </li>
      ))}
    </ol>
  );
}
