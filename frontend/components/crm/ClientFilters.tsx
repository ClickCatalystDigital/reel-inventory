"use client";

import { SlidersHorizontal, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { capitalize, PIPELINE_STAGES, SEVERITIES, type Product } from "@/lib/crm";

export interface ClientFilterState {
  q: string;
  product: string; // product id or "all"
  designation: string; // text or "all"
  status: string; // stage or "all"
  severity: string; // "1"|"2"|"3" or "all"
}

export const EMPTY_FILTERS: ClientFilterState = { q: "", product: "all", designation: "all", status: "all", severity: "all" };

// Search + always-visible status row (with counts), and a panel for the secondary filters
// (product, designation, severity). The status row scrolls sideways on narrow screens; the panel
// stacks to one column.
export function ClientFilters({
  value, onChange, products, designations, statusCounts, resultCount, open, onToggle,
}: {
  value: ClientFilterState;
  onChange: (v: ClientFilterState) => void;
  products: Product[];
  designations: string[];
  statusCounts: Record<string, number>;
  resultCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const set = (patch: Partial<ClientFilterState>) => onChange({ ...value, ...patch });
  const active = (value.product !== "all" ? 1 : 0) + (value.designation !== "all" ? 1 : 0) + (value.severity !== "all" ? 1 : 0);
  const anyActive = active > 0 || value.status !== "all" || !!value.q;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, company or email" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <Button variant={open || active ? "secondary" : "outline"} onClick={onToggle} className="shrink-0">
          <SlidersHorizontal />
          <span className="hidden sm:inline">Filters</span>
          {active > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{active}</span>}
        </Button>
      </div>

      {/* Status quick filter: its own row so it's always one tap away; scrolls on mobile */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={value.status} onValueChange={(v) => v && set({ status: v })} className="w-max">
          <ToggleGroupItem value="all">All <span className="ml-1 text-muted-foreground">{total}</span></ToggleGroupItem>
          {PIPELINE_STAGES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {capitalize(s)} <span className="ml-1 text-muted-foreground">{statusCounts[s] || 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {open && (
        <Card className="gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Product</Label>
              <Select value={value.product} onValueChange={(v) => set({ product: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Designation</Label>
              <Select value={value.designation} onValueChange={(v) => set({ designation: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All designations</SelectItem>
                  {designations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Severity</Label>
              <ToggleGroup type="single" variant="outline" spacing={0} value={value.severity} onValueChange={(v) => v && set({ severity: v })} className="w-full">
                <ToggleGroupItem value="all" className="flex-1">All</ToggleGroupItem>
                {SEVERITIES.map((s) => <ToggleGroupItem key={s.value} value={String(s.value)} className="flex-1">{s.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">{resultCount} client{resultCount === 1 ? "" : "s"} match</span>
            <Button variant="ghost" size="sm" disabled={!anyActive} onClick={() => onChange(EMPTY_FILTERS)}>
              <X /> Clear all
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
