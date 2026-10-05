"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ExternalLink, Mail, Phone, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { completeTask } from "@/lib/crm-actions";
import { formatDateTime } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { clientStatusClass, inr, type Assignee, type Invoice, type TaskDetail } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { AssigneePicker, UserAvatar } from "./AssigneePicker";

interface Props {
  taskId: number | null;
  onClose: () => void;
  onChanged: () => void;
  isApprover: boolean;
  assignees: Assignee[];
}

const INVOICE_COLOR: Record<string, string> = {
  pending: "border-l-warning",
  approved: "border-l-success",
  pushed: "border-l-primary",
  rejected: "border-l-destructive",
};

function InvoiceCard({ inv }: { inv: Invoice }) {
  const items = Array.isArray(inv.line_items) ? inv.line_items : [];
  return (
    <div className={cn("rounded-lg border border-l-[3px] bg-card p-3", INVOICE_COLOR[inv.status] || "border-l-border")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{inv.invoice_no || inv.original_filename || "Untitled"}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{inv.status}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {inv.party_name || "—"}
        {inv.invoice_date ? ` · ${inv.invoice_date}` : ""}
        {inv.commodity ? ` · ${inv.commodity}` : ""}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><p className="text-muted-foreground">Taxable</p><p className="font-semibold">{inr(inv.taxable_value)}</p></div>
        <div><p className="text-muted-foreground">GST</p><p className="font-semibold">{inr(inv.total_tax)}</p></div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-2">
        <span className="text-sm font-semibold">Net amount</span>
        <span className="text-base font-semibold">{inr(inv.net_amount)}</span>
      </div>
      {items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {items.length} line item{items.length > 1 ? "s" : ""}: {items.map((i) => i.description).filter(Boolean).join(", ")}
        </p>
      )}
    </div>
  );
}

export function TaskSheet({ taskId, onClose, onChanged, isApprover, assignees }: Props) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null | undefined>(undefined); // undefined = not an invoice task / not loaded
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [markDone, setMarkDone] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load(id: number) {
    try {
      const t = await api<TaskDetail>(`/api/tasks/${id}`);
      setTask(t);
      setTitle(t.title);
      setDue(t.due_date);
      setNote(""); setNextDate(""); setNextTitle(""); setMarkDone(true);
      if (t.invoice_id) {
        setInvoice(null);
        setInvoice(await api<Invoice>(`/api/invoices/${t.invoice_id}`).catch(() => null));
      } else {
        setInvoice(undefined);
      }
    } catch {
      onClose();
    }
  }

  useEffect(() => {
    if (taskId == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTask(null);
    setInvoice(undefined);
    load(taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const open = task?.status === "open";
  const isInvoiceTask = !!task?.invoice_id;
  const dirty = !!task && (title.trim() !== task.title || due !== task.due_date);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch { /* api() already toasted */ } finally { setBusy(false); }
  }

  const save = () => run(async () => {
    await api(`/api/tasks/${task!.id}`, { method: "PATCH", body: { title: title.trim(), due_date: due } });
    showToast("Task updated");
    onChanged();
    await load(task!.id);
  });

  const remove = () => run(async () => {
    if (!window.confirm("Permanently delete this task?")) return;
    await api(`/api/tasks/${task!.id}`, { method: "DELETE" });
    showToast("Task deleted");
    onChanged();
    onClose();
  });

  const toggleDone = () => run(async () => {
    if (open) {
      onClose();
      await completeTask(task!.id, onChanged);
    } else {
      await api(`/api/tasks/${task!.id}/reopen`, { method: "POST" });
      showToast("Task reopened");
      onChanged();
      await load(task!.id);
    }
  });

  const assign = (username: string | null) => run(async () => {
    await api(`/api/tasks/${task!.id}/assign`, { method: "POST", body: { assigned_to: username } });
    onChanged();
    await load(task!.id);
  });

  const logCall = () => run(async () => {
    if (!note.trim() && !nextDate) { showToast("Add a note or a next touchpoint date", "error"); return; }
    if (note.trim()) await api(`/api/clients/${task!.contact_id}/notes`, { method: "POST", body: { body: note.trim() } });
    if (nextDate) await api("/api/tasks", { method: "POST", body: { contact_id: task!.contact_id, title: nextTitle.trim() || "Follow up", due_date: nextDate } });
    if (markDone && open) await api(`/api/tasks/${task!.id}/done`, { method: "POST" });
    showToast("Call logged");
    onChanged();
    onClose();
  });

  const review = (action: "approve" | "reject") => run(async () => {
    await api(`/api/invoices/${invoice!.id}/${action}`, { method: "POST", body: {} });
    showToast(action === "approve" ? "Approved — local agent will push to Tally" : "Invoice rejected");
    onChanged();
    onClose();
  });

  return (
    <Sheet open={taskId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn("gap-0 p-0", isDesktop ? "sm:max-w-md" : "max-h-[88vh] rounded-t-2xl")}
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle className="sr-only">Task</SheetTitle>
          <SheetDescription className="sr-only">Task details</SheetDescription>
          {!task ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="space-y-2">
              <Badge variant="outline" className={open ? "border-warning/30 bg-warning/10 text-warning" : "border-success/30 bg-success/10 text-success"}>
                {open ? "Open" : "Done"}
              </Badge>
              <Input
                value={title}
                disabled={!open || isInvoiceTask}
                onChange={(e) => setTitle(e.target.value)}
                className="h-auto border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0 disabled:opacity-100"
              />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!task ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Due date</span>
                <Input type="date" value={due} disabled={!open || isInvoiceTask} onChange={(e) => setDue(e.target.value)} className="h-8 w-40" />
                <span className="text-muted-foreground">Assigned</span>
                <div className="flex items-center gap-2">
                  {isApprover ? (
                    <AssigneePicker value={task.assigned_to} assignees={assignees} onAssign={assign} />
                  ) : (
                    <UserAvatar username={task.assigned_to} />
                  )}
                  <span className="text-sm">{task.assigned_to || "Unassigned"}</span>
                </div>
              </div>

              {isInvoiceTask ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice details</p>
                  {invoice === null ? <Skeleton className="h-32 w-full" /> : invoice === undefined ? null : <InvoiceCard inv={invoice} />}
                </div>
              ) : (
                <>
                  {task.poc_name && (
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</p>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{task.poc_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[task.designation, task.company_name].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        {task.contact_status && <Badge variant="outline" className={clientStatusClass(task.contact_status)}>{task.contact_status}</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {task.email && (
                          <a href={`mailto:${task.email}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"><Mail className="size-3" />{task.email}</a>
                        )}
                        {task.phone && (
                          <a href={`tel:${task.phone}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"><Phone className="size-3" />{task.phone}</a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last note</p>
                    {task.last_note ? (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                        <p>{task.last_note.body}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">{task.last_note.created_by} · {formatDateTime(task.last_note.created_at)}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{task.contact_id ? "No notes on this contact yet." : "Not linked to a contact."}</p>
                    )}
                  </div>

                  {task.contact_id && open && (
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Log this call</p>
                      <Textarea rows={3} placeholder="What was discussed?" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Next touchpoint</Label>
                          <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-8" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Title</Label>
                          <Input placeholder="Follow up" value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} className="h-8" />
                        </div>
                      </div>
                      <Label className="flex items-center gap-2 text-sm font-normal">
                        <Checkbox checked={markDone} onCheckedChange={(v) => setMarkDone(v === true)} />
                        Mark current task done after logging
                      </Label>
                      <Button size="sm" onClick={logCall} disabled={busy}>Log call</Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {task && (
          <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t p-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={remove} disabled={busy} title="Delete task">
                <Trash2 className="text-destructive" />
              </Button>
              {task.crm_contact_id && !isInvoiceTask && (
                <Button variant="ghost" size="icon" asChild title="Open client">
                  <Link href={`/clients?open=${task.crm_contact_id}`}><ExternalLink /></Link>
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isInvoiceTask ? (
                invoice?.status === "pending" ? (
                  isApprover ? (
                    <>
                      <Button variant="outline" onClick={() => review("reject")} disabled={busy} className="border-destructive/40 text-destructive hover:text-destructive">Reject</Button>
                      <Button onClick={() => review("approve")} disabled={busy}><CheckCircle2 /> Approve → Tally</Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Awaiting approval by an admin or manager</span>
                  )
                ) : invoice ? (
                  <span className="text-sm text-muted-foreground">{invoice.status === "pushed" ? (<span className="inline-flex items-center gap-1"><Check className="size-4" /> Pushed to Tally</span>) : `Status: ${invoice.status}`}</span>
                ) : null
              ) : (
                <>
                  {open && dirty && <Button variant="outline" onClick={save} disabled={busy}>Save</Button>}
                  <Button variant={open ? "default" : "outline"} onClick={toggleDone} disabled={busy}>
                    {open ? <><CheckCircle2 /> Mark done</> : <><RotateCcw /> Reopen</>}
                  </Button>
                </>
              )}
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
