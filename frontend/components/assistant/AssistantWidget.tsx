"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, ArrowUpRight, ClipboardList, Package, RotateCcw, Sparkles, Truck, TriangleAlert, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { safePath, type Reply } from "@/lib/assistant-links";
import { ResultCard } from "./ResultCard";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content?: string; // user text, or a plain-text rendering of the reply (sent back as history)
  reply?: Reply;
  error?: { text: string; link?: string; linkLabel?: string };
}

const STARTERS = [
  { icon: Package, q: "How many reels of BLDC CARD do we have?" },
  { icon: Truck, q: "What did we ship to Gelco Electronics in September?" },
  { icon: TriangleAlert, q: "What's low on stock?" },
  { icon: ClipboardList, q: "Which POs are confirmed but not dispatched?" },
];

const replyText = (r: Reply) => [r.title, r.summary, r.text].filter(Boolean).join(" — ");

function Avatar() {
  return (
    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-blue-500 text-white shadow-sm">
      <Sparkles className="size-3.5" />
    </span>
  );
}

function Thinking() {
  return (
    <div className="flex items-start gap-2">
      <Avatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-muted px-3.5 py-3 text-xs text-muted-foreground">
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
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(1);

  const isAdmin = user?.role === "admin";
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
          body: JSON.stringify({ messages: history, path: pathname }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.reply) {
          setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", error: { text: data?.error || "Something went wrong. Please try again.", link: data?.link, linkLabel: data?.linkLabel } }]);
        } else {
          setMsgs((m) => [...m, { id: idRef.current++, role: "assistant", reply: data.reply, content: replyText(data.reply) }]);
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

  if (!isAdmin) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open LS AI"
        title="LS AI"
        className="group fixed bottom-[136px] right-4 z-40 grid size-14 place-items-center rounded-full bg-gradient-to-br from-primary to-blue-500 text-white shadow-lg shadow-primary/30 ring-1 ring-white/25 transition-all hover:scale-105 hover:shadow-xl hover:shadow-primary/40 active:scale-95 md:bottom-6 md:right-6 print:hidden"
      >
        <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/20 [animation-duration:2.6s] [animation-iteration-count:3]" />
        <Sparkles className="size-6 transition-transform group-hover:rotate-12" />
      </button>
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
        "md:inset-auto md:bottom-6 md:right-6 md:h-[min(42rem,calc(100dvh-3rem))] md:w-[27rem] md:rounded-2xl md:border md:pt-0 md:shadow-2xl md:shadow-black/20 md:ring-1 md:ring-black/5"
      )}
    >
      {/* header */}
      <div className="relative flex items-center gap-3 border-b bg-gradient-to-b from-primary/[0.07] to-transparent px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-blue-500 text-white shadow-sm">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">LS AI</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" /> Read-only · your LS TECH data
          </p>
        </div>
        {quota && <span className="hidden rounded-full border bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground sm:inline">{quota.used}/{quota.cap} today</span>}
        <button type="button" onClick={() => setMsgs([])} disabled={busy || !msgs.length} aria-label="New conversation" title="New conversation" className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30">
          <RotateCcw className="size-4" />
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" title="Close" className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {/* conversation */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {msgs.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center gap-5 pb-4 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-blue-500/10 text-primary ring-1 ring-primary/10">
              <Sparkles className="size-7" />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold tracking-tight">Ask about your LS TECH data</p>
              <p className="mx-auto max-w-[19rem] text-[13px] leading-relaxed text-muted-foreground">Stock, shipments, purchase orders, tasks and clients — or how to do something in the app.</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {STARTERS.map(({ icon: Icon, q }) => (
                <button key={q} type="button" onClick={() => send(q)} className="group flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left text-[13px] shadow-sm transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="flex-1">{q}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {msgs.map((m, idx) =>
            m.role === "user" ? (
              <div key={m.id} className="max-w-[88%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-relaxed text-primary-foreground shadow-sm">
                {m.content}
              </div>
            ) : (
              <div key={m.id} ref={idx === msgs.length - 1 ? lastAnswerRef : undefined} className="flex scroll-mt-2 items-start gap-2">
                <Avatar />
                <div className="min-w-0 flex-1 space-y-2">
                  {m.error ? (
                    <div className="rounded-2xl rounded-tl-md border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive">
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
                      <div className="rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                        {m.reply.title && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{m.reply.title}</p>}
                        <p className="whitespace-pre-wrap">{m.reply.text}</p>
                      </div>
                      {m.reply.link && safePath(m.reply.link.path) && (
                        <Link href={m.reply.link.path} onClick={closeOnPhone} className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/5">
                          {m.reply.link.label} <ArrowUpRight className="size-3" />
                        </Link>
                      )}
                      {[...(m.reply.chips ?? []), ...(m.reply.options ?? [])].length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {[...(m.reply.chips ?? []), ...(m.reply.options ?? [])].map((c) => (
                            <button key={c.label} type="button" disabled={busy} onClick={() => send(c.send)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:text-primary disabled:opacity-50">
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            )
          )}
          {busy && <Thinking />}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer */}
      <form
        className="border-t bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/10">
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
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground/70">Answers come from your live data. Check important numbers before acting.</p>
      </form>
    </div>
  );
}
