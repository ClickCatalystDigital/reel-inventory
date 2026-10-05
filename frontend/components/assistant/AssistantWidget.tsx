"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, ArrowUpRight, ChevronDown, RotateCcw, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { capitalize } from "@/lib/crm";
import { safePath, type Briefing, type Reply } from "@/lib/assistant-links";
import { ChipMark } from "./ChipMark";
import { ResultCard } from "./ResultCard";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content?: string; // user text, or a plain-text rendering of the reply (sent back as history)
  reply?: Reply;
  error?: { text: string; link?: string; linkLabel?: string };
}

const DEFAULT_STARTERS = ["How many reels of BLDC CARD do we have?", "What did we ship to Gelco Electronics in September?", "What's low on stock?", "Which POs are confirmed but not dispatched?"];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const todayKey = () => new Date().toLocaleDateString("en-CA");
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const replyText = (r: Reply) => [r.title, r.summary, r.text].filter(Boolean).join(" — ");

function Thinking() {
  return (
    <div className="flex items-start">
      <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
        Looking that up…
      </div>
    </div>
  );
}

// LS AI: floating chat bubble (bottom-right) for the admin only. Answers come from fixed read-only look-ups;
// the conversation lives in this component (nothing is stored server-side except a one-line question log).
export function AssistantWidget() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<{ used: number; cap: number } | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefOpen, setBriefOpen] = useState(true);
  const [usual, setUsual] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>(DEFAULT_STARTERS);
  const [teaser, setTeaser] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(1);
  const contextRef = useRef<Record<string, unknown> | null>(null); // what the last table answer was about, for follow-ups

  const isAdmin = user?.role === "admin";
  const name = user ? capitalize(user.username) : "";
  const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  // A new answer scrolls to its START (so the headline is visible, not the bottom of a long table); your own message
  // and the "looking that up" indicator scroll to the end.
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const lastIsAnswer = msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && !busy;
    if (lastIsAnswer && lastAnswerRef.current) lastAnswerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    if (isPhone()) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Greeting: once a day a small note appears beside the bubble (this replaces the old "Good morning" toast on Home).
  useEffect(() => {
    if (!isAdmin || store.get("lsai_greeted") === todayKey()) return;
    const on = setTimeout(() => { setTeaser(true); store.set("lsai_greeted", todayKey()); }, 1200);
    const off = setTimeout(() => setTeaser(false), 11000);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [isAdmin]);

  // Briefing + "your usual" questions load the first time the panel opens, and again after a new conversation.
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || !isAdmin || loaded.current) return;
    loaded.current = true;
    fetch("/api/assistant/briefing").then((r) => (r.ok ? r.json() : null)).then((b: Briefing | null) => {
      if (!b) return;
      setBriefing(b);
      setBriefOpen(store.get("lsai_brief_hidden") !== `${b.day}|${b.part}`);
    }).catch(() => {});
    fetch("/api/assistant/starters").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setUsual(d.usual ?? []);
      if (d.defaults?.length) setDefaults(d.defaults);
    }).catch(() => {});
  }, [open, isAdmin]);

  function toggleBrief() {
    setBriefOpen((o) => {
      if (briefing) store.set("lsai_brief_hidden", o ? `${briefing.day}|${briefing.part}` : "");
      return !o;
    });
  }

  const send = useCallback(
    async (raw?: string) => {
      const q = (raw ?? text).trim();
      if (!q || busy) return;
      const next: Msg[] = [...msgs, { id: idRef.current++, role: "user", content: q }];
      setMsgs(next);
      setText("");
      setBusy(true);
      try {
        const history = next
          .filter((m) => !m.error)
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content || (m.reply ? replyText(m.reply) : "") }))
          .filter((m) => m.content);
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, path: pathname, context: contextRef.current }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.reply) {
          setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", error: { text: data?.error || "Something went wrong. Please try again.", link: data?.link, linkLabel: data?.linkLabel } }]);
        } else {
          setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", reply: data.reply, content: replyText(data.reply) }]);
          if (data.reply.type === "table") contextRef.current = data.reply.context ?? null;
          else if (data.reply.type === "text") contextRef.current = null;
          if (data.meta) setQuota({ used: data.meta.used, cap: data.meta.cap });
        }
      } catch {
        setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", error: { text: "Could not reach the server. Check your connection and try again." } }]);
      } finally {
        setBusy(false);
      }
    },
    [msgs, text, busy, pathname]
  );

  const reset = () => { setMsgs([]); contextRef.current = null; };

  if (!isAdmin) return null;

  if (!open) {
    return (
      <>
        {teaser && (
          <button
            type="button"
            onClick={() => { setTeaser(false); setOpen(true); }}
            className="fixed bottom-[144px] right-[4.75rem] z-40 max-w-[15rem] animate-in fade-in slide-in-from-right-2 rounded-xl border bg-card px-3 py-2 text-left shadow-md duration-300 md:bottom-8 md:right-[5.5rem] print:hidden"
          >
            <span className="block text-[13px] font-medium">{greeting()}, {name}</span>
            <span className="block text-[11px] text-muted-foreground">Your briefing is ready</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => { setTeaser(false); setOpen(true); }}
          aria-label="Open LS AI"
          title="LS AI"
          className="group fixed bottom-[136px] right-4 z-40 grid size-14 place-items-center rounded-full bg-foreground text-background shadow-lg ring-1 ring-black/10 transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6 print:hidden"
        >
          <ChipMark className="size-7" />
        </button>
      </>
    );
  }

  const closeOnPhone = () => isPhone() && setOpen(false);

  return (
    <div
      role="dialog"
      aria-label="LS AI assistant"
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden bg-background print:hidden",
        "inset-0 pt-[env(safe-area-inset-top)] animate-in fade-in slide-in-from-bottom-3 duration-200",
        "md:inset-auto md:bottom-6 md:right-6 md:h-[min(42rem,calc(100dvh-3rem))] md:w-[27rem] md:rounded-2xl md:border md:pt-0 md:shadow-2xl md:shadow-black/20"
      )}
    >
      {/* header */}
      <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
          <ChipMark className="size-[18px]" />
        </span>
        <p className="flex-1 text-sm font-semibold tracking-tight">LS AI</p>
        <button type="button" onClick={reset} disabled={busy || !msgs.length} aria-label="New conversation" title="New conversation" className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30">
          <RotateCcw className="size-4" />
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" title="Close" className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {/* conversation */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {msgs.length === 0 && (
          <div className="flex min-h-full flex-col justify-center gap-5 pb-2">
            <div>
              <p className="text-lg font-semibold tracking-tight">{greeting()}, {name}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Ask about stock, shipments, POs, tasks or clients.</p>
            </div>

            {briefing && (
              <div className="rounded-xl border bg-card">
                <button type="button" onClick={toggleBrief} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left" aria-expanded={briefOpen}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{briefing.part === "morning" ? "Morning briefing" : briefing.part === "afternoon" ? "Afternoon briefing" : "Evening briefing"} · {briefing.dayLabel}</span>
                    <span className="mt-0.5 block text-[13px] font-medium leading-snug">{briefing.headline}</span>
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", briefOpen && "rotate-180")} />
                </button>
                {briefOpen && (
                  <ul className="divide-y border-t text-[13px]">
                    {briefing.items.map((it) => {
                      const row = (
                        <>
                          <span className="flex-1 text-muted-foreground">{it.label}</span>
                          <span className={cn("font-semibold tabular-nums", it.tone === "warn" && "text-warning")}>{it.value}</span>
                          {it.link && <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/50" />}
                        </>
                      );
                      return (
                        <li key={it.label}>
                          {it.link && safePath(it.link) ? (
                            <Link href={it.link} onClick={closeOnPhone} className="flex items-center gap-2 px-3.5 py-2 transition-colors hover:bg-muted/50">{row}</Link>
                          ) : (
                            <div className="flex items-center gap-2 px-3.5 py-2">{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              {usual.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your usual</p>}
              <div className="flex flex-wrap gap-1.5">
                {usual.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} className="rounded-full border bg-foreground px-3 py-1.5 text-left text-xs text-background transition-opacity hover:opacity-85">{q}</button>
                ))}
              </div>
              {usual.length > 0 && <p className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Try</p>}
              <div className="flex flex-col">
                {defaults.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} className="group flex items-center gap-2 border-b py-2 text-left text-[13px] last:border-b-0 hover:text-foreground">
                    <span className="flex-1 text-foreground/80 transition-colors group-hover:text-foreground">{q}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3.5">
          {msgs.map((m, idx) =>
            m.role === "user" ? (
              <div key={m.id} className="max-w-[88%] self-end rounded-xl rounded-br-sm bg-foreground px-3.5 py-2 text-[13.5px] leading-relaxed text-background">
                {m.content}
              </div>
            ) : (
              <div key={m.id} ref={idx === msgs.length - 1 ? lastAnswerRef : undefined} className="min-w-0 scroll-mt-2 space-y-2">
                {m.error ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive">
                    {m.error.text}
                    {m.error.link && (m.error.link.startsWith("http") ? (
                      <a href={m.error.link} target="_blank" rel="noreferrer" className="mt-1.5 block font-medium underline underline-offset-2">{m.error.linkLabel || "Open"}</a>
                    ) : (
                      <Link href={m.error.link} onClick={closeOnPhone} className="mt-1.5 block font-medium underline underline-offset-2">{m.error.linkLabel || "Open"}</Link>
                    ))}
                  </div>
                ) : m.reply?.type === "table" ? (
                  <ResultCard reply={m.reply} onNavigate={closeOnPhone} />
                ) : m.reply ? (
                  <>
                    <div className="rounded-xl bg-muted px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                      {m.reply.title && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{m.reply.title}</p>}
                      <p className="whitespace-pre-wrap">{m.reply.text}</p>
                    </div>
                    {m.reply.link && safePath(m.reply.link.path) && (
                      <Link href={m.reply.link.path} onClick={closeOnPhone} className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-muted">
                        {m.reply.link.label} <ArrowUpRight className="size-3" />
                      </Link>
                    )}
                    {[...(m.reply.chips ?? []), ...(m.reply.options ?? [])].length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {[...(m.reply.chips ?? []), ...(m.reply.options ?? [])].map((c) => (
                          <button key={c.label} type="button" disabled={busy} onClick={() => send(c.send)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50">
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )
          )}
          {busy && <Thinking />}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer */}
      <form
        className="border-t bg-background px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-card p-1.5 transition-shadow focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/10">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={600}
            placeholder="Ask about stock, shipments, POs…"
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70 md:text-sm"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label="Send"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-all hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/70">Read-only · live data{quota ? ` · ${quota.used}/${quota.cap} questions today` : ""}</p>
      </form>
    </div>
  );
}
