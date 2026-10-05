"use client";

import { SlidersHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

// Search box + a collapsible filter panel (product, designation, status pills, severity pills).
export function ClientFilters({
  value, onChange, products, designations, open, onToggle,
}: {
  value: ClientFilterState;
  onChange: (v: ClientFilterState) => void;
  products: Product[];
  designations: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const set = (patch: Partial<ClientFilterState>) => onChange({ ...value, ...patch });
  // Same as the CRM: the badge counts product + designation only; Clear resets just those two.
  const active = (value.product !== "all" ? 1 : 0) + (value.designation !== "all" ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, company, or email…" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <Button variant={open || active ? "secondary" : "outline"} onClick={onToggle}>
          <SlidersHorizontal /> Filters
          {active > 0 && <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{active}</span>}
        </Button>
      </div>

      {open && (
        <Card className="gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Product</p>
              <Select value={value.product} onValueChange={(v) => set({ product: v })}>
                <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Designation</p>
              <Select value={value.designation} onValueChange={(v) => set({ designation: v })}>
                <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All designations</SelectItem>
                  {designations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={() => set({ product: "all", designation: "all" })}>Clear</Button>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Status</p>
            <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={value.status} onValueChange={(v) => v && set({ status: v })} className="flex-wrap">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              {PIPELINE_STAGES.map((s) => <ToggleGroupItem key={s} value={s}>{capitalize(s)}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Severity</p>
            <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={value.severity} onValueChange={(v) => v && set({ severity: v })}>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              {SEVERITIES.map((s) => <ToggleGroupItem key={s.value} value={String(s.value)}>{s.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </Card>
      )}
    </div>
  );
}
