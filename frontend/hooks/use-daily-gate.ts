"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { GELCO_ROLES } from "@/lib/role-allowlist";

export interface DailyGateStatus {
  date: string | null;
  approved: boolean;
  summary: { item_code: string; reel_count: number; total_qty: number }[];
}

// Port of injectDailyGateOverlay()'s data/polling logic. gelco_worker polls
// every 15s until a gelco_manager approves; gelco_manager gets an approve action.
export function useDailyGate() {
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<DailyGateStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isGelco = !!user && GELCO_ROLES.includes(user.role);

  async function refetch() {
    try {
      const res = await fetch("/api/daily-gate/status?store=secondary");
      const data: DailyGateStatus = await res.json();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (authLoading || !isGelco) return;
    // Data fetch on mount/role-resolution — a legitimate effect use (fetching
    // from an external system), not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [authLoading, isGelco]);

  useEffect(() => {
    if (!isGelco || user?.role !== "gelco_worker" || !status || status.approved) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const data = await refetch();
      if (data?.approved && pollRef.current) {
        clearInterval(pollRef.current);
      }
    }, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGelco, user?.role, status?.approved]);

  return { isGelco, role: user?.role, status, refetch };
}
