"use client";

import { useEffect } from "react";
import { ArrowUpRight, Lock, X } from "lucide-react";
import { BRAND } from "@/lib/brand";

// Demo build only: shown when a visitor has used their free AI questions (utils/demo.js AI_QUESTIONS), and
// again every time they click the locked assistant button.
export function AiLimitOverlay({ limit, onClose }: { limit: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 print:hidden" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="ai-limit-title" className="relative w-full max-w-sm rounded-2xl border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
        <span className="grid size-10 place-items-center rounded-xl bg-muted"><Lock className="size-5" /></span>
        <h2 id="ai-limit-title" className="mt-4 text-lg font-semibold tracking-tight">That was your {limit} free questions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {BRAND.ai} answers from live stock, shipments, POs and customers. To set it up on your own data, or to ask more here,
          get in touch with Ahrom Labs.
        </p>
        <a
          href="https://ahromlabs.com/#contact"
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Set it up for your business <ArrowUpRight className="size-4" />
        </a>
        <button type="button" onClick={onClose} className="mt-2 h-10 w-full rounded-lg text-sm text-muted-foreground hover:bg-muted">
          Keep exploring the demo
        </button>
      </div>
    </div>
  );
}
