"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/format";
import { docTypeLabel, type PoDetail } from "@/lib/po-stages";
import { StageBadge, StageSteps } from "./StageSelect";

// Customer portal: the caller's own POs (server scopes by user_companies): status per PO and per line
// (tap a line for its steps), planned shipments and documents.
export function PortalOrders() {
  const [pos, setPos] = useState<PoDetail[] | null>(null);
  const [open, setOpen] = useState<number | null>(null); // line showing its stage steps
  useEffect(() => {
    api<PoDetail[]>("/api/portal/orders").then(setPos).catch(() => setPos([]));
  }, []);

  if (pos === null) return <Card className="p-5 text-sm text-muted-foreground">Loading…</Card>;
  if (pos.length === 0) return <Card className="p-5 text-sm text-muted-foreground">No orders yet</Card>;

  return (
    <div className="space-y-3">
      {pos.map((po) => (
        <Card key={po.id} className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-bold">PO {po.po_number}</div>
              <div className="text-xs text-muted-foreground">
                {[po.order_date && `Ordered ${formatDate(po.order_date)}`, po.expected_dispatch_date && `Expected ${formatDate(po.expected_dispatch_date)}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <StageBadge stage={po.stage} />
          </div>

          <StageSteps stage={po.stage} />

          <div className="divide-y rounded-lg border">
            {po.lines.map((l) => {
              const pct = l.ordered ? Math.min(100, Math.round((l.dispatched / l.ordered) * 100)) : 0;
              const isOpen = open === l.id;
              return (
                <button key={l.id} onClick={() => setOpen(isOpen ? null : l.id)} className="block w-full space-y-2 p-3 text-left hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{l.item_code}</div>
                      {l.description && <div className="truncate text-xs text-muted-foreground">{l.description}</div>}
                    </div>
                    <StageBadge stage={l.status} />
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} /></div>
                  <div className="flex flex-wrap justify-between gap-x-4 text-[11px] text-muted-foreground">
                    <span>{formatQty(l.dispatched)} of {formatQty(l.ordered)} dispatched{l.reserved > 0 && l.status !== "Completed" ? ` · ${formatQty(l.reserved)} ready` : ""}</span>
                    {l.expected_date && !["Ready", "Dispatch", "Completed"].includes(l.status) && <span>Expected {formatDate(l.expected_date)}</span>}
                  </div>
                  {isOpen && <div className="pt-1"><StageSteps stage={l.status} /></div>}
                </button>
              );
            })}
          </div>

          {po.dispatches.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned shipments</div>
              {po.dispatches.map((d) => (
                <div key={d.id} className="flex justify-between gap-3 text-sm">
                  <span><strong>{d.item_code}</strong> × {formatQty(d.quantity)}</span>
                  <span className="text-muted-foreground">{d.dispatch_date ? formatDate(d.dispatch_date) : "Date TBC"}</span>
                </div>
              ))}
            </div>
          )}

          {po.docs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {po.docs.map((d) => (
                <Button key={d.id} variant="outline" size="sm" asChild>
                  <a href={`/api/portal/file?id=${d.id}`} title={d.original_filename}>
                    <Download className="size-4" /> {docTypeLabel(d.doc_type)}
                  </a>
                </Button>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
