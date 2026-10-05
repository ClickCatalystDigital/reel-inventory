"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { fmtTaskDate, originOf, ORIGIN_STYLE, type Task } from "@/lib/crm";
import { MONTHS } from "@/lib/calendar";

export type DayTarget = { kind: "day"; iso: string } | { kind: "month"; y: number; m: number };

interface Props {
  target: DayTarget | null;
  onClose: () => void;
  onOpenTask: (id: number) => void;
  onChanged: () => void;
  onJumpToMonth: (y: number, m: number) => void;
}

// A day's tasks (click a calendar cell) or a whole month's tasks (click a year tile), with quick-add.
export function DayDialog({ target, onClose, onOpenTask, onChanged, onJumpToMonth }: Props) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  async function load(t: DayTarget) {
    let from: string, to: string;
    if (t.kind === "day") {
      from = to = t.iso;
    } else {
      const mm = String(t.m + 1).padStart(2, "0");
      from = `${t.y}-${mm}-01`;
      to = `${t.y}-${mm}-${String(new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate()).padStart(2, "0")}`;
    }
    try {
      setTasks(await api<Task[]>(`/api/tasks/range?from=${from}&to=${to}`));
    } catch {
      setTasks([]);
    }
  }

  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(null);
    setTitle("");
    load(target);
  }, [target]);

  async function add() {
    if (!target || target.kind !== "day" || !title.trim()) return;
    setAdding(true);
    try {
      await api("/api/tasks", { method: "POST", body: { title: title.trim(), due_date: target.iso, contact_id: null } });
      setTitle("");
      showToast("Task added");
      await load(target);
      onChanged();
    } catch {
      // api() already toasted
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: number) {
    if (!target || !window.confirm("Permanently delete this task?")) return;
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      await load(target);
      onChanged();
    } catch {
      // api() already toasted
    }
  }

  const heading = !target ? "" : target.kind === "day" ? fmtTaskDate(target.iso) : `${MONTHS[target.m]} ${target.y}`;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {heading}
            {tasks && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{tasks.length} item{tasks.length === 1 ? "" : "s"}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {tasks === null ? (
            <Skeleton className="h-16 w-full" />
          ) : tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled</p>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className={cn("flex items-start gap-2 rounded-lg border-l-[3px] px-3 py-2", ORIGIN_STYLE[originOf(t)].chip)}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => { onClose(); onOpenTask(t.id); }}
                >
                  <p className="truncate text-sm font-medium">
                    {t.poc_name || "General action"}
                    {t.company_name && <span className="font-normal text-muted-foreground"> · {t.company_name}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {target?.kind === "month" && <span className="mr-1.5 font-medium text-foreground/70">{fmtTaskDate(t.due_date)}</span>}
                    {t.title}
                  </p>
                </button>
                <Button variant="ghost" size="icon-xs" onClick={() => remove(t.id)} title="Delete">
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="sm:justify-stretch">
          {target?.kind === "day" ? (
            <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <Input placeholder="Quick add an action…" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button type="submit" disabled={adding || !title.trim()}><Plus /> Add</Button>
            </form>
          ) : target ? (
            <Button className="w-full" variant="outline" onClick={() => { onClose(); onJumpToMonth(target.y, target.m); }}>
              Open full month grid →
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
