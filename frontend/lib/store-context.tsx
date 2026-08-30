"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import { GELCO_ROLES } from "./role-allowlist";

const STORAGE_KEY = "selectedStore"; // must match the legacy app.js key exactly —
// old and new pages coordinate store-filter state purely through this string.

interface StoreContextValue {
  selectedStore: string; // 'all' | store code
  setSelectedStore: (code: string) => void;
  isLocked: boolean; // Gelco roles are locked to 'secondary'
}

const StoreContext = createContext<StoreContextValue>({
  selectedStore: "all",
  setSelectedStore: () => {},
  isLocked: false,
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedStore, setSelectedStoreState] = useState("all");
  const isLocked = !!user && GELCO_ROLES.includes(user.role);

  useEffect(() => {
    // localStorage isn't available during SSR — starting from the 'all'
    // default and syncing here after mount avoids a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedStoreState(localStorage.getItem(STORAGE_KEY) || "all");
  }, []);

  useEffect(() => {
    if (isLocked && selectedStore !== "secondary") {
      setSelectedStore("secondary");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  function setSelectedStore(code: string) {
    localStorage.setItem(STORAGE_KEY, code);
    setSelectedStoreState(code);
    // Old static pages listen for this event to react to store changes; keep
    // dispatching it so a page not yet migrated stays in sync too.
    window.dispatchEvent(new CustomEvent("storechange", { detail: { store: code } }));
  }

  return (
    <StoreContext.Provider value={{ selectedStore, setSelectedStore, isLocked }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useSelectedStore() {
  return useContext(StoreContext);
}

export function storeQueryParam(selectedStore: string): string {
  return selectedStore === "all" ? "" : `store=${encodeURIComponent(selectedStore)}`;
}
