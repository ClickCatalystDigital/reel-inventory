"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PO_STATUS_LABEL, docDate, todayISO, type Company, type PoRow } from "@/lib/docs";
import { Chips, Kpi, StatusPill } from "./bits";
import { useDocs } from "./context";

type Stage = "all" | "draft" | "confirmed" | "overdue" | "dispatched" | "cancelled";
const daysFrom = (d: string, now: number) => Math.round((new Date(d).getTime() - now) / 86400000);

function Due({ p, now }: { p: PoRow; now: number }) {
  if (p.status === "dispatched") {
    const cycle = p.dispatch_date && p.order_date ? Math.round((new Date(p.dispatch_date).getTime() - new Date(p.order_date).getTime()) / 86400000) : null;
    return <div><div className="text-xs">{docDate(p.dispatch_date)}</div><div className="text-[10px] text-success">dispatched{cycle != null ? ` · ${cycle}d cycle` : ""}</div></div>;
  }
  if (!p.expected_dispatch_date || p.status === "cancelled") return <span className="text-xs text-muted-foreground">—</span>;
  const late = p.status === "confirmed" && p.expected_dispatch_date < todayISO();
  let chip: React.ReactNode = null;
  if (p.status === "confirmed") {
    const d = daysFrom(p.expected_dispatch_date, now);
    const text = d < 0 ? `${-d}d late` : d === 0 ? "due today" : `${d}d left`;
    chip = <div className={cn("text-[10px]", d <= 3 ? "font-bold text-destructive" : d <= 7 ? "font-bold text-warning" : "text-muted-foreground")}>{text}</div>;
  }
  return <div><div className={cn("text-xs", late && "font-bold text-destructive")}>{docDate(p.expected_dispatch_date)}</div>{chip}</div>;
}

// Customer POs: lifecycle draft → confirmed → dispatched (or cancelled), with an overdue / due-soon view.
export function PoTab() {
  const docs = useDocs();
  const [rows, setRows] = useState<PoRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stage, setStage] = useState<Stage>("all");
  const [company, setCompany] = useState("");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now()); // one clock per visit, so renders stay pure

  useEffect(() => {
    api<PoRow[]>("/api/po").then(setRows).catch(() => {});
  }, [docs.version]);
  useEffect(() => {
    api<Company[]>("/api/po/companies").then(setCompanies).catch(() => {});
  }, []);

  const today = todayISO();
  const in7 = new Date(now + 7 * 86400000).toISOString().slice(0, 10);
  const shown = useMemo(() => {
    const t = q.toLowerCase();
    return rows.filter((p) =>
      (stage === "all" ? true : stage === "overdue" ? p.status === "confirmed" && !!p.expected_dispatch_date && p.expected_dispatch_date < today : p.status === stage) &&
      (!company || String(p.company_id) === company) &&
      (!t || [p.po_number, p.company_name, p.poc_name].some((v) => v && v.toLowerCase().includes(t))));
  }, [rows, stage, company, q, today]);

  const draft = rows.filter((p) => p.status === "draft");
  const confirmed = rows.filter((p) => p.status === "confirmed");
  const dispatched = rows.filter((p) => p.status === "dispatched");
  const overdue = confirmed.filter((p) => p.expected_dispatch_date && p.expected_dispatch_date < today);
  const dueSoon = confirmed.filter((p) => p.expected_dispatch_date && p.expected_dispatch_date >= today && p.expected_dispatch_date <= in7);
  const partial = confirmed.filter((p) => (p.outward_count || 0) > 0);
  const stale = draft.filter((p) => p.created_at && (now - new Date(p.created_at).getTime()) / 86400000 > 5);
  const onTime = dispatched.filter((p) => p.dispatch_date && p.expected_dispatch_date && p.dispatch_date <= p.expected_dispatch_date);
  const onTimeRate = dispatched.length ? Math.round((onTime.length / dispatched.length) * 100) : null;
  const thisMonth = today.slice(0, 7);
  const upcoming = [...overdue, ...dueSoon.filter((p) => !overdue.includes(p))].sort((a, b) => (a.expected_dispatch_date! < b.expected_dispatch_date! ? -1 : 1)).slice(0, 6);
  const active = rows.filter((p) => ["draft", "confirmed"].includes(p.status));
  const byCo: Record<string, number> = {};
  for (const p of active) byCo[p.company_name || "—"] = (byCo[p.company_name || "—"] || 0) + 1;
  const topCos = Object.entries(byCo).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCo = Math.max(1, ...topCos.map(([, n]) => n));
  const topShare = topCos.length && active.length ? Math.round((topCos[0][1] / active.length) * 100) : 0;
  const filterCount = (stage !== "all" ? 1 : 0) + (company ? 1 : 0);

  async function act(path: string, body: unknown, msg: string) {
    try {
      await api(path, { method: "POST", body });
      showToast(msg, "success");
      docs.changed();
    } catch {
      // api() already toasted
    }
  }
  const quickDispatch = (id: number) => { if (confirm(`Mark as dispatched today (${today})?`)) act(`/api/po/${id}/dispatch`, { dispatch_date: today }, "PO dispatched"); };
  async function remove(id: number) {
    if (!confirm("Delete this Purchase Order permanently?")) return;
    try {
      await api(`/api/po/${id}`, { method: "DELETE" });
      showToast("Deleted", "success");
      docs.changed();
    } catch {
      // api() already toasted
    }
  }
  const filterCompany = (name: string) => {
    const c = companies.find((x) => x.name === name);
    if (!c) return;
    setCompany(String(c.id)); setStage("all"); setPanel(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi value={draft.length} label="Draft" sub={stale.length ? <span className="text-warning">{stale.length} stale (&gt;5d)</span> : "pending confirmation"} />
        <Kpi value={confirmed.length} label="Confirmed" sub={overdue.length ? <span className="font-bold text-destructive">{overdue.length} overdue</span> : partial.length ? <span className="text-warning">{partial.length} partially dispatched</span> : "in pipeline"} />
        <Kpi value={overdue.length} label="Overdue" tone={overdue.length ? "text-destructive" : "text-success"} sub={overdue.length ? "dispatch now" : "all on track"} className={overdue.length ? "border-destructive/40" : ""} />
        <Kpi value={dueSoon.length} label="Due This Week" tone={dueSoon.length ? "text-warning" : ""} sub={onTimeRate !== null ? `${onTimeRate}% on-time (${dispatched.length} total)` : `${dispatched.filter((p) => p.dispatch_date?.startsWith(thisMonth)).length} dispatched this month`} />
      </div>
      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {overdue.length ? `⚠ ${overdue.length} Need${overdue.length > 1 ? "" : "s"} Dispatch` : dueSoon.length ? "Due This Week" : "Upcoming Dispatch"}
          </div>
          {upcoming.map((p) => {
            const d = daysFrom(p.expected_dispatch_date!, now);
            return (
              <div key={p.id} className="flex items-center gap-2 border-b py-1.5 last:border-b-0">
                <div className="min-w-0 flex-1 truncate">
                  <button className="text-xs font-semibold hover:underline" onClick={() => docs.openPo(p.id)}>{p.po_number}</button>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{p.company_name}</span>
                </div>
                <span className={cn("text-[10px] font-bold", d <= 3 ? "text-destructive" : "text-warning")}>{d < 0 ? `${-d}d late` : d === 0 ? "today" : `${d}d left`}</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-success" onClick={() => quickDispatch(p.id)}>Dispatch</Button>
              </div>
            );
          })}
          {partial.filter((p) => !upcoming.some((u) => u.id === p.id)).length > 0 && (
            <div className={cn(upcoming.length && "mt-2 border-t pt-2")}>
              <div className="mb-1 text-[10px] font-semibold text-warning uppercase">Partial Dispatch — verify &amp; close</div>
              {partial.filter((p) => !upcoming.some((u) => u.id === p.id)).slice(0, 3).map((p) => (
                <div key={p.id} className="flex justify-between py-1 text-xs">
                  <button className="font-semibold hover:underline" onClick={() => docs.openPo(p.id)}>{p.po_number}</button>
                  <span className="text-[10px] text-warning">{p.outward_count} reel{p.outward_count !== 1 ? "s" : ""} out</span>
                </div>
              ))}
            </div>
          )}
          {!upcoming.length && !partial.length && <div className="text-xs text-muted-foreground">{confirmed.length ? "All confirmed POs on schedule." : "No confirmed POs in pipeline."}</div>}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Active Pipeline</div>
          {topCos.map(([name, n]) => (
            <div key={name} className="mb-1.5 flex items-center gap-2">
              <button title={name} onClick={() => filterCompany(name)} className="w-24 truncate text-left text-[10px] hover:underline">{name}</button>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-foreground" style={{ width: `${Math.round((n / maxCo) * 100)}%` }} /></div>
              <div className="w-4 text-right text-[10px] font-bold">{n}</div>
            </div>
          ))}
          {!topCos.length && <div className="text-xs text-muted-foreground">No active POs.</div>}
          {topShare >= 80 && active.length >= 2 && <div className="mt-2 text-[10px] font-semibold text-warning">⚠ {topShare}% from one customer</div>}
          {onTimeRate !== null && (
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">On-time rate</span>
              <span className={cn("text-sm font-bold", onTimeRate >= 80 ? "text-success" : onTimeRate >= 50 ? "text-warning" : "text-destructive")}>{onTimeRate}%</span>
            </div>
          )}
        </div>
      </div>

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => docs.openPo("new")}><Plus className="size-4" /> Create</Button>
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}><Upload className="size-4" /> Upload</Button>
          <input ref={file} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) docs.upload(f, "purchase_order"); }} />
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search PO number or company…" value={q} onChange={(e) => setQ(e.target.value.trim())} className="pl-8" />
          </div>
          <Button size="sm" variant={panel || filterCount ? "secondary" : "outline"} onClick={() => setPanel(!panel)}>
            <SlidersHorizontal className="size-4" /> Filters{filterCount ? ` (${filterCount})` : ""}
          </Button>
        </div>
        {panel && (
          <div className="flex flex-wrap items-start gap-5 rounded-lg border bg-muted/30 p-3">
            <label className="text-xs">
              <div className="mb-1 text-muted-foreground">Company</div>
              <select value={company} onChange={(e) => setCompany(e.target.value)} className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="text-xs">
              <div className="mb-1 text-muted-foreground">Stage</div>
              <Chips<Stage> value={stage} onChange={setStage} options={[{ value: "all", label: "All" }, { value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" }, { value: "overdue", label: "Overdue" }, { value: "dispatched", label: "Dispatched" }, { value: "cancelled", label: "Cancelled" }]} />
            </div>
          </div>
        )}
        <DataTable
          title="Purchase Orders"
          data={shown}
          pageSize={12}
          getRowKey={(p) => p.id}
          columns={[
            {
              label: "PO Number",
              render: (p) => (
                <span>
                  <button className="font-semibold hover:underline" onClick={() => docs.openPo(p.id)}>{p.po_number}</button>
                  {p.po_source !== "manual" && <span className="ml-1.5 rounded border px-1 text-[9px] font-bold text-muted-foreground">{p.po_source === "upload" ? "IMPORTED" : "SYS"}</span>}
                </span>
              ),
            },
            { label: "Company", render: (p) => <div><div className="font-semibold">{p.company_name || "—"}</div>{p.poc_name && <div className="text-[10px] text-muted-foreground">{p.poc_name}</div>}</div> },
            {
              label: "Status",
              render: (p) => {
                if (p.status === "confirmed" && p.expected_dispatch_date && p.expected_dispatch_date < today) return <StatusPill status="extract_failed" label="Overdue" />;
                if (p.status === "confirmed" && (p.outward_count || 0) > 0) return <StatusPill status="pending" label="Partial" />;
                return <StatusPill status={p.status} label={PO_STATUS_LABEL[p.status]} />;
              },
            },
            { label: "Dispatch", render: (p) => <Due p={p} now={now} />, className: "hidden sm:table-cell" },
            {
              label: "Items / Shipped",
              className: "hidden md:table-cell",
              render: (p) => (
                <div>
                  <div className="text-xs font-semibold">{p.item_count} item{p.item_count !== 1 ? "s" : ""}</div>
                  {p.outward_count > 0 && <div className="text-[10px] text-success">↑ {p.outward_count} reel{p.outward_count !== 1 ? "s" : ""} out</div>}
                </div>
              ),
            },
            {
              label: "",
              render: (p) => (
                <div className="flex items-center justify-end gap-1.5">
                  {p.status === "draft" && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => act(`/api/po/${p.id}/confirm`, undefined, "PO confirmed")}>Confirm</Button>}
                  {p.status === "confirmed" && <Button size="sm" variant="outline" className="h-7 text-[11px] text-success" onClick={() => quickDispatch(p.id)}>Dispatch</Button>}
                  {docs.canReview && <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(p.id)}><Trash2 className="size-4 text-destructive" /></Button>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
