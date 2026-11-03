"use client";

// QuickBooks status label for a sales-invoice row (North American public demo only; the server checks too).
// State comes from GET /api/quickbooks/sync; Send / Retry call POST /api/quickbooks/send.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { DEMO } from "@/lib/brand";
const NA = process.env.NEXT_PUBLIC_MARKET === "NA"; // per module, see lib/market.ts
export const QBO = DEMO && NA;

export interface QboEntry { status: "sent" | "failed" | "not_sent"; qbo_doc?: string; ours?: number; theirs?: number; error?: string | null }
export interface QboState {
  invoices: Record<string, QboEntry>;
  failures: { kind: "invoice" | "receipt"; id: string; no: string; error: string; at: string }[];
  unsent: { id: string; no: string; party: string; amount: number }[];
  sentToday: number;
}

export async function sendToQuickBooks(kind: "invoice" | "receipt", id: string): Promise<boolean> {
  try {
    await api("/api/quickbooks/send", { method: "POST", body: { kind, id } });
    showToast("Sent to QuickBooks", "success");
    return true;
  } catch {
    return false; // api() already toasted the reason
  }
}

// `version` changes → reload (after a save). Quiet when QuickBooks is off or not connected.
export function useQboState(version?: unknown) {
  const [state, setState] = useState<QboState | null>(null);
  const reload = useCallback(() => {
    if (!QBO) return;
    api<QboState>("/api/quickbooks/sync").then(setState).catch(() => {});
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload, version]);
  return { state, reload };
}

export function QuickBooksStatus({ no, state, onChange }: { no: string; state: QboState | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const e = state?.invoices[no];
  if (!QBO || !e) return null;
  async function send() {
    setBusy(true);
    await sendToQuickBooks("invoice", no);
    setBusy(false);
    onChange();
  }
  const link = (label: string, title?: string) => (
    <button type="button" className="text-xs underline-offset-2 hover:underline disabled:opacity-60" disabled={busy} title={title} onClick={send}>{busy ? "Sending…" : label}</button>
  );
  if (e.status === "sent") {
    const differs = e.qbo_doc && e.qbo_doc !== no;
    return <span className="text-xs text-muted-foreground" title={e.theirs != null && e.ours != null && e.theirs !== e.ours ? `Total in QuickBooks ${e.theirs}, here ${e.ours}` : undefined}>In QuickBooks{differs ? ` · #${e.qbo_doc}` : ""}</span>;
  }
  if (e.status === "failed") return <span className="text-xs text-destructive" title={e.error || ""}>QuickBooks failed · {link("Retry", e.error || "")}</span>;
  return <span className="text-xs text-muted-foreground">Not in QuickBooks · {link("Send")}</span>;
}
