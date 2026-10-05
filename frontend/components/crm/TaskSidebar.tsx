"use client";

import { Check, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { fmtTaskDate, originOf, ORIGIN_STYLE, type Alert, type Assignee, type Task } from "@/lib/crm";
import { AssigneePicker, UserAvatar } from "./AssigneePicker";

interface Props {
  tasks: Task[] | null;
  alerts: Alert[] | null;
  today: string;
  isApprover: boolean;
  scope: "mine" | "all";
  onScope: (s: "mine" | "all") => void;
  assignees: Assignee[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenTask: (id: number) => void;
  onDone: (id: number) => void;
  onAssign: (id: number, username: string | null) => void;
  onOpenClient: (id: number) => void;
}

function TaskCard({ t, today, showAssignee, canAssign, assignees, onOpen, onDone, onAssign }: {
  t: Task; today: string; showAssignee: boolean; canAssign: boolean; assignees: Assignee[];
  onOpen: () => void; onDone: () => void; onAssign: (u: string | null) => void;
}) {
  const overdue = t.due_date < today;
  const style = ORIGIN_STYLE[originOf(t)];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "group cursor-pointer rounded-lg border border-l-[3px] bg-card p-2.5 text-left transition-colors hover:bg-muted/50",
        style.chip.split(" ")[0],
        overdue && "border-destructive/30"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{t.poc_name || "General"}</p>
          {t.company_name && <p className="truncate text-xs text-muted-foreground">{t.company_name}</p>}
          <p className="mt-1 line-clamp-2 text-xs">{t.title}</p>
          <p className={cn("mt-1 text-[11px]", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
            {overdue ? `Overdue · ${fmtTaskDate(t.due_date)}` : fmtTaskDate(t.due_date)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {showAssignee &&
            (canAssign ? (
              <AssigneePicker value={t.assigned_to} assignees={assignees} onAssign={onAssign} />
            ) : (
              <UserAvatar username={t.assigned_to} />
            ))}
          {!t.invoice_id && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onDone();
              }}
            >
              <Check /> Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TasksPanel(p: Props) {
  const count = p.tasks?.length ?? 0;
  const hasToday = !!p.tasks?.some((t) => t.due_date === p.today);
  const alertCount = p.alerts?.length ?? 0;

  // Collapsed rail (desktop only): counts at a glance + expand button.
  if (p.collapsed) {
    return (
      <Card className="hidden h-full w-14 flex-col items-center gap-3 p-2 py-3 lg:flex">
        <Button variant="ghost" size="icon-sm" onClick={p.onToggleCollapsed} title="Expand">
          <ChevronsRight />
        </Button>
        <div className="relative flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {count}
          {hasToday && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" />}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tasks</span>
        {alertCount > 0 && (
          <>
            <div className="flex size-8 items-center justify-center rounded-full bg-destructive text-sm font-semibold text-white">{alertCount}</div>
            <span className="text-[10px] uppercase tracking-wide text-destructive">S3</span>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card className="h-full gap-0 p-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{count}</span>
          </div>
          <div className="flex items-center gap-1">
            {p.isApprover && (
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                spacing={0}
                value={p.scope}
                onValueChange={(v) => v && p.onScope(v as "mine" | "all")}
              >
                <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
              </ToggleGroup>
            )}
            <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={p.onToggleCollapsed} title="Collapse">
              <ChevronsLeft />
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] min-h-0 flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100dvh-28rem)]">
          {p.tasks === null ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : p.tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing here 🎉</p>
          ) : (
            p.tasks.map((t) => (
              <TaskCard
                key={t.id}
                t={t}
                today={p.today}
                showAssignee={p.scope === "all"}
                canAssign={p.isApprover}
                assignees={p.assignees}
                onOpen={() => p.onOpenTask(t.id)}
                onDone={() => p.onDone(t.id)}
                onAssign={(u) => p.onAssign(t.id, u)}
              />
            ))
          )}
        </div>
      </Card>
  );
}

export function WatchListPanel(p: Pick<Props, "alerts" | "collapsed" | "onOpenClient">) {
  const alertCount = p.alerts?.length ?? 0;
  if (p.collapsed) return null;
  return (
      <Card className="gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">Watch list</h2>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{alertCount}</span>
        </div>
        <div className="space-y-1.5 p-3">
          {p.alerts === null ? (
            <Skeleton className="h-12 w-full" />
          ) : p.alerts.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">No high alert clients right now.</p>
          ) : (
            p.alerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => p.onOpenClient(a.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-left hover:bg-destructive/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.poc_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.company_name || "—"} · {a.status}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">High</span>
              </button>
            ))
          )}
        </div>
      </Card>
  );
}
