"use client";

import { useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  label: ReactNode;
  key?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  title: string;
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  pageSize?: number;
  /** 'client': `data` is the full set, paginated in-memory (matches PaginatedTable.load()).
   *  'server': `data` is one page, `totalCount` is the real total, `onPageChange` drives the fetch
   *  (matches PaginatedTable.loadServerPage() + onPageChange). */
  mode?: "client" | "server";
  totalCount?: number;
  onPageChange?: (page: number, pageSize: number) => void;
}

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

// Ported page-range logic from PaginatedTable._pageRange() — windowed with
// '…' ellipses, matches the legacy pagination exactly.
function pageRange(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}

export function DataTable<T>({
  title,
  columns,
  data,
  getRowKey,
  pageSize: initialPageSize = 10,
  mode = "client",
  totalCount,
  onPageChange,
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Client mode: a fresh `data` array (new fetch) resets to page 1, matching
  // .load(). Adjusted during render (React's documented pattern for "reset
  // state when a prop changes") rather than in an effect, which would cause
  // an extra render pass.
  const [prevData, setPrevData] = useState(data);
  if (mode === "client" && data !== prevData) {
    setPrevData(data);
    setCurrentPage(1);
  }

  const total = mode === "server" ? totalCount ?? 0 : data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, totalPages);
  const start = (page - 1) * pageSize;
  const rows = mode === "server" ? data : data.slice(start, start + pageSize);

  function goToPage(p: number) {
    setCurrentPage(p);
    if (mode === "server") onPageChange?.(p, pageSize);
  }

  function changePageSize(size: number) {
    setPageSize(size);
    setCurrentPage(1);
    if (mode === "server") onPageChange?.(1, size);
  }

  const from = total ? start + 1 : 0;
  const to = Math.min(start + pageSize, total);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {total > 10 && (
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={pageSize}
            onChange={(e) => changePageSize(parseInt(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s} disabled={s >= total && s !== pageSize}>
                {s} / page
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead key={c.key ?? i}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!total ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  No data
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={getRowKey(row, i)}>
                  {columns.map((c, i) => (
                    <TableCell key={c.key ?? i}>{c.render(row)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {total ? `${from}–${to} of ${total}` : "0 results"}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => goToPage(page - 1)}>
              ←
            </Button>
            {pageRange(page, totalPages).map((p, i) =>
              p === "…" ? (
                <Button key={`ellipsis-${i}`} variant="ghost" size="sm" disabled>
                  …
                </Button>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className={cn(p === page && "pointer-events-none")}
                  onClick={() => goToPage(p)}
                >
                  {p}
                </Button>
              )
            )}
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => goToPage(page + 1)}>
              →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
