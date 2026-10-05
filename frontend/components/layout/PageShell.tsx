"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isCrmPath } from "@/lib/nav-links";

// Content container: the CRM pages (Home calendar, Clients table) get more width than the
// inventory pages, which keep their original max-w-5xl.
export function PageShell({ children }: { children: React.ReactNode }) {
  const wide = isCrmPath(usePathname());
  return (
    <main className={cn("mx-auto px-4 pt-6 pb-[88px] md:pb-6", wide ? "max-w-6xl" : "max-w-5xl")}>{children}</main>
  );
}
