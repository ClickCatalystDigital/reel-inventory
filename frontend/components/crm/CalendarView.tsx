"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { originOf, ORIGIN_STYLE, type Task } from "@/lib/crm";
import {
  addDays, dayOf, DOW, groupByDate, monthCells, monthOf, MONTHS, periodLabel, shiftAnchor, weekDays, windowFor, yearOf,
  type CalView,
} from "@/lib/calendar";

interface Props {
  today: string;
  /** bump to refetch (after a task is added/done/deleted elsewhere) */
  refreshKey: number;
  /** externally requested jump (year tile → full month grid) */
  jumpTo: { y: number; m: number; n: number } | null;
  onOpenTask: (id: number) => void;
  onOpenDay: (iso: string) => void;
  onOpenMonth: (y: number, m: number) => void;
}

function Chip({ t, today, onOpen }: { t: Task; today: string; onOpen: () => void }) {
  const style = ORIGIN_STYLE[originOf(t)];
  return (
    <button
      type="button"
      title={`${t.poc_name || "General"} — ${t.title}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "block w-full truncate rounded-[4px] border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight hover:brightness-95",
        style.chip,
        t.due_date < today && "font-medium text-destructive"
      )}
    >
      {t.poc_name || t.title}
    </button>
  );
}

export function CalendarView({ today, refreshKey, jumpTo, onOpenTask, onOpenDay, onOpenMonth }: Props) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState(true);
  const [tasks, setTasks] = useState<Task[] | null>(null);

  // Mobile shows a vertical agenda of the next 14 days instead of a grid.
  const win = isMobile ? { from: today, to: addDays(today, 14) } : windowFor(view, anchor);

  useEffect(() => {
    if (isMobile === null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(null);
    api<Task[]>(`/api/tasks/range?from=${win.from}&to=${win.to}`)
      .then((r) => !cancelled && setTasks(r))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, [win.from, win.to, isMobile, refreshKey]);

  // A year tile / "Open full month grid" asked to jump here: adjust state during render (React's pattern
  // for "reset state when a prop changes") instead of in an effect.
  const [handledJump, setHandledJump] = useState(jumpTo);
  if (jumpTo && jumpTo !== handledJump) {
    setHandledJump(jumpTo);
    setAnchor(`${jumpTo.y}-${String(jumpTo.m + 1).padStart(2, "0")}-01`);
    setView("month");
  }

  const byDate = groupByDate(tasks ?? []);

  const cell = (iso: string, week: boolean, muted = false) => {
    const list = byDate[iso] ?? [];
    const max = week ? 5 : 3;
    return (
      <div
        key={iso}
        role="button"
        tabIndex={0}
        onClick={() => onOpenDay(iso)}
        onKeyDown={(e) => e.key === "Enter" && onOpenDay(iso)}
        className={cn(
          "cursor-pointer space-y-1 rounded-lg border bg-card p-1.5 transition-colors hover:bg-muted/40",
          week ? "min-h-[200px]" : "min-h-[92px]",
          muted && "bg-muted/30 text-muted-foreground",
          iso === today && "border-primary ring-1 ring-primary/40"
        )}
      >
        <div className={cn("text-xs font-medium", iso === today && "text-primary")}>{dayOf(iso)}</div>
        {list.slice(0, max).map((t) => (
          <Chip key={t.id} t={t} today={today} onOpen={() => onOpenTask(t.id)} />
        ))}
        {list.length > max && <div className="px-1 text-[11px] font-semibold text-muted-foreground">+{list.length - max} more</div>}
      </div>
    );
  };

  function body() {
    if (tasks === null) return <Skeleton className="h-64 w-full" />;

    if (isMobile) {
      const days = Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter((d) => byDate[d]);
      if (!days.length) return <p className="py-8 text-center text-sm text-muted-foreground">No upcoming touchpoints in the next 14 days</p>;
      return (
        <div className="space-y-3">
          {days.map((iso) => {
            const d = new Date(iso + "T00:00:00Z");
            return (
              <div key={iso}>
                <p className={cn("mb-1.5 text-xs font-semibold", iso === today ? "text-primary" : "text-muted-foreground")}>
                  {DOW[d.getUTCDay()]} {dayOf(iso)} {MONTHS[monthOf(iso)].slice(0, 3)}
                  {iso === today && " · Today"}
                </p>
                <div className="space-y-1.5">
                  {byDate[iso].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className={cn("block w-full rounded-lg border-l-[3px] px-3 py-2 text-left", ORIGIN_STYLE[originOf(t)].chip)}
                    >
                      <p className="text-sm font-medium">{t.poc_name || "General action"}</p>
                      <p className="text-xs text-muted-foreground">{t.title}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    const dow = (
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{d}</div>
        ))}
      </div>
    );

    if (view === "week") {
      return (
        <div className="space-y-1.5">
          {dow}
          <div className="grid grid-cols-7 gap-1.5">{weekDays(anchor).map((iso) => cell(iso, true))}</div>
        </div>
      );
    }
    if (view === "month") {
      const m = monthOf(anchor);
      return (
        <div className="space-y-1.5">
          {dow}
          <div className="grid grid-cols-7 gap-1.5">
            {monthCells(anchor).map((iso) => cell(iso, false, monthOf(iso) !== m))}
          </div>
        </div>
      );
    }
    const y = yearOf(anchor);
    const counts = Array(12).fill(0);
    tasks.forEach((t) => (counts[parseInt(t.due_date.substring(5, 7)) - 1] += 1));
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MONTHS.map((name, i) => (
          <button
            key={name}
            type="button"
            onClick={() => onOpenMonth(y, i)}
            className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40"
          >
            <p className="text-xs font-medium text-muted-foreground">{name.slice(0, 3)}</p>
            <p className="text-2xl font-semibold tabular-nums">{counts[i]}</p>
            <p className="text-[11px] text-muted-foreground">touchpoints</p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen((o) => !o)} title={open ? "Collapse calendar" : "Expand calendar"}>
            <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />
          </Button>
          {!isMobile && (
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}><ChevronLeft /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}><ChevronRight /></Button>
            </>
          )}
          <span className="px-1 text-sm font-semibold">{isMobile ? "Next 14 days" : periodLabel(view, anchor)}</span>
          {!isMobile && anchor !== today && (
            <Button variant="ghost" size="xs" onClick={() => setAnchor(today)}>Today</Button>
          )}
        </div>
        {!isMobile && (
          <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={view} onValueChange={(v) => v && setView(v as CalView)}>
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
            <ToggleGroupItem value="year">Year</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      {open && <div className="p-3">{body()}</div>}
    </Card>
  );
}
