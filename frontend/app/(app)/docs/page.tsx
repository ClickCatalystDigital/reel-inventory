"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isApproverRole } from "@/lib/crm";
import { showToast } from "@/lib/toast";
import { DocsContext, type DocsActions, type DocsTab } from "@/components/docs/context";
import { AllTab } from "@/components/docs/AllTab";
import { InvoicesTab } from "@/components/docs/InvoicesTab";
import { BankTab } from "@/components/docs/BankTab";
import { PoTab } from "@/components/docs/PoTab";
import { SalesTab } from "@/components/docs/SalesTab";
import { ReviewSheet } from "@/components/docs/ReviewSheet";
import { PoSheet } from "@/components/docs/PoSheet";

const TABS: DocsTab[] = ["all", "invoices", "bank", "po", "sales"];

// Docs (ported from ls_crm): every uploaded document is read by AI, reviewed here, then approved for the
// office-PC agent to push into Tally. Customer POs live in the same list. The tab is kept in the URL hash.
export default function DocsPage() {
  const { user } = useAuth();
  const [tab, setTabState] = useState<DocsTab>("all");
  const [version, setVersion] = useState(0);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [poId, setPoId] = useState<number | "new" | null>(null);
  const [proc, setProc] = useState<{ file: string; isPO: boolean } | null>(null);
  const dismissed = useRef(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const h = location.hash.slice(1) as DocsTab;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (TABS.includes(h)) setTabState(h);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  const setTab = useCallback((t: DocsTab) => {
    setTabState(t);
    history.replaceState(null, "", "#" + t);
  }, []);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  // Upload → the server stores it and reads it with AI in the background; poll until the row leaves 'reading'.
  const upload = useCallback(
    (file: File, hint: string | null) => {
      if (file.type !== "application/pdf") return showToast("Only PDF files are supported", "error");
      const isPO = hint === "purchase_order";
      const fd = new FormData();
      fd.append("pdf", file);
      if (hint) fd.append("hint_doc_type", hint);
      const stop = () => {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
        setProc(null);
      };
      (async () => {
        try {
          const res = await fetch("/api/invoices/upload", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Upload failed");
          changed();
          dismissed.current = false;
          setProc({ file: file.name, isPO });
          if (poll.current) clearInterval(poll.current);
          let elapsed = 0;
          const id = data.invoiceId as number;
          poll.current = setInterval(async () => {
            elapsed += 2;
            let s: { status: string; extract_error?: string };
            try {
              const r = await fetch(`/api/invoices/${id}/status`);
              // A PO upload deletes its placeholder row once imported → 404 means done.
              if (r.status === 404 && isPO) {
                stop();
                changed();
                setTab("po");
                return showToast("Purchase order imported — review matched items", "success");
              }
              s = await r.json();
            } catch {
              return;
            }
            if (s.status === "reading") {
              if (elapsed >= 180) {
                stop();
                changed();
                showToast("Still processing — check back shortly", "error");
              }
              return;
            }
            stop();
            changed();
            if (s.status === "extract_failed") showToast(`Couldn't read it${s.extract_error ? " — " + s.extract_error : ""}`, "error");
            else if (!dismissed.current) {
              showToast("Document read — review it before approving", "success");
              setReviewId(id);
            } else showToast("Document ready to review", "success");
          }, 2000);
        } catch (e) {
          showToast(e instanceof Error ? e.message : "Upload failed", "error");
        }
      })();
    },
    [changed, setTab]
  );

  const manual = useCallback(
    async (docType: string | null) => {
      try {
        const r = await api<{ invoiceId: number }>("/api/invoices/manual", { method: "POST", body: { doc_type: docType } });
        showToast("Blank document created — fill it in", "success");
        changed();
        setReviewId(r.invoiceId);
      } catch {
        // api() already toasted
      }
    },
    [changed]
  );

  const actions: DocsActions = useMemo(
    () => ({
      canReview: isApproverRole(user?.role),
      version,
      changed,
      setTab,
      openReview: (id) => {
        setPoId(null);
        setReviewId(id);
      },
      openPo: (id) => {
        setReviewId(null);
        setPoId(id);
      },
      upload,
      manual,
    }),
    [user?.role, version, changed, setTab, upload, manual]
  );

  const hideProc = () => {
    dismissed.current = true;
    setProc(null);
  };

  return (
    <DocsContext.Provider value={actions}>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Docs</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as DocsTab)} className="gap-4">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="bank">Bank</TabsTrigger>
            <TabsTrigger value="po">PO</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
          </TabsList>
          <TabsContent value="all"><AllTab /></TabsContent>
          <TabsContent value="invoices"><InvoicesTab /></TabsContent>
          <TabsContent value="bank"><BankTab /></TabsContent>
          <TabsContent value="po"><PoTab /></TabsContent>
          <TabsContent value="sales"><SalesTab /></TabsContent>
        </Tabs>
      </div>

      <ReviewSheet id={reviewId} onClose={() => setReviewId(null)} />
      <PoSheet id={poId} onClose={() => setPoId(null)} />

      <Dialog open={proc != null} onOpenChange={(o) => !o && hideProc()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="items-center text-center">
            <Loader2 className="mb-2 size-8 animate-spin text-muted-foreground" />
            <DialogTitle>{proc?.isPO ? "Importing your purchase order…" : "Reading your document…"}</DialogTitle>
            <DialogDescription>
              <span className="font-semibold break-all">{proc?.file}</span>
              <br />
              Extracting fields with AI. This can take up to a minute.
            </DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={hideProc}>Continue in background</Button>
        </DialogContent>
      </Dialog>
    </DocsContext.Provider>
  );
}
