"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { safePath, type ActionDraft, type DraftField } from "@/lib/assistant-links";

type Val = string | number | null;

// A change Ohm AI prepared (utils/assistantActions.js): every field shown and editable, nothing saved until Save.
// Save sends the fields to /api/assistant/act, which checks them again and runs the app's own route as this person.
export function ActionCard({ draft, onNavigate }: { draft: ActionDraft; onNavigate?: () => void }) {
  const [values, setValues] = useState<Record<string, Val>>(draft.values);
  const [display, setDisplay] = useState<Record<string, string>>(Object.fromEntries(draft.fields.filter((f) => f.type === "ref").map((f) => [f.name, f.display || ""])));
  const [state, setState] = useState<"draft" | "saving" | "saved" | "cancelled">("draft");
  const [error, setError] = useState<string | null>(draft.errors?.join(". ") || null);
  const [done, setDone] = useState<{ summary: string; link?: string | null; pending?: boolean; message?: string | null } | null>(null);
  const del = draft.risk === "delete";
  const missing = draft.fields.filter((f) => f.required && empty(values[f.name]));

  async function save() {
    setState("saving"); setError(null);
    try {
      const res = await fetch("/api/assistant/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: draft.action, fields: values }) });
      const out = await res.json().catch(() => ({}));
      if (!out.ok) throw new Error(out.error || "Could not save");
      setDone(out); setState("saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); setState("draft"); }
  }

  if (state === "saved" && done) {
    const link = safePath(done.link?.split("?")[0].split("#")[0]) ? done.link : null;
    return (
      <p className="flex flex-wrap items-center gap-x-2 rounded-xl border border-emerald-600/25 bg-emerald-600/5 px-3.5 py-2 text-[13px]">
        <Check className="size-3.5 text-emerald-600" />
        {done.pending ? `Sent for approval: ${done.summary}.` : `Done: ${done.summary}.`}
        {link && <Link href={link} onClick={onNavigate} className="inline-flex items-center gap-0.5 text-xs font-medium underline underline-offset-2">Open <ArrowUpRight className="size-3" /></Link>}
      </p>
    );
  }
  if (state === "cancelled") return <p className="text-[12.5px] text-muted-foreground">Not saved.</p>;

  return (
    <div className={cn("rounded-xl border bg-card p-3.5", del && "border-destructive/50")}>
      <p className={cn("mb-2.5 flex items-start gap-1.5 text-[13.5px] font-medium", del && "text-destructive")}>
        {del ? <Trash2 className="mt-0.5 size-3.5 shrink-0" /> : <Wand2 className="mt-0.5 size-3.5 shrink-0" />} {draft.summary}
      </p>
      {del && <p className="mb-2 text-[12px] text-destructive">This removes or reverses it. Check it is the right one.</p>}
      <div className="flex flex-col gap-2">
        {draft.fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-[12px]">
            <span className={cn("text-muted-foreground", f.required && empty(values[f.name]) && "font-medium text-destructive")}>{f.label}{f.required ? "" : " (optional)"}</span>
            <Field f={f} value={values[f.name]} display={display[f.name]} onChange={(v, d) => { setValues((x) => ({ ...x, [f.name]: v })); if (d !== undefined) setDisplay((x) => ({ ...x, [f.name]: d })); }} />
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => setState("cancelled")} className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground">Cancel</button>
        <button type="button" onClick={save} disabled={state === "saving" || missing.length > 0}
          className={cn("rounded-md px-3 py-1.5 text-[13px] transition-opacity hover:opacity-90 disabled:opacity-50", del ? "bg-destructive text-white" : "bg-foreground text-background")}>
          {state === "saving" ? "Saving…" : missing.length ? `Add ${missing[0].label.toLowerCase()}` : del ? "Confirm" : "Save"}
        </button>
      </div>
    </div>
  );
}

const box = "h-9 text-base md:text-sm";

function Field({ f, value, display, onChange }: { f: DraftField; value: Val; display?: string; onChange: (v: Val, d?: string) => void }) {
  if (f.type === "longtext") return <Textarea value={value ?? ""} rows={2} maxLength={1000} onChange={(e) => onChange(e.target.value)} className="text-base md:text-sm" />;
  if (f.type === "date") return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className={cn(box, "w-44")} />;
  if (f.type === "enum") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {f.options?.map((o) => (
          <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors", String(value) === String(o.value) ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (f.type === "ref") {
    // Picked: its name, with a way to change it. Not sure: the closest matches. Nothing found: type a name (the server finds it).
    if (!empty(value) && display) {
      return (
        <span className="flex items-center gap-2">
          <span className="rounded-full border bg-muted/50 px-3 py-1 text-[12.5px]">{display}</span>
          <button type="button" onClick={() => onChange(null, "")} className="text-[12px] text-muted-foreground underline underline-offset-2">change</button>
        </span>
      );
    }
    return (
      <span className="flex flex-col gap-1.5">
        {f.options && f.options.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {f.options.map((o) => (
              <button key={String(o.value)} type="button" onClick={() => onChange(o.value, o.label)} className="rounded-full border px-3 py-1 text-left text-[12.5px] hover:bg-muted">{o.label}</button>
            ))}
          </span>
        )}
        <Input value={String(value ?? "")} placeholder="Type a name or number" onChange={(e) => onChange(e.target.value || null)} className={box} />
      </span>
    );
  }
  const numeric = f.type === "money" || f.type === "number";
  return <Input value={String(value ?? "")} inputMode={numeric ? "decimal" : f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
    onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} className={box} />;
}

function empty(v: Val) { return v == null || v === ""; }
