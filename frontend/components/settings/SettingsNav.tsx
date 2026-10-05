"use client";

import type { LucideIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SettingsTab { key: string; label: string; caption: string; icon: LucideIcon }

// The rail is shadcn's Tabs (vertical): real tab semantics and arrow-key navigation for free. Desktop = a sticky left rail with a
// caption under each label; phones = a scrollable pill row (captions hidden).
export function SettingsNav({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <TabsList
      variant="line"
      aria-label="Settings sections"
      className="h-auto w-full flex-row gap-1.5 overflow-x-auto rounded-none p-0 pb-1 md:sticky md:top-20 md:w-64 md:shrink-0 md:flex-col md:items-stretch md:gap-1 md:self-start md:overflow-visible md:rounded-xl md:border md:bg-card md:p-2 md:pb-2 md:shadow-xs"
    >
      {tabs.map((t) => (
        <TabsTrigger
          key={t.key}
          value={t.key}
          className="group/item h-auto flex-none gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-muted-foreground after:hidden hover:text-foreground data-active:border-foreground data-active:bg-foreground data-active:text-background md:w-full md:flex-initial md:justify-start md:gap-3 md:rounded-lg md:border-transparent md:bg-transparent md:px-2.5 md:py-2.5 md:text-left md:data-active:border-transparent md:data-active:bg-accent md:data-active:text-foreground md:data-active:shadow-none md:hover:bg-accent/60 md:after:block md:after:inset-y-2.5 md:after:left-0 md:after:right-auto md:after:w-[3px] md:after:rounded-full md:data-active:after:opacity-100"
        >
          <span className="hidden size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-data-active/item:bg-foreground group-data-active/item:text-background md:grid">
            <t.icon className="size-[18px]" />
          </span>
          <t.icon className="size-4 md:hidden" />
          <span className="min-w-0 text-left">
            <span className="block text-sm font-medium leading-tight md:text-[13.5px]">{t.label}</span>
            <span className="hidden truncate text-[11px] font-normal leading-tight text-muted-foreground md:mt-0.5 md:block">{t.caption}</span>
          </span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
