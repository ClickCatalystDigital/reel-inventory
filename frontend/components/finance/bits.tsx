"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PERIODS, type Period } from "@/lib/finance";

// "i" hint next to a card title (native tooltip).
export function Hint({ tip }: { tip: string }) {
  return (
    <span
      tabIndex={0}
      title={tip}
      aria-label={tip}
      className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full border text-[10px] font-bold text-muted-foreground"
    >
      i
    </span>
  );
}

export function FinCard({ title, tip, children, className }: { title?: ReactNode; tip?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-0 p-4", className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{title}</span>
          {tip && <Hint tip={tip} />}
        </div>
      )}
      {children}
    </Card>
  );
}

export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className={cn("text-xl font-bold", className)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

export function Row({ name, sub, amount, amountClass }: { name: ReactNode; sub?: ReactNode; amount: ReactNode; amountClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className={cn("shrink-0 text-sm font-bold", amountClass)}>{amount}</div>
    </div>
  );
}

export function PeriodBar({ value, onChange, withCustom }: { value: Period; onChange: (p: Period) => void; withCustom?: boolean }) {
  const opts = withCustom ? [...PERIODS, { value: "custom" as Period, label: "Custom" }] : PERIODS;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
            value === o.value ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-6 text-center text-sm text-muted-foreground">{children}</div>;
