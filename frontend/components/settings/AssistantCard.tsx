"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

interface Balance { bought: number; used: number; left: number }
interface DataAccess { on: boolean; approver_name?: string; approver_role?: string; recorded_by?: string; at?: string }
interface Settings {
  model: string; hasKey: boolean; keyLast4: string | null; mode: "show" | "write"; cap: number;
  dataAccess: DataAccess; jevModel: string; balance: Balance | null; usedToday: number; creditsUrl: string;
}
interface Model { id: string; name: string; context: number | null; in: number | null; out: number | null }
interface TestResult { ok?: boolean; answered?: string; ms?: number; cost?: number; error?: string; link?: string; linkLabel?: string }

const price = (v: number | null) => (v === null ? "varies" : v === 0 ? "free" : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`);
const LOW_CREDIT = 0.05;

interface Miss { question: string; why: string; times: number; last: string }

// The to-do list for improving the assistant: questions it could not answer, or that you thumbed down, in the last 30 days.
function MissedQuestions() {
  const [rows, setRows] = useState<Miss[] | null>(null);
  const [open, setOpen] = useState(false);
  function toggle() {
    setOpen((o) => !o);
    if (rows === null) api<Miss[]>("/api/assistant/misses").then(setRows).catch(() => setRows([]));
  }
  return (
    <div className="space-y-2 border-t pt-4">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between text-left" aria-expanded={open}>
        <span className="text-sm font-medium">Questions it couldn’t answer</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </button>
      {open && (rows === null ? <Skeleton className="h-16 w-full" /> : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None in the last 30 days.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((r) => (
            <li key={`${r.question}-${r.why}`} className="flex items-start gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">{r.question}</span>
              <Badge variant="secondary" className="shrink-0 font-normal">{r.why}</Badge>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{r.times}×</span>
            </li>
          ))}
        </ul>
      ))}
      <p className="text-xs text-muted-foreground">Use this list to decide which look-ups to add next.</p>
    </div>
  );
}

// Searchable model list (there are hundreds of models, so a plain select is unusable).
function ModelPicker({ models, value, onChange }: { models: Model[] | null; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = models?.find((m) => m.id === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (models ?? []).filter((m) => !t || m.name.toLowerCase().includes(t) || m.id.toLowerCase().includes(t)).slice(0, 60);
  }, [models, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className="truncate">{picked ? picked.name : value}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,90vw)] p-0">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="border-0 pl-8 shadow-none focus-visible:ring-0" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {models === null ? (
            <p className="p-3 text-sm text-muted-foreground">Loading models…</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No model matches “{q}”.</p>
          ) : (
            shown.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setOpen(false); }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <Check className={cn("mt-0.5 size-4 shrink-0", m.id === value ? "text-primary" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.id} · in {price(m.in)} / out {price(m.out)} per million</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MODES = [
  { value: "show", title: "Show the data", body: "The decision model finds the right look-up and the answer is shown as a table, exactly as stored. No writing model, nothing is reworded, cheapest." },
  { value: "write", title: "Show, then write", body: "Same look-up, then a writing model words a short summary of the rows. Needs data access switched on below." },
] as const;

// Settings → Assistant (admin only): OpenRouter key, live credit, writing model, answer mode, daily limit,
// data-access consent. The decision model (Jev) is fixed on purpose.
export function AssistantCard() {
  const [s, setS] = useState<Settings | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"show" | "write">("show");
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [approver, setApprover] = useState("");
  const [approverRole, setApproverRole] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  function adopt(next: Settings) {
    setS(next);
    setModel(next.model);
    setMode(next.mode);
    setCap(String(next.cap));
  }

  async function load() {
    try { adopt(await api<Settings>("/api/assistant/settings")); } catch { /* api() already toasted */ }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    api<Model[]>("/api/assistant/models").then(setModels).catch(() => setModels([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function put(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    try {
      adopt(await api<Settings>("/api/assistant/settings", { method: "PUT", body }));
      if (done) showToast(done);
      return true;
    } catch {
      return false; // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!s) return;
    const body: Record<string, unknown> = {};
    if (keyInput.trim()) body.key = keyInput.trim();
    if (model !== s.model) body.model = model;
    if (mode !== s.mode) body.mode = mode;
    if (await put(body, "Assistant settings saved")) setKeyInput("");
  }

  async function removeKey() {
    if (window.confirm("Remove the saved OpenRouter key? The assistant stops working until a new key is saved.")) await put({ key: "" }, "Key removed");
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      // plain fetch (not api()) so a credit/key error keeps its link and shows inline instead of only as a toast
      const res = await fetch("/api/assistant/test", { method: "POST" });
      setTest(await res.json());
      load();
    } catch {
      setTest({ error: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  }

  async function switchOn() {
    if (await put({ dataAccess: { on: true, approver_name: approver, approver_role: approverRole, confirmed } }, "Data access switched on")) {
      setConsentOpen(false); setApprover(""); setApproverRole(""); setConfirmed(false);
    }
  }

  if (!s) return <Card className="p-5"><Skeleton className="h-40 w-full" /></Card>;

  const dirty = !!keyInput.trim() || model !== s.model || mode !== s.mode;
  const lowCredit = s.balance && s.balance.left <= LOW_CREDIT;
  const picked = models?.find((m) => m.id === model);

  return (
    <Card className="gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4 text-primary" /> LS AI</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            An assistant for LS TECH inventory, clients and tasks. Admin only. It routes each question with a decision model and answers from fixed, read-only look-ups.
          </p>
        </div>
        <Button onClick={save} disabled={busy || !dirty}>{busy ? <Loader2 className="animate-spin" /> : null} Save</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <Label>OpenRouter key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={s.hasKey ? `Saved (…${s.keyLast4}). Paste a new key to replace it` : "sk-or-…"}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            {s.hasKey && <Button variant="ghost" onClick={removeKey} disabled={busy}>Remove</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Stored encrypted and never shown again. Create one at openrouter.ai → Keys.</p>

          {s.hasKey && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              {s.balance ? (
                <div className="space-x-2">
                  <span className={cn("font-semibold tabular", lowCredit && "text-destructive")}>
                    ${s.balance.left.toFixed(2)} left{lowCredit ? " (too low to answer)" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground tabular">${s.balance.used.toFixed(2)} used of ${s.balance.bought.toFixed(2)} bought</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Credit could not be read. Check the key.</span>
              )}
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="underline underline-offset-2" onClick={load}>Refresh</button>
                <a href={s.creditsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Add credit</a>
              </div>
            </div>
          )}

          {s.hasKey && (
            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : null} Test connection
              </Button>
              {test && (
                <p className={cn("text-xs", test.ok ? "text-success" : "text-destructive")}>
                  {test.ok ? (
                    <>Working — Jev answered in {test.ms} ms for ${test.cost?.toFixed(5)}.</>
                  ) : (
                    <>
                      {test.error}{" "}
                      {test.link && <a href={test.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">{test.linkLabel || "Open"}</a>}
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Writing model</Label>
          <ModelPicker models={models} value={model} onChange={setModel} />
          <p className="text-xs text-muted-foreground">
            {picked
              ? `${picked.id} · input ${price(picked.in)}, output ${price(picked.out)} per million tokens${picked.context ? ` · reads up to ${picked.context.toLocaleString("en-IN")} tokens` : ""}`
              : "Used only in “Show, then write” mode and for how-to answers."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>How data answers are produced</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn("rounded-lg border p-3 text-left transition-colors", mode === m.value ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
            >
              <p className="text-sm font-medium">{m.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{m.body}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Decision model: {s.jevModel} (fixed). It picks the look-up, store and period, resolves names, and refuses requests to change data or unrelated topics. It never writes SQL.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Questions per day</Label>
            <span className="text-xs text-muted-foreground tabular">{s.usedToday} used today</span>
          </div>
          <div className="flex gap-2">
            <Input type="number" min={1} max={10000} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className="w-32" />
            <Button variant="outline" disabled={busy || cap === String(s.cap)} onClick={() => put({ cap: Number(cap) }, "Daily limit saved")}>Save limit</Button>
          </div>
          <p className="text-xs text-muted-foreground">A safety cap on total questions per day (resets at midnight IST).</p>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <Badge variant={s.dataAccess.on ? "default" : "outline"}>{s.dataAccess.on ? "On" : "Off"}</Badge>
            <p className="text-sm font-medium">Answers about live business data</p>
          </div>
          {s.dataAccess.on ? (
            <p className="text-xs text-muted-foreground">
              Approved by {s.dataAccess.approver_name}{s.dataAccess.approver_role ? `, ${s.dataAccess.approver_role}` : ""}. Recorded by {s.dataAccess.recorded_by}
              {s.dataAccess.at ? ` on ${formatDateTime(s.dataAccess.at.replace("T", " ").slice(0, 19))}` : ""}. Item and customer names are sent to OpenRouter to match your question; rows are sent only in “Show, then write” mode.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Off. Only your question and the look-up descriptions go to OpenRouter, never company data, so data questions can’t be answered yet. Switching this on needs the approval of OpenRouter’s terms to be recorded here.
            </p>
          )}
          {s.dataAccess.on ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => put({ dataAccess: { on: false } }, "Data access switched off")}>Switch off</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConsentOpen(true)}>Record approval and switch on</Button>
          )}
        </div>
      </div>

      <MissedQuestions />

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Record the approval</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              With this on, a question such as “what did we ship to Gelco in September?” sends item and customer names to OpenRouter (and, in “Show, then write” mode, the matching rows).
              Read OpenRouter’s <a className="underline" href="https://openrouter.ai/terms" target="_blank" rel="noreferrer">terms</a> and <a className="underline" href="https://openrouter.ai/privacy" target="_blank" rel="noreferrer">privacy policy</a> first.
            </p>
            <div className="space-y-1.5"><Label>Approved by</Label><Input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Full name" /></div>
            <div className="space-y-1.5"><Label>Their role</Label><Input value={approverRole} onChange={(e) => setApproverRole(e.target.value)} placeholder="e.g. Director" /></div>
            <Label className="items-start gap-2 font-normal">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
              <span>This person has read OpenRouter’s terms and privacy policy and agrees that company data may be sent to OpenRouter to answer questions. This is saved with my username and the time.</span>
            </Label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button disabled={busy || !approver.trim() || !confirmed} onClick={switchOn}>Switch on</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
