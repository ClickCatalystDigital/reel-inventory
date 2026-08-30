"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { api } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface StockSummaryRow {
  item_code: string;
  description: string | null;
  in_stock_reels: number;
  total_quantity: number;
}

// Deliberately standalone, outside the (app) route group: this is the
// read-only client-role view and keeps its own minimal nav (brand + theme
// toggle only — no cog, no bottom-nav, no store selector), not the shared
// full-chrome Nav.
export default function StockPage() {
  const [rows, setRows] = useState<StockSummaryRow[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState("Loading...");

  useEffect(() => {
    (async () => {
      try {
        const summary = await api<StockSummaryRow[]>("/api/dashboard/stock-summary");
        const inStock = summary
          .filter((s) => (s.in_stock_reels || 0) > 0)
          .sort((a, b) => a.item_code.localeCompare(b.item_code));
        setRows(inStock);
        setLastUpdated(
          `As of ${new Date().toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}`
        );
      } catch {
        // api() already toasted
      }
    })();
  }, []);

  const items = rows ?? [];
  const totalReels = items.reduce((s, i) => s + (i.in_stock_reels || 0), 0);
  const totalQty = items.reduce((s, i) => s + (i.total_quantity || 0), 0);

  return (
    <>
      <StockNav />
      <main className="mx-auto max-w-5xl space-y-4 px-4 pt-6 pb-6">
        <div>
          <h1 className="text-xl font-bold">Current Stock</h1>
          <p className="text-sm text-muted-foreground">{lastUpdated}</p>
        </div>

        <Card className="p-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{rows === null ? "—" : items.length}</div>
              <div className="text-xs text-muted-foreground">Items</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{rows === null ? "—" : totalReels.toLocaleString("en-IN")}</div>
              <div className="text-xs text-muted-foreground">Reels In Stock</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{rows === null ? "—" : formatQty(totalQty)}</div>
              <div className="text-xs text-muted-foreground">Total Quantity</div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stock by Item
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reels In Stock</TableHead>
                  <TableHead>Total Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows === null ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No stock currently
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((s) => (
                    <TableRow key={s.item_code}>
                      <TableCell>
                        <strong>{s.item_code}</strong>
                      </TableCell>
                      <TableCell>{s.description || "—"}</TableCell>
                      <TableCell>{s.in_stock_reels || 0}</TableCell>
                      <TableCell>{formatQty(s.total_quantity || 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>
    </>
  );
}

function StockNav() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <nav className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 bg-[var(--nav-bg)] px-4 text-white">
      <span className="font-bold tracking-wide">LS TECHNOLOGY — STOCK VIEW</span>
      <button
        title="Toggle dark mode"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
      >
        {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </button>
    </nav>
  );
}
