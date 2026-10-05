"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { capitalize, PIPELINE_STAGES, SEVERITIES, type Assignee, type Product } from "@/lib/crm";

const blank = {
  poc_name: "", company_name: "", designation: "", email: "", phone: "", status: "new", product_id: "none",
  next_touchpoint: "", next_touchpoint_title: "", assignee: "me", note: "", severity: "1",
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function AddClientDialog({
  open, onOpenChange, products, assignees, isApprover, onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: Product[];
  assignees: Assignee[];
  isApprover: boolean;
  onAdded: () => void;
}) {
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof blank>) => setF((p) => ({ ...p, ...patch }));

  async function submit() {
    if (!f.poc_name.trim()) { showToast("POC name is required", "error"); return; }
    setSaving(true);
    try {
      await api("/api/clients", {
        method: "POST",
        body: {
          poc_name: f.poc_name.trim(),
          company_name: f.company_name.trim() || null,
          designation: f.designation.trim() || null,
          email: f.email.trim() || null,
          phone: f.phone.trim() || null,
          status: f.status,
          product_id: f.product_id === "none" ? null : Number(f.product_id),
          severity: Number(f.severity),
          note: f.note.trim() || null,
          next_touchpoint: f.next_touchpoint || null,
          next_touchpoint_title: f.next_touchpoint_title.trim() || null,
          next_touchpoint_assignee: isApprover && f.assignee !== "me" ? f.assignee : null,
        },
      });
      showToast(`${f.poc_name.trim()} added`);
      setF(blank);
      onOpenChange(false);
      onAdded();
    } catch {
      // api() already toasted
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Add client</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="POC name *"><Input value={f.poc_name} onChange={(e) => set({ poc_name: e.target.value })} autoFocus /></Field>
          <Field label="Company"><Input value={f.company_name} onChange={(e) => set({ company_name: e.target.value })} /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={f.status} onValueChange={(v) => set({ status: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Product">
            <Select value={f.product_id} onValueChange={(v) => set({ product_id: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={f.severity} onValueChange={(v) => set({ severity: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s.value} value={String(s.value)}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Next touchpoint"><Input type="date" value={f.next_touchpoint} onChange={(e) => set({ next_touchpoint: e.target.value })} /></Field>
          <Field label="Touchpoint note"><Input placeholder="Follow up" value={f.next_touchpoint_title} onChange={(e) => set({ next_touchpoint_title: e.target.value })} /></Field>
          {isApprover && (
            <Field label="Assign touchpoint to" className="col-span-2">
              <Select value={f.assignee} onValueChange={(v) => set({ assignee: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {assignees.map((a) => <SelectItem key={a.username} value={a.username}>{a.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="First call summary" className="col-span-2"><Input value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>Add client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
