"use client";

import { createContext, useContext } from "react";

export type DocsTab = "all" | "invoices" | "bank" | "po" | "sales";

// What every Docs tab can ask the page to do (ls_crm had these as globals in docs.html).
export interface DocsActions {
  canReview: boolean; // admin/manager: approve, reject, delete
  version: number; // bumps after any change → tabs reload
  changed: () => void;
  setTab: (t: DocsTab) => void;
  openReview: (id: number) => void;
  openPo: (id: number | "new") => void;
  upload: (file: File, hint: string | null) => void;
  manual: (docType: string | null) => void;
}

export const DocsContext = createContext<DocsActions | null>(null);
export const useDocs = () => {
  const c = useContext(DocsContext);
  if (!c) throw new Error("useDocs outside DocsContext");
  return c;
};
