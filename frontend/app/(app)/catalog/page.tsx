"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate, formatQty } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table/DataTable";
import { SearchPicker } from "@/components/SearchPicker";
import { useAuth } from "@/lib/auth";
import { ITEM_CATEGORIES, parseIds, type Company } from "@/lib/catalog";

function CompanyPicker({ companies, value, onChange }: { companies: Company[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <SearchPicker
      multiple
      className="w-full"
      options={companies.map((c) => ({ value: c.id, label: c.name }))}
      value={value}
      onChange={onChange}
      placeholder="LS Tech only"
      searchPlaceholder="Search companies"
    />
  );
}

const CATEGORY_OPTIONS = ITEM_CATEGORIES.map((c) => ({ value: c, label: c }));

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SearchPicker
      className="w-full"
      options={CATEGORY_OPTIONS}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      placeholder="No category"
      searchPlaceholder="Search categories"
    />
  );
}

interface Item {
  item_code: string;
  description: string;
  default_spq: number;
  created_at: string;
  category: string | null;
  company_ids?: string | null; // admin/manager only
}

export default function CatalogPage() {
  const { selectedStore } = useSelectedStore();
  const [items, setItems] = useState<Item[]>([]);
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [defaultSpq, setDefaultSpq] = useState("");
  const [category, setCategory] = useState("");
  const [visibleTo, setVisibleTo] = useState<number[]>([]);
  // Category and "Visible to" are admin/manager only (the server ignores them from anyone else).
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [companies, setCompanies] = useState<Company[]>([]);

  const [editing, setEditing] = useState<Item | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSpq, setEditSpq] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editVisibleTo, setEditVisibleTo] = useState<number[]>([]);

  useEffect(() => {
    if (!canManage) return;
    api<Company[]>("/api/po/companies").then(setCompanies).catch(() => {});
  }, [canManage]);
  const companyName = (id: number) => companies.find((c) => c.id === id)?.name ?? `#${id}`;

  async function loadItems() {
    try {
      const sp = storeQueryParam(selectedStore);
      const list = await api<Item[]>(`/api/items${sp ? "?" + sp : ""}`);
      list.sort((a, b) => a.item_code.localeCompare(b.item_code));
      setItems(list);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch reacting to the store selector (and on mount) — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  async function addItem() {
    const code = itemCode.trim();
    const desc = description.trim();
    if (!code || !desc || !defaultSpq) return showToast("All fields are required", "error");
    try {
      await api("/api/items", { method: "POST", body: {
          item_code: code,
          description: desc,
          default_spq: parseInt(defaultSpq),
          ...(canManage && { category: category || null, company_ids: visibleTo }),
        },
      });
      showToast(`${code} added to catalog`);
      setItemCode("");
      setDescription("");
      setDefaultSpq("");
      setCategory("");
      setVisibleTo([]);
      loadItems();
    } catch {
      // api() already toasted
    }
  }

  function onFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  }

  function openEdit(item: Item) {
    setEditing(item);
    setEditCode(item.item_code);
    setEditDesc(item.description);
    setEditSpq(String(item.default_spq));
    setEditCategory(item.category ?? "");
    setEditVisibleTo(parseIds(item.company_ids));
  }

  async function saveEdit() {
    if (!editing) return;
    const code = editCode.trim();
    const desc = editDesc.trim();
    const spq = parseInt(editSpq);
    if (!code || !desc || !spq) return showToast("All fields are required", "error");
    try {
      await api(`/api/items/${encodeURIComponent(editing.item_code)}`, {
        method: "PUT",
        body: {
          item_code: code,
          description: desc,
          default_spq: spq,
          ...(canManage && { category: editCategory || null, company_ids: editVisibleTo }),
        },
      });
      setEditing(null);
      showToast(`${code} updated`);
      loadItems();
    } catch {
      // api() already toasted
    }
  }

  async function deleteItem(itemCode: string) {
    if (!window.confirm(`Delete ${itemCode}? This cannot be undone.`)) return;
    try {
      // encodeURIComponent converts the slash into %2F so Express treats it as text!
      await api(`/api/items/${encodeURIComponent(itemCode)}`, { method: "DELETE" });
      showToast(`${itemCode} deleted`);
      loadItems();
    } catch {
      // api() already toasted
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Master Catalog</h1>
        <p className="text-sm text-muted-foreground">Add and manage your component library</p>
      </div>

      <Card className="p-5" onKeyDown={onFormKeyDown}>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add New Item</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr_1fr]">
          <div className="space-y-1.5">
            <Label>Item Code</Label>
            <Input placeholder="e.g. MLCC-100NF-0402" value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              placeholder="e.g. MLCC 100nF 0402 X7R 50V"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default SPQ</Label>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 4000"
              value={defaultSpq}
              onChange={(e) => setDefaultSpq(e.target.value)}
            />
          </div>
        </div>
        {canManage && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <CategorySelect value={category} onChange={setCategory} />
            </div>
            <div className="space-y-1.5">
              <Label>Visible to</Label>
              <CompanyPicker companies={companies} value={visibleTo} onChange={setVisibleTo} />
            </div>
          </div>
        )}
        <Button className="mt-4 self-start" onClick={addItem}>
          + Add Item
        </Button>
      </Card>

      <Card className="p-5">
        <DataTable
          title="All Items"
          data={items}
          getRowKey={(i) => i.item_code}
          columns={[
            { label: "Item Code", render: (i) => <strong className="font-mono">{i.item_code}</strong> },
            { label: "Description", render: (i) => i.description },
            { label: "Category", render: (i) => i.category || <span className="text-muted-foreground">—</span> },
            { label: "SPQ", render: (i) => formatQty(i.default_spq) },
            ...(canManage
              ? [
                  {
                    label: "Visible to",
                    render: (i: Item) => {
                      const ids = parseIds(i.company_ids);
                      if (!ids.length) return <span className="text-muted-foreground">LS Tech only</span>;
                      return <span title={ids.map(companyName).join(", ")}>{ids.length === 1 ? companyName(ids[0]) : `${ids.length} companies`}</span>;
                    },
                  },
                ]
              : []),
            { label: "Added", render: (i) => formatDate(i.created_at) },
            {
              label: "",
              render: (i) => (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(i)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteItem(i.item_code)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Item Code</Label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Default SPQ</Label>
              <Input type="number" min={1} value={editSpq} onChange={(e) => setEditSpq(e.target.value)} />
            </div>
            {canManage && (
              <>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <CategorySelect value={editCategory} onChange={setEditCategory} />
                </div>
                <div className="space-y-1.5">
                  <Label>Visible to</Label>
                  <CompanyPicker companies={companies} value={editVisibleTo} onChange={setEditVisibleTo} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
