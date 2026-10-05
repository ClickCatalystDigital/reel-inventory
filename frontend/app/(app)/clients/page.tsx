"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { showToast } from "@/lib/toast";
import { clientStatusClass, isApproverRole, severityClass, SEVERITIES, type Assignee, type Client, type Metrics, type Product } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type DataTableColumn } from "@/components/data-table/DataTable";
import { AddClientDialog } from "@/components/crm/AddClientDialog";
import { ClientFilters, EMPTY_FILTERS, type ClientFilterState } from "@/components/crm/ClientFilters";
import { ClientSheet } from "@/components/crm/ClientSheet";
import { ClientsOverview } from "@/components/crm/ClientsOverview";

// Opens the detail sheet for /clients?open=<id> (linked from Home's watch list and task sheet).
// Isolated so useSearchParams sits inside its own Suspense boundary (required by the static export).
function OpenFromQuery({ onOpen }: { onOpen: (id: number) => void }) {
  const id = useSearchParams().get("open");
  useEffect(() => {
    if (id && Number.isInteger(Number(id))) onOpen(Number(id));
  }, [id, onOpen]);
  return null;
}

export default function ClientsPage() {
  const { user, isLoading } = useAuth();
  const isApprover = isApproverRole(user?.role);

  const [clients, setClients] = useState<Client[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [filters, setFilters] = useState<ClientFilterState>(EMPTY_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadClients = useCallback(async () => {
    try {
      setClients(await api<Client[]>("/api/clients"));
    } catch {
      setClients([]);
    }
  }, []);
  const loadMetrics = useCallback(() => api<Metrics>("/api/clients/meta/metrics").then(setMetrics).catch(() => {}), []);
  const reloadAll = useCallback(() => { loadClients(); loadMetrics(); }, [loadClients, loadMetrics]);

  useEffect(() => {
    if (isLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadAll();
    api<Product[]>("/api/products").then(setProducts).catch(() => {});
    if (isApproverRole(user.role)) api<Assignee[]>("/api/tasks/assignable").then(setAssignees).catch(() => {});
  }, [isLoading, user, reloadAll]);

  const designations = useMemo(
    () => [...new Set((clients ?? []).map((c) => c.designation?.trim()).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b)),
    [clients]
  );

  // Memoized so ticking a checkbox doesn't hand DataTable a new array (which would reset it to page 1).
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return (clients ?? []).filter((c) => {
      if (q && !`${c.poc_name} ${c.company_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q)) return false;
      if (filters.status !== "all" && c.status !== filters.status) return false;
      if (filters.product !== "all" && String(c.product_id ?? "") !== filters.product) return false;
      if (filters.designation !== "all" && (c.designation ?? "").trim() !== filters.designation) return false;
      if (filters.severity !== "all" && String(c.severity || 1) !== filters.severity) return false;
      return true;
    });
  }, [clients, filters]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  async function removeOne(c: Client) {
    if (!window.confirm(`Permanently delete ${c.poc_name} and all their notes and tasks?`)) return;
    try {
      await api(`/api/clients/${c.id}`, { method: "DELETE" });
      showToast("Client removed");
      setSelected((s) => { const n = new Set(s); n.delete(c.id); return n; });
      reloadAll();
    } catch {
      // api() already toasted
    }
  }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length || !window.confirm(`Permanently delete ${ids.length} client(s) and all their notes and tasks?`)) return;
    try {
      await api("/api/clients/bulk-delete", { method: "POST", body: { ids } });
      showToast(`${ids.length} client(s) removed`);
      setSelected(new Set());
      reloadAll();
    } catch {
      // api() already toasted
    }
  }

  const columns: DataTableColumn<Client>[] = [
    {
      key: "sel",
      label: <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((c) => c.id)))} aria-label="Select all" />,
      render: (c) => <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${c.poc_name}`} />,
    },
    { key: "poc", label: "POC", render: (c) => <button type="button" onClick={() => setOpenId(c.id)} className="font-medium text-primary hover:underline">{c.poc_name}</button> },
    { key: "company", label: "Company", render: (c) => c.company_name || "—" },
    { key: "designation", label: "Designation", render: (c) => c.designation || "—" },
    { key: "product", label: "Product", render: (c) => c.product_name || "—" },
    { key: "status", label: "Status", render: (c) => <Badge variant="outline" className={clientStatusClass(c.status)}>{c.status}</Badge> },
    { key: "sev", label: "Severity", render: (c) => <span className={`text-sm font-medium ${severityClass(c.severity || 1)}`}>{SEVERITIES.find((s) => s.value === (c.severity || 1))?.label}</span> },
    { key: "del", label: "", render: (c) => <Button variant="ghost" size="icon-xs" onClick={() => removeOne(c)} title="Delete"><Trash2 className="text-destructive" /></Button> },
  ];

  return (
    <div className="space-y-4">
      <Suspense fallback={null}>
        <OpenFromQuery onOpen={setOpenId} />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Clients</h1>
          <p className="text-sm text-muted-foreground">Contacts, pipeline and call history</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="outline" onClick={removeSelected} className="border-destructive/40 text-destructive hover:text-destructive">
              <Trash2 /> Delete selected ({selected.size})
            </Button>
          )}
          <Button onClick={() => setAdding(true)}><Plus /> Add</Button>
        </div>
      </div>

      <ClientsOverview metrics={metrics} />

      <ClientFilters
        value={filters}
        onChange={setFilters}
        products={products}
        designations={designations}
        open={panelOpen}
        onToggle={() => setPanelOpen((o) => !o)}
      />

      <Card className="p-4">
        {clients === null ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <DataTable title="All clients" columns={columns} data={filtered} getRowKey={(c) => c.id} pageSize={10} />
        )}
      </Card>

      <AddClientDialog open={adding} onOpenChange={setAdding} products={products} assignees={assignees} isApprover={isApprover} onAdded={reloadAll} />
      <ClientSheet clientId={openId} onClose={() => setOpenId(null)} products={products} onChanged={reloadAll} />
    </div>
  );
}
