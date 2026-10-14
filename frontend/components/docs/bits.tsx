"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { statusTone } from "@/lib/docs";

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn("inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase", statusTone(status))}>
      {label ?? (status === "in_tally" ? "In Tally" : status.replace("_", " "))}
    </span>
  );
}

export function Kpi({ value, label, sub, tone, className }: { value: ReactNode; label: string; sub?: ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className={cn("text-2xl font-bold", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-[11px] font-semibold text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-semibold",
            value === o.value ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="mt-5 mb-2 border-b pb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>
);

export function Notice({ tone, title, children }: { tone: "warn" | "danger" | "info"; title: string; children?: ReactNode }) {
  const c = tone === "warn" ? "border-warning text-warning" : tone === "danger" ? "border-destructive text-destructive" : "border-foreground";
  return (
    <div className={cn("mb-3 rounded-md border-l-4 bg-muted/40 p-2.5", c)}>
      <div className="text-xs font-bold">{title}</div>
      {children && <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}
