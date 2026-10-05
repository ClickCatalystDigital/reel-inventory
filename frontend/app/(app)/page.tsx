"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { completeTask } from "@/lib/crm-actions";
import { capitalize, isApproverRole, type Alert, type Assignee, type Task } from "@/lib/crm";
import { todayISTDateString } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarView } from "@/components/crm/CalendarView";
import { DayDialog, type DayTarget } from "@/components/crm/DayDialog";
import { TaskSheet } from "@/components/crm/TaskSheet";
import { TasksPanel, WatchListPanel } from "@/components/crm/TaskSidebar";

const COLLAPSE_KEY = "sidebarCollapsed"; // same localStorage key the CRM used

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Home for LS Tech employees (ported from the CRM's dashboard): today's tasks + watch list on the
// left, the Week/Month/Year task calendar on the right.
export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const today = todayISTDateString();
  const isApprover = isApproverRole(user?.role);

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [dayTarget, setDayTarget] = useState<DayTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [jumpTo, setJumpTo] = useState<{ y: number; m: number; n: number } | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api<Task[]>(`/api/tasks/today?scope=${scope}`));
    } catch {
      setTasks([]);
    }
  }, [scope]);

  // Task list changed (done/added/deleted/assigned/edited) → refresh the sidebar and the calendar.
  const refreshAll = useCallback(() => {
    loadTasks();
    setRefreshKey((k) => k + 1);
  }, [loadTasks]);

  useEffect(() => {
    // Read after mount (not in the initial state) so the static page and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    if (isLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, [isLoading, user, loadTasks]);

  useEffect(() => {
    if (isLoading || !user) return;
    api<Alert[]>("/api/clients/meta/severity-alerts").then(setAlerts).catch(() => setAlerts([]));
    if (isApproverRole(user.role)) api<Assignee[]>("/api/tasks/assignable").then(setAssignees).catch(() => {});
  }, [isLoading, user]);

  const greeted = useRef(false);
  useEffect(() => {
    if (!user || greeted.current) return;
    greeted.current = true;
    toast(`${greeting()}, ${capitalize(user.username)}!`);
  }, [user]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* storage blocked */ }
      return !c;
    });
  }

  async function onAssign(id: number, username: string | null) {
    try {
      await api(`/api/tasks/${id}/assign`, { method: "POST", body: { assigned_to: username } });
      refreshAll();
    } catch {
      // api() already toasted
    }
  }

  async function onDone(id: number) {
    try {
      await completeTask(id, refreshAll);
    } catch {
      // api() already toasted
    }
  }

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const railed = collapsed && isDesktop === true;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Welcome, {capitalize(user.username)}</h1>
        <p className="text-sm text-muted-foreground">Your follow-ups and upcoming touchpoints</p>
      </div>

      {/* Desktop: Tasks (left, row 1) and the calendar (right, row 1) share a height, with the Watch list
          underneath the tasks. Mobile order: calendar, tasks, watch list. */}
      <div className={cn("grid gap-4", railed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]")}>
        <div className="order-2 lg:order-none lg:col-start-1 lg:row-start-1">
          <TasksPanel
            tasks={tasks}
            alerts={alerts}
            today={today}
            isApprover={isApprover}
            scope={scope}
            onScope={setScope}
            assignees={assignees}
            collapsed={railed}
            onToggleCollapsed={toggleCollapsed}
            onOpenTask={setOpenTaskId}
            onDone={onDone}
            onAssign={onAssign}
            onOpenClient={(id: number) => router.push(`/clients?open=${id}`)}
          />
        </div>
        <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-[calc(100dvh-25rem)]">
          <CalendarView
            today={today}
            refreshKey={refreshKey}
            jumpTo={jumpTo}
            onOpenTask={setOpenTaskId}
            onOpenDay={(iso) => setDayTarget({ kind: "day", iso })}
            onOpenMonth={(y, m) => setDayTarget({ kind: "month", y, m })}
          />
        </div>
        <div className="order-3 lg:order-none lg:col-start-1 lg:row-start-2">
          <WatchListPanel alerts={alerts} collapsed={railed} onOpenClient={(id: number) => router.push(`/clients?open=${id}`)} />
        </div>
      </div>

      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={refreshAll}
        isApprover={isApprover}
        assignees={assignees}
      />
      <DayDialog
        target={dayTarget}
        onClose={() => setDayTarget(null)}
        onOpenTask={setOpenTaskId}
        onChanged={refreshAll}
        onJumpToMonth={(y, m) => setJumpTo({ y, m, n: Date.now() })}
      />
    </div>
  );
}
