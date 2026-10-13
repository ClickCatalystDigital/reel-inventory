"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Boxes, ClipboardCheck, FileBarChart, Loader2, QrCode, ScanLine, ShieldCheck, Store, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { track } from "@/components/demo/DemoAnalytics";

// Public demo entry (demo build only; the Worker serves it when DEMO_MODE=1): a short form, then the visitor
// picks a sample login. Same flow as SB Ops' /demo. Only things this app does today.
const FEATURES = [
  [QrCode, "Every reel labelled", "Reels and boxes get their own number and a printable QR label the moment they come in."],
  [ScanLine, "Scan-cart dispatch", "Scan reels into a cart, ship full or part reels against the customer's PO, print the packing list."],
  [Store, "Two stores, one view", "Move reels or whole boxes between the main store and a partner store; filter any screen by store."],
  [ClipboardCheck, "Approvals built in", "Store staff changes wait for a manager; the partner store signs off yesterday's dispatches each morning."],
  [Users, "Customers and POs", "Clients, contacts, purchase orders from draft to dispatched, and a follow-up calendar."],
  [Boxes, "Customer stock portal", "Each customer logs in to see only the stock kept for them."],
  [FileBarChart, "Reports that trace", "Stock summary, search and trace by reel, dead and low stock, daily report as PDF."],
  [ShieldCheck, "Role-based access", "Owner, manager, store staff, partner store and customer logins each see only their screens."],
] as const;

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

  useEffect(() => {
    fetch("/api/demo/roles")
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
      track("generate_lead", { form: "demo" });
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
      track("demo_role_selected", { role: username });
      window.location.assign(r.home || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <section className="order-2 space-y-6 lg:order-none">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Ahrom Labs · live demo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Inventory and CRM for electronics-component traders</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Walk through a working copy with sample data for Acme Components, a made-up trader: reels in two stores, customer POs
            and dispatches. Click anything; changes reset every night.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map(([Icon, title, text]) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
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
  );
}
