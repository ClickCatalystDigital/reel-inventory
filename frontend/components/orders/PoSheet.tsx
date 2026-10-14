"use client";

import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { showToast } from "@/lib/toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { PO_DOC_TYPES, docTypeLabel, type PoDetail } from "@/lib/po-stages";
import { StageSelect } from "./StageSelect";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

// PO overlay (Orders page): stage, lines with stock on hand, dispatch lots, documents.
export function PoSheet({ poId, canEdit, onClose, onChanged }: { poId: number | null; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [po, setPo] = useState<PoDetail | null>(null);
  const [docType, setDocType] = useState("po");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(id: number) {
    try {
      setPo(await api<PoDetail>(`/api/orders/${id}`));
    } catch {
      onClose();
    }
  }

  useEffect(() => {
    if (poId == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPo(null);
    setFile(null);
    load(poId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  const changed = () => {
    if (poId != null) load(poId);
    onChanged();
  };

  async function uploadDoc() {
    if (!po || !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("doc_type", docType);
      fd.append("file", file);
      const res = await fetch(`/api/orders/${po.id}/docs`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      showToast(`${file.name} uploaded`, "success");
      setFile(null);
      changed();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDoc(id: number) {
    if (!confirm("Delete this document?")) return;
    try {
      await api(`/api/orders/docs/${id}`, { method: "DELETE" });
      changed();
    } catch {
      // api() already toasted
    }
  }

  const shipped = (code: string) => po?.dispatches.filter((d) => d.item_code === code).reduce((s, d) => s + d.quantity, 0) ?? 0;

  return (
    <Sheet open={poId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isDesktop ? "right" : "bottom"} className={cn("gap-0 p-0", isDesktop ? "sm:max-w-lg" : "max-h-[90vh] rounded-t-2xl")}>
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>{po ? `PO ${po.po_number}` : "PO"}</SheetTitle>
          <SheetDescription>
            {po ? [po.company_name, po.order_date && `Ordered ${formatDate(po.order_date)}`, po.expected_dispatch_date && `Due ${formatDate(po.expected_dispatch_date)}`].filter(Boolean).join(" · ") : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {!po ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <Section title="Stage">
                <div className="flex flex-wrap items-center gap-2">
                  <StageSelect poId={po.id} stage={po.stage} canEdit={canEdit} onChanged={changed} />
                  {po.status && <Badge variant="outline">CRM: {po.status}</Badge>}
                </div>
                {po.stage_updated_at && (
                  <p className="text-xs text-muted-foreground">Updated {formatDateTime(po.stage_updated_at)}{po.stage_updated_by && ` by ${po.stage_updated_by}`}</p>
                )}
              </Section>

              <Section title="Items">
                {po.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No line items</p>
                ) : (
                  <div className="divide-y rounded-md border text-sm">
                    {po.lines.map((l) => (
                      <div key={l.id} className="flex items-start justify-between gap-3 p-2.5">
                        <div className="min-w-0">
                          <div className="font-semibold">{l.item_code}</div>
                          {l.description && <div className="truncate text-xs text-muted-foreground">{l.description}</div>}
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          <div>Ordered <strong>{formatQty(l.quantity_ordered)}</strong></div>
                          <div className="text-muted-foreground">Dispatched {formatQty(shipped(l.item_code))}</div>
                          {/* ponytail: "Ready – Reserved" waits on a stock reservation design; this is LS Tech Stores' free stock only */}
                          <div className="text-muted-foreground">Available {formatQty(l.in_stock ?? 0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Dispatch lots">
                {po.dispatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None yet — add them on the Dispatch tab</p>
                ) : (
                  <div className="divide-y rounded-md border text-sm">
                    {po.dispatches.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-3 p-2.5">
                        <div>
                          <strong>{d.item_code}</strong> × {formatQty(d.quantity)}
                          {d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}
                        </div>
                        <div className="text-xs text-muted-foreground">{d.dispatch_date ? formatDate(d.dispatch_date) : "No date"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Documents (visible to the customer)">
                {po.docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents</p>
                ) : (
                  <div className="divide-y rounded-md border text-sm">
                    {po.docs.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 p-2.5">
                        <div className="min-w-0">
                          <Badge variant="secondary" className="mr-2">{docTypeLabel(d.doc_type)}</Badge>
                          <span className="break-all">{d.original_filename}</span>
                          <div className="text-xs text-muted-foreground">{formatDateTime(d.uploaded_at)}{d.uploaded_by && ` · ${d.uploaded_by}`}</div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="icon" asChild title="Download">
                            <a href={`/api/orders/docs/${d.id}/file`}><Download className="size-4" /></a>
                          </Button>
                          {canEdit && (
                            <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteDoc(d.id)}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={docType} onValueChange={setDocType}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{PO_DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <input key={po.docs.length} type="file" accept="application/pdf" className="min-w-0 flex-1 text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    <Button size="sm" onClick={uploadDoc} disabled={!file || busy}>{busy ? "Uploading…" : "Upload"}</Button>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
