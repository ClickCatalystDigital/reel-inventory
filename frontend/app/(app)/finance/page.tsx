"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { epochToRelative } from "@/lib/finance";
import { Receivables, type Summary } from "@/components/finance/Receivables";
import { Sales } from "@/components/finance/Sales";
import { Inventory } from "@/components/finance/Inventory";
import { Position } from "@/components/finance/Position";
import { Payables } from "@/components/finance/Payables";

// Ported from ls_crm's Finance page: everything is read from the crm_tally_* tables the office-PC
// Tally agent syncs. Tabs mount on first open (Radix unmounts the hidden ones), like ls_crm's lazy load.
export default function FinancePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sync, setSync] = useState("Loading sync status…");

  useEffect(() => {
    api<Summary>("/api/finance/summary")
      .then((d) => {
        setSummary(d);
        const parts: string[] = [];
        if (d.masterSyncEpoch) parts.push(`Masters synced ${epochToRelative(d.masterSyncEpoch)}`);
        if (d.voucherSyncDate) {
          const vs = String(d.voucherSyncDate);
          const label = vs.length === 8
            ? new Date(+vs.slice(0, 4), +vs.slice(4, 6) - 1, +vs.slice(6, 8)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : vs;
          parts.push(`Vouchers from ${label}`);
        }
        setSync(parts.join("  ·  ") || "Sync status unavailable");
      })
      .catch(() => setSync("Could not load sync status"));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Finance</h1>
        <p className="text-xs text-muted-foreground">{sync}</p>
      </div>
      <Tabs defaultValue="receivables" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
          <TabsTrigger value="sales">Sales Register</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="position">Position</TabsTrigger>
          <TabsTrigger value="payables">Payables</TabsTrigger>
        </TabsList>
        <TabsContent value="receivables"><Receivables summary={summary} /></TabsContent>
        <TabsContent value="sales"><Sales /></TabsContent>
        <TabsContent value="inventory"><Inventory /></TabsContent>
        <TabsContent value="position"><Position /></TabsContent>
        <TabsContent value="payables"><Payables /></TabsContent>
      </Tabs>
    </div>
  );
}
