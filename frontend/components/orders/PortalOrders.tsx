"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDate, formatQty } from "@/lib/format";
import { docTypeLabel, type PoDetail } from "@/lib/po-stages";
import { StageSteps } from "./StageSelect";

// Customer portal: the caller's own POs (server scopes by user_companies) with stage, lots and documents.
export function PortalOrders() {
  const [pos, setPos] = useState<PoDetail[] | null>(null);
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
            <div className="text-sm font-semibold">{po.stage ?? "Received"}</div>
          </div>

          <StageSteps stage={po.stage} />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</div>
              {po.lines.map((l) => {
                const sent = po.dispatches.filter((d) => d.item_code === l.item_code).reduce((s, d) => s + d.quantity, 0);
                return (
                  <div key={l.id} className="flex justify-between gap-3 text-sm">
                    <span><strong>{l.item_code}</strong>{l.description && <span className="text-muted-foreground"> · {l.description}</span>}</span>
                    <span className="shrink-0 text-muted-foreground">{formatQty(sent)} / {formatQty(l.quantity_ordered)}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dispatches</div>
              {po.dispatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet</p>
              ) : (
                po.dispatches.map((d) => (
                  <div key={d.id} className="flex justify-between gap-3 text-sm">
                    <span><strong>{d.item_code}</strong> × {formatQty(d.quantity)}</span>
                    <span className="text-muted-foreground">{d.dispatch_date ? formatDate(d.dispatch_date) : "Date TBC"}</span>
                  </div>
                ))
              )}
            </div>
          </div>

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
