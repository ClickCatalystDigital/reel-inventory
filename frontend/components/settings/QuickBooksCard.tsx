"use client";

// QuickBooks Online card (Settings > Integrations, North American public demo only; utils/quickbooks.js). Says so when the
// server has no QuickBooks keys. Connect, Disconnect and the mapping: only the owner-pass browser; everyone else sees the
// live state read-only. Which accounts fit and the suggested matches come from the server (/accounts), not a copy here.
import { useCallback, useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { sendToQuickBooks, useQboState } from "@/components/docs/QuickBooksStatus";

interface LocalAccount { code: string; name: string; account_type: string }
interface QboAccount { id: string; name: string; type: string }
interface Connection {
  status: string; realm_id?: string; connected_by?: string; connected_at?: string; refresh_expires_at?: string | null;
  last_error?: string | null; account_map?: Record<string, string>;
}
interface Status {
  enabled: boolean; environment?: string; canManage?: boolean; manageNote?: string | null; connection?: Connection; localAccounts?: LocalAccount[];
}
interface Accounts { accounts: QboAccount[]; fits: Record<string, string[]>; suggested: Record<string, string> }

const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

export function QuickBooksCard() {
  const [s, setS] = useState<Status | null>(null);
  const [qb, setQb] = useState<Accounts | null>(null);
  const [qbError, setQbError] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const qbo = useQboState(); // the Sending section; quiet until connected

  const load = useCallback(() => {
    api<Status>("/api/quickbooks/status")
      .then((r) => {
        setS(r);
        setMap(r.connection?.account_map || {});
        if (r.connection?.status !== "connected") return;
        setQbError(null);
        api<Accounts>("/api/quickbooks/accounts")
          .then((a) => {
            setQb(a);
            // Nothing mapped yet: start from suggested matches; the owner reviews and saves.
            if (!Object.keys(r.connection?.account_map || {}).length) setMap(a.suggested);
          })
          .catch((err: Error) => setQbError(err.message));
      })
      .catch(() => {}); // api() already toasted
  }, []);
  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // The Intuit round trip comes back as ?qbo=connected or ?qbo_error=...
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get("qbo");
    const err = url.searchParams.get("qbo_error");
    if (!ok && !err) return;
    if (ok) showToast("QuickBooks connected");
    else showToast(err!, "error");
    url.searchParams.delete("qbo");
    url.searchParams.delete("qbo_error");
    window.history.replaceState(null, "", url);
  }, []);

  if (!s) return null;
  if (!s.enabled) return <p className="text-sm text-muted-foreground">QuickBooks is not set up on this server yet.</p>;
  const c = s.connection || { status: "not_connected" };
  const connected = c.status === "connected";
  const saved = c.account_map || {};
  const dirty = JSON.stringify(map) !== JSON.stringify(saved);
  const locals = s.localAccounts || [];

  async function disconnect() {
    if (!window.confirm("Disconnect QuickBooks? Inventory Ops will stop sending to it until you connect again.")) return;
    setBusy(true);
    try {
      await api("/api/quickbooks/disconnect", { method: "POST" });
      showToast("Disconnected");
      setQb(null);
      load();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }
  async function saveMap() {
    setBusy(true);
    try {
      const full = Object.fromEntries(locals.map((a) => [a.code, map[a.code] || ""]));
      const r = await api<{ account_map: Record<string, string> }>("/api/quickbooks/account-map", { method: "PUT", body: { map: full } });
      setS((prev) => (prev ? { ...prev, connection: { ...prev.connection!, account_map: r.account_map } } : prev));
      setMap(r.account_map);
      showToast("Account mapping saved");
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  const connectLabel = c.status === "disconnected" ? "Reconnect QuickBooks" : "Connect to QuickBooks";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Link2 className="size-4" />QuickBooks Online</h2>
        <div className="flex items-center gap-2">
          {s.environment === "sandbox" && <Badge variant="outline">Sandbox</Badge>}
          <Badge variant={connected ? "default" : "secondary"}>{connected ? "Connected" : c.status === "disconnected" ? "Disconnected" : "Not connected"}</Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 text-sm">
        {!connected && (
          <>
            <p className="text-xs text-muted-foreground">
              Inventory Ops keeps the books and sends customers, invoices, payments and bills to QuickBooks for your accountant.
              {c.status === "disconnected" && c.last_error ? ` ${c.last_error}` : ""}
            </p>
            <div className="flex items-center gap-3">
              {s.canManage ? (
                <Button size="sm" asChild><a href="/api/quickbooks/connect">{connectLabel}</a></Button>
              ) : (
                <Button size="sm" disabled title={s.manageNote || ""}>{connectLabel}</Button>
              )}
              {!s.canManage && s.manageNote && <span className="text-xs text-muted-foreground">{s.manageNote}</span>}
            </div>
          </>
        )}
        {connected && (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">QuickBooks company ID: </dt><dd className="inline">{c.realm_id}</dd></div>
              <div><dt className="inline text-muted-foreground">Connected by: </dt><dd className="inline">{c.connected_by} · {when(c.connected_at)}</dd></div>
              {c.refresh_expires_at && <div><dt className="inline text-muted-foreground">Sign-in valid until: </dt><dd className="inline">{when(c.refresh_expires_at)} (renews with use)</dd></div>}
            </dl>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Account mapping</h3>
              <p className="text-xs text-muted-foreground">Pick the QuickBooks account each ledger posts to. Unmapped accounts are not sent. Sales tax is worked out by QuickBooks, so it has no row here.</p>
              {dirty && !Object.keys(saved).length && <p className="text-xs text-primary">Suggested matches are filled in. Review them and save.</p>}
              {qbError && <p className="text-xs text-destructive">{qbError}</p>}
              {!qb && !qbError && <p className="text-xs text-muted-foreground">Loading QuickBooks accounts…</p>}
              {qb && (
                <div className="flex flex-col divide-y rounded-md border">
                  {locals.map((a) => {
                    const fits = new Set(qb.fits[a.code]);
                    const picked = qb.accounts.find((q) => q.id === map[a.code]);
                    const options = [...qb.accounts].sort((x, y) => Number(fits.has(y.id)) - Number(fits.has(x.id)));
                    return (
                      <div key={a.code} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_1.2fr]">
                        <div className="text-xs">{a.name}</div>
                        <div className="flex flex-col gap-1">
                          <select
                            className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-60"
                            value={map[a.code] || ""}
                            disabled={!s.canManage}
                            onChange={(e) => setMap((m) => ({ ...m, [a.code]: e.target.value }))}
                            aria-label={`QuickBooks account for ${a.name}`}
                          >
                            <option value="">— not sent —</option>
                            {options.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.type})</option>)}
                          </select>
                          {picked && !fits.has(picked.id) && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">Unusual: a {a.account_type} account mapped to a {picked.type} account.</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Sending</h3>
              <p className="text-xs text-muted-foreground">
                A sales invoice goes to QuickBooks once every line has a rate, and an approved purchase invoice goes as a supplier bill (sales tax paid as its own line).
                Payments received and payments made are sent here with Send (the books sync records them, not this app); a payment received names its invoice when it can, otherwise it goes in unapplied,
                while a payment made must name its bill, so those that do not are skipped. QuickBooks works out the sales tax on sales.
              </p>
              <p className="text-xs">Sent today: <strong>{qbo.state?.sentToday ?? 0}</strong></p>
              {!!qbo.state?.unlinked && <p className="text-xs text-muted-foreground">{qbo.state.unlinked} payment{qbo.state.unlinked === 1 ? "" : "s"} made not linked to a supplier bill, so not sent.</p>}
              {qbo.state?.failures.length === 0 && <p className="text-xs text-muted-foreground">No failures.</p>}
              {[...(qbo.state?.failures || []).map((f) => ({ ...f, label: ({ invoice: "Invoice", receipt: "Payment received", bill: "Supplier bill", vendor_payment: "Payment made" } as const)[f.kind] + ` ${f.no}`, note: f.error, action: "Retry" })),
                ...(qbo.state?.unsent || []).map((u) => ({ kind: u.kind, id: u.id, label: `${u.kind === "receipt" ? "Payment received" : "Payment made"} ${u.no}`, note: `${u.party} · ${u.amount} not sent yet`, action: "Send" }))].map((f) => (
                <div key={`${f.kind}-${f.id}-${f.action}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
                  <div className="min-w-0"><div className="font-medium">{f.label}</div><div className={`truncate ${f.action === "Retry" ? "text-destructive" : "text-muted-foreground"}`} title={f.note}>{f.note}</div></div>
                  <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); await sendToQuickBooks(f.kind, f.id); setBusy(false); qbo.reload(); }}>{f.action}</Button>
                </div>
              ))}
            </div>

            {s.canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !dirty || !qb} onClick={saveMap}>Save mapping</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={disconnect}>Disconnect</Button>
              </div>
            ) : (
              s.manageNote && <p className="text-xs text-muted-foreground">{s.manageNote}</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
