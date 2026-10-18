"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUp, ChevronRight, Loader2 } from "lucide-react";
import { FEATURES } from "@/lib/demo-features";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { track } from "@/components/demo/DemoAnalytics";

// Public demo entry (demo build only; the Worker serves it when DEMO_MODE=1): a short form, then the visitor
// picks a sample login. Same flow as SB Ops' /demo. Only things this app does today.
const FIELDS = [
  ["name", "Your name", "text", true],
  ["company", "Company", "text", true],
  ["email", "Work email", "email", true],
  ["phone", "Phone (optional)", "tel", false],
  ["business", "What do you trade or stock? (optional)", "text", false],
] as const;

type Role = { username: string; label: string; blurb: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function DemoPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [step, setStep] = useState<"loading" | "form" | "roles">("loading");
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [passOpen, setPassOpen] = useState(false);
  const [pin, setPin] = useState("");
  async function usePass(pass: string) {
    setBusy("pass"); setError("");
    try { await post("/api/demo/pass", { pass }); setStep("roles"); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); setPin(""); }
    finally { setBusy(null); }
  }

  useEffect(() => {
    // Owner pass (utils/demo.js): /demo#pass=… goes straight to the roles. The secret is wiped from the address bar
    // and is only ever sent in a POST body.
    const pass = new URLSearchParams(window.location.hash.slice(1)).get("pass");
    if (pass) history.replaceState(null, "", window.location.pathname);
    (pass ? fetch("/api/demo/pass", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pass }) }).catch(() => null) : Promise.resolve(null))
      .then(() => fetch("/api/demo/roles"))
      .then((r) => r.json())
      .then((d) => {
        setRoles(d.roles || []);
        setStep(d.hasLead ? "roles" : "form");
      })
      .catch(() => setStep("form"));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError("");
    try {
      await post("/api/demo/lead", form);
      track("electronics_demo_form_sent");
      setStep("roles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function enter(username: string) {
    setBusy(username);
    setError("");
    try {
      const r = await post("/api/demo/enter", { username });
      track("electronics_demo_login", { role: username });
      window.location.assign(r.home || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  return (
    <>
    {/* Slim header: who made this and where to read more (not the full ahromlabs.com navbar, so the form stays the focus). */}
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 text-sm">
        <a href="https://ahromlabs.com" title="Ahrom Labs" className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 1 KB static mark; next/image adds nothing here */}
          <img src="/ahrom-labs-mark.webp" alt="Ahrom Labs" width={28} height={28} className="size-7 dark:invert" />
        </a>
        <nav className="flex items-center gap-4 text-muted-foreground sm:gap-6">
          <a href="https://ahromlabs.com/industries/electronics-component-trading" className="hover:text-foreground">How it was built</a>
          <a href="https://ahromlabs.com/#contact" className="hover:text-foreground">Contact</a>
        </nav>
      </div>
    </header>
    <main id="top" className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <section className="order-2 min-w-0 space-y-6 lg:order-none">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Ahrom Labs · live demo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Inventory and CRM for electronics-component traders</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Walk through a working copy with sample data for Acme Components, a made-up trader: reels in two stores, customer POs
            and dispatches. Click anything; changes reset every night.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {/* Each feature links to its own section below (#in-detail), for visitors and search engines. */}
          {FEATURES.map(([Icon, title, text, id]) => (
            <li key={title}>
              <a href={`#${id}`} className="group -m-2 flex gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="flex items-center gap-1 text-sm font-medium">{title}<ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></p>
                  <p className="text-xs text-muted-foreground">{text}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          How it was built for a real trader:{" "}
          <a href="https://ahromlabs.com/industries/electronics-component-trading" className="font-medium text-foreground underline-offset-2 hover:underline">
            software for electronics-component importers and traders
          </a>
        </p>
      </section>

      <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">{step === "roles" ? "Choose who to be" : "Open the demo"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {step === "roles" ? "Each login sees the screens that role works in. Switch any time from the banner." : "Tell us who you are. No password, no card."}
        </p>
        <div className="mt-5">
          {step === "loading" ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : step === "form" ? (
            <form onSubmit={submit} className="space-y-4">
              {FIELDS.map(([key, label, type, required]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key}>{label}</Label>
                  <Input id={key} type={type} required={required} value={form[key] || ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy === "form"}>
                {busy === "form" ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continue
              </Button>
              <p className="text-xs text-muted-foreground">We use these details only to follow up about this system.</p>
              {/* Owner pass (utils/demo.js): a PIN skips the form and lifts the assistant's limit for this browser. */}
              {passOpen ? (
                <div className="flex items-center gap-2 border-t pt-3">
                  <Input type="password" inputMode="numeric" autoComplete="off" aria-label="Demo pass" placeholder="Demo pass" maxLength={12} value={pin}
                    onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (pin) usePass(pin); } }} className="h-9 w-36" autoFocus />
                  <Button type="button" variant="outline" size="sm" disabled={!pin || busy === "pass"} onClick={() => usePass(pin)}>
                    {busy === "pass" ? <Loader2 className="animate-spin" /> : "Enter"}
                  </Button>
                </div>
              ) : (
                <button type="button" onClick={() => setPassOpen(true)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Have a demo pass?</button>
              )}
            </form>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((r) => (
                <button
                  key={r.username}
                  type="button"
                  disabled={!!busy}
                  onClick={() => enter(r.username)}
                  className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-muted/50 disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {r.label}
                    {busy === r.username && <Loader2 className="size-3.5 animate-spin" />}
                  </span>
                  <span className="text-xs text-muted-foreground">{r.blurb}</span>
                </button>
              ))}
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </main>

    <section id="in-detail" aria-labelledby="in-detail-heading" className="mx-auto max-w-6xl border-t px-4 py-14">
      <h2 id="in-detail-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">What Inventory Ops does, in detail</h2>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Inventory Ops is reel-level inventory and CRM for electronic-component importers, traders and distributors: stock you
        can scan, dispatch checked against the customer&apos;s PO, and two stores in one view. Every feature below runs in the
        live demo above with sample data.
      </p>
      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-2">
        {FEATURES.map(([Icon, , , id, heading, body]) => (
          <article key={id} id={id} className="scroll-mt-8">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-5 text-primary" /></span>
              <h3 className="text-lg font-semibold tracking-tight">{heading}</h3>
            </div>
            {body.map((p, i) => <p key={i} className="mt-3 text-sm leading-relaxed text-muted-foreground">{p}</p>)}
            <a href="#top" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline">
              <ArrowUp className="size-3" /> Try it in the demo
            </a>
          </article>
        ))}
      </div>
    </section>
    </>
  );
}
