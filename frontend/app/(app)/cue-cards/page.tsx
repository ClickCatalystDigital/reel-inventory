"use client";

// Cue Cards: what you can say to Ohm AI, by area, with the capability ladder on top (utils/cueCards.js on the server).
// "Ask" opens the assistant with that prompt (the 'assistant:ask' event, components/assistant/AssistantWidget.tsx).
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND } from "@/lib/brand";

interface Level { key: string; n: number; label: string; blurb: string; status: "live" | "soon" }
interface Area { key: string; label: string }
interface Cue { area: string; level: string; q: string }
interface Data { levels: Level[]; areas: Area[]; cards: Cue[] }

const TONE: Record<string, string> = { know: "bg-sky-600", diagnose: "bg-amber-600", predict: "bg-violet-500/60", optimize: "bg-emerald-500/60", execute: "bg-foreground" };
const ask = (q: string) => window.dispatchEvent(new CustomEvent("assistant:ask", { detail: { q } }));

export default function CueCardsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api<Data>("/api/assistant/cue-cards").then(setData).catch(() => {}); }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.cards ?? []).filter((c) => (!level || c.level === level) && (!area || c.area === area) && (!s || c.q.toLowerCase().includes(s)));
  }, [data, level, area, q]);
  const byLevel = Object.fromEntries((data?.levels ?? []).map((l) => [l.key, l]));
  const count = (k: string) => (data?.cards ?? []).filter((c) => c.level === k).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Cue Cards</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Things you can say to {BRAND.ai} (the button at the bottom right). Pick a card and press Ask, or say it your own way.
          Changes always show as a card first and are made only when you press Save.
        </p>
      </div>

      {/* The ladder: from explaining to acting. Tap a live step to see only its cards. */}
      {!data ? <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {data.levels.map((l) => {
            const live = l.status === "live", on = level === l.key;
            return (
              <button key={l.key} type="button" disabled={!live} onClick={() => setLevel(on ? null : l.key)} aria-pressed={on}
                className={cn("flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left transition-all", live ? "hover:-translate-y-0.5 hover:shadow-sm" : "cursor-default opacity-60", on && "ring-2 ring-foreground")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className={cn("grid size-6 place-items-center rounded-full text-[11px] font-semibold text-background", TONE[l.key])}>L{l.n}</span>
                    {l.label}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px]", live ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "border border-dashed text-muted-foreground")}>
                    {live ? `${count(l.key)} cards` : "Coming"}
                  </span>
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{l.blurb}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search prompts: reels, PO, transfer…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[{ key: null, label: "All" } as { key: string | null; label: string }, ...(data?.areas ?? [])].map((a) => (
            <button key={a.key ?? "all"} type="button" onClick={() => setArea(a.key)}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-xs transition-colors", area === a.key ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {!data ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div> : (
        <div className="flex flex-col gap-7">
          {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No prompts match. Try another word, or just ask in your own words.</p>}
          {data.areas.map((a) => {
            const cards = shown.filter((c) => c.area === a.key);
            if (!cards.length) return null;
            return (
              <section key={a.key} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{a.label}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((c) => {
                    const l = byLevel[c.level], doing = c.level === "execute";
                    return (
                      <div key={c.q} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                        <p className="flex-1 text-[14.5px] leading-snug">“{c.q}”</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className={cn("size-2 rounded-full", TONE[c.level])} />
                            L{l?.n} {l?.label}{doing ? " · confirms first" : ""}
                          </span>
                          <button type="button" onClick={() => ask(c.q)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted">
                            {doing ? <Wand2 className="size-3.5" /> : <ArrowUpRight className="size-3.5" />} Ask
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
