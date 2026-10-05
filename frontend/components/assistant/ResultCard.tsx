"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { safePath, type Reply } from "@/lib/assistant-links";

const cell = (v: string | number | null | undefined, type?: string) => {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "int" && typeof v === "number") return v.toLocaleString("en-IN");
  return String(v);
};

// A data answer: headline summary, the parameters the assistant understood (so you can check them at a glance),
// the table exactly as stored, and a link to the screen with the full picture.
export function ResultCard({ reply, onNavigate }: { reply: Reply; onNavigate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const allCols = reply.columns ?? [];
  // A long "description" column would squeeze the numbers out on a phone: show it as a muted second line under the first column instead.
  const sub = allCols.length > 2 ? allCols.find((c) => c.key === "description") : undefined;
  const cols = allCols.filter((c) => c !== sub);
  const rows = reply.rows ?? [];
  const link = reply.link && safePath(reply.link.path) ? reply.link : null;

  async function copy() {
    const tsv = [allCols.map((c) => c.label).join("\t"), ...rows.map((r) => allCols.map((c) => String(r[c.key] ?? "")).join("\t"))].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="w-full overflow-hidden rounded-2xl rounded-tl-md border bg-card shadow-sm">
      <div className="space-y-2.5 px-3.5 pt-3 pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{reply.toolLabel}</p>
          <p className="mt-0.5 text-[13px] font-medium text-foreground/80">{reply.title}</p>
        </div>
        <p className="text-[15px] font-semibold leading-snug tracking-tight">{reply.summary}</p>
        {reply.params && reply.params.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reply.params.map((p) => (
              <span key={p.label} className="inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                {p.label}
                <span className="truncate font-medium text-foreground">{p.value}</span>
              </span>
            ))}
          </div>
        )}
        {reply.text && <p className="rounded-lg bg-primary/5 px-2.5 py-2 text-[13px] leading-relaxed">{reply.text}</p>}
      </div>

      {rows.length > 0 && (
        <div className="border-t">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground", c.type === "int" ? "text-right" : "text-left")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/40">
                    {cols.map((c) => (
                      <td key={c.key} className={cn("px-3 py-1.5 align-top", c.type === "int" && "text-right tabular-nums", c.type === "date" && "whitespace-nowrap text-muted-foreground", c.key === cols[0]?.key && "font-medium")}>
                        {cell(r[c.key], c.type)}
                        {sub && c.key === cols[0]?.key && r[sub.key] ? <span className="mt-0.5 line-clamp-2 block text-[11px] font-normal leading-snug text-muted-foreground">{String(r[sub.key])}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
        <div className="min-w-0 text-[11px] leading-snug text-muted-foreground">
          {reply.truncated && <p>Showing {rows.length} of {reply.total?.toLocaleString("en-IN")}.</p>}
          {reply.note && <p>{reply.note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {rows.length > 0 && (
            <button type="button" onClick={copy} title="Copy table" className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </button>
          )}
          {link && (
            <Link href={link.path} onClick={onNavigate} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10">
              {link.label} <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
