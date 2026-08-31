"use client";

import { useEffect, useState } from "react";
import { useSelectedStore } from "@/lib/store-context";
import { cn } from "@/lib/utils";

interface Store {
  code: string;
  name: string;
}

// Declarative port of injectStoreSelector(): a view-filter dropdown, or a
// locked badge for the two Gelco roles (permanently on 'secondary').
// `className` lets call sites (the mobile nav strip) size this differently
// (e.g. flex-1 + a bigger tap target) without affecting the desktop instance,
// which passes nothing and keeps its original compact sizing.
export function StoreSelector({ className }: { className?: string } = {}) {
  const { selectedStore, setSelectedStore, isLocked } = useSelectedStore();
  const [stores, setStores] = useState<Store[]>([]);

  useEffect(() => {
    if (isLocked) return;
    fetch("/api/stores")
      .then((r) => r.json())
      .then(setStores)
      .catch(() => {});
  }, [isLocked]);

  if (isLocked) {
    return (
      <span className={cn("rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground", className)}>
        🔒 Gelco Stores
      </span>
    );
  }

  if (!stores.length) return null;

  return (
    <select
      className={cn("rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-secondary-foreground", className)}
      title="Viewing store"
      value={selectedStore}
      onChange={(e) => setSelectedStore(e.target.value)}
    >
      <option value="all">All Stores</option>
      {stores.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
