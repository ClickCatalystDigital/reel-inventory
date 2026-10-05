"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { capitalize, PIPELINE_STAGES, SEVERITIES, type ClientDetail, type Product } from "@/lib/crm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// Client detail: edit fields, log a call note (+ optionally schedule the next touchpoint), notes timeline.
export function ClientSheet({
  clientId, onClose, products, onChanged,
}: {
  clientId: number | null;
  onClose: () => void;
  products: Product[];
  onChanged: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [c, setC] = useState<ClientDetail | null>(null);
  const [form, setForm] = useState({ poc_name: "", designation: "", status: "new", product_id: "none", severity: "1", email: "", phone: "" });
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(id: number) {
    try {
      const d = await api<ClientDetail>(`/api/clients/${id}`);
      setC(d);
      setForm({
        poc_name: d.poc_name, designation: d.designation || "", status: d.status,
        product_id: d.product_id ? String(d.product_id) : "none", severity: String(d.severity || 1),
        email: d.email || "", phone: d.phone || "",
      });
    } catch {
      onClose();
    }
  }

  useEffect(() => {
    if (clientId == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setC(null);
    setNote(""); setNextDate(""); setNextTitle("");
    load(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const set = (patch: Partial<typeof form>) => setForm((p) => ({ ...p, ...patch }));

  async function save() {
    if (!c) return;
    setBusy(true);
    try {
      await api(`/api/clients/${c.id}`, {
        method: "PUT",
        body: {
          poc_name: form.poc_name, designation: form.designation, status: form.status,
          product_id: form.product_id === "none" ? null : Number(form.product_id),
          severity: Number(form.severity), email: form.email, phone: form.phone,
        },
      });
      showToast("Contact updated");
      onChanged();
      await load(c.id);
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  async function logNote() {
    if (!c) return;
    if (!note.trim()) { showToast("Write a note first", "error"); return; }
    setBusy(true);
    try {
      await api(`/api/clients/${c.id}/notes`, { method: "POST", body: { body: note.trim() } });
      if (nextDate) await api("/api/tasks", { method: "POST", body: { contact_id: c.id, title: nextTitle.trim() || "Follow up", due_date: nextDate } });
      showToast(nextDate ? "Note logged and touchpoint scheduled" : "Note added");
      setNote(""); setNextDate(""); setNextTitle("");
      onChanged();
      await load(c.id);
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={clientId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isDesktop ? "right" : "bottom"} className={cn("gap-0 p-0", isDesktop ? "sm:max-w-md" : "max-h-[90vh] rounded-t-2xl")}>
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>{c ? c.poc_name : "Client"}</SheetTitle>
          <SheetDescription>
            {c ? [c.designation, c.company_name].filter(Boolean).join(" · ") || "No company" : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {!c ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="POC name"><Input value={form.poc_name} onChange={(e) => set({ poc_name: e.target.value })} /></Field>
                <Field label="Designation"><Input value={form.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
                <Field label="Status">
                  <Select value={form.status} onValueChange={(v) => set({ status: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Product">
                  <Select value={form.product_id} onValueChange={(v) => set({ product_id: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Severity">
                  <Select value={form.severity} onValueChange={(v) => set({ severity: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s.value} value={String(s.value)}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <div />
                <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              </div>
              <Button onClick={save} disabled={busy} className="w-full">Save changes</Button>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call summary thread</p>
                <Textarea rows={3} placeholder="What was discussed?" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Next touchpoint"><Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-8" /></Field>
                  <Field label="Title"><Input placeholder="Follow up" value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} className="h-8" /></Field>
                </div>
                <Button size="sm" variant="outline" onClick={logNote} disabled={busy}>Log note &amp; schedule</Button>
              </div>

              <div className="space-y-2">
                {c.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  c.notes.map((n) => (
                    <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)} · {n.created_by}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
