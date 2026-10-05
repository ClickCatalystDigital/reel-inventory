"use client";

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SettingsTab { key: string; label: string; caption: string; icon: LucideIcon }

// Left rail on desktop (sticky Card, like the Reports sidebar), a scrollable pill row on phones — three sections don't need a drawer.
export function SettingsNav({ tabs, active, onSelect }: { tabs: SettingsTab[]; active: string; onSelect: (key: string) => void }) {
  return (
    <>
      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:hidden" aria-label="Settings sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-current={active === t.key ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              active === t.key ? "border-foreground bg-foreground font-medium text-background" : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </nav>

      <Card size="sm" className="hidden w-60 shrink-0 self-start md:sticky md:top-20 md:block">
        <nav className="flex flex-col gap-1" aria-label="Settings sections">
          {tabs.map((t) => {
            const on = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onSelect(t.key)}
                aria-current={on ? "page" : undefined}
                className={cn("group flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors", on ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg transition-colors", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
                  <t.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm leading-tight", on ? "font-semibold" : "font-medium text-foreground/80")}>{t.label}</span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">{t.caption}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </Card>
    </>
  );
}
