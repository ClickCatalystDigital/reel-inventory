"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDateTime } from "@/lib/format";
import { useSelectedStore, storeQueryParam } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GelcoDoc {
  id: number;
  original_filename: string;
  doc_type: "po" | "invoice";
  uploaded_by: string;
  uploaded_at: string;
  file_url: string;
}

export default function GelcoDocsPage() {
  const { selectedStore } = useSelectedStore();
  const [docs, setDocs] = useState<GelcoDoc[] | null>(null);
  const [docType, setDocType] = useState<"po" | "invoice">("po");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadDocs() {
    try {
      const sp = storeQueryParam(selectedStore);
      const list = await api<GelcoDoc[]>(`/api/gelco-docs${sp ? "?" + sp : ""}`);
      setDocs(list);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch reacting to the store selector — a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  async function uploadDoc() {
    const file = fileRef.current?.files?.[0];
    if (!file) return showToast("Choose a PDF file first", "error");

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("doc_type", docType);
      const res = await fetch("/api/gelco-docs/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      showToast(data.message);
      if (fileRef.current) fileRef.current.value = "";
      loadDocs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: number) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      await api(`/api/gelco-docs/${id}`, { method: "DELETE" });
      showToast("Document deleted");
      loadDocs();
    } catch {
      // api() already toasted
    }
  }

  const emptyMessage = selectedStore === "all" ? "No documents uploaded yet" : "No documents for the selected store";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Docs</h1>
        <p className="text-sm text-muted-foreground">Upload and manage PO / Invoice PDFs</p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={docType} onValueChange={(v) => setDocType(v as "po" | "invoice")}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="po">Purchase Order</SelectItem>
              <SelectItem value="invoice">Invoice</SelectItem>
            </SelectContent>
          </Select>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="flex h-9 min-w-48 flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
          />
          <Button onClick={uploadDoc} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</div>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs === null ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : docs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <strong>{d.original_filename}</strong>
                    </TableCell>
                    <TableCell>{d.doc_type === "po" ? "Purchase Order" : "Invoice"}</TableCell>
                    <TableCell>{d.uploaded_by}</TableCell>
                    <TableCell>{formatDateTime(d.uploaded_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={d.file_url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteDoc(d.id)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
