"use client";

import { useState } from "react";
import { useDailyGate } from "@/hooks/use-daily-gate";
import { api } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Blocking full-viewport modal for Gelco roles until they clear the daily
// "approve yesterday's outward summary" gate — port of renderGateOverlay().
export function DailyGateOverlay() {
  const { isGelco, role, status, refetch } = useDailyGate();
  const [approving, setApproving] = useState(false);

  if (!isGelco || !status || status.approved) return null;

  async function approve() {
    setApproving(true);
    try {
      await api("/api/daily-gate/approve", { method: "POST", body: { store: "secondary" } });
      await refetch();
    } catch {
      // api() already toasted
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[480px] rounded-md border border-border bg-card p-5 shadow-lg">
        {role === "gelco_manager" ? (
          <>
            <div className="mb-3 border-b border-border pb-2 text-sm font-semibold uppercase text-muted-foreground">
              Approve Yesterday&apos;s Gelco Outward Summary {status.date ? `(${status.date})` : ""}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Reels</TableHead>
                  <TableHead>Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.summary.length ? (
                  status.summary.map((s) => (
                    <TableRow key={s.item_code}>
                      <TableCell>{s.item_code}</TableCell>
                      <TableCell>{s.reel_count}</TableCell>
                      <TableCell>{formatQty(s.total_qty)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No outward activity yesterday
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Button className="mt-3.5 w-full" onClick={approve} disabled={approving}>
              Approve &amp; Continue
            </Button>
          </>
        ) : (
          <>
            <div className="mb-2 border-b border-border pb-2 text-sm font-semibold uppercase text-muted-foreground">
              Waiting for Manager Approval
            </div>
            <p className="text-[13px] text-muted-foreground">
              Gelco Manager needs to approve yesterday&apos;s outward summary before you can continue. This page will
              update automatically.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
