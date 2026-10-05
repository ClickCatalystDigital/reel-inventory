"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isCrmPath } from "@/lib/nav-links";

// Content container: the CRM pages (Home calendar, Clients table) get more width than the
// inventory pages, which keep their original max-w-5xl. Also carries the product footer (the same
// line SB Ops shows); the bottom padding keeps it clear of the mobile tab bar.
export function PageShell({ children }: { children: React.ReactNode }) {
  const wide = isCrmPath(usePathname());
  return (
    <main className={cn("mx-auto flex w-full flex-1 flex-col px-4 pt-6 pb-[88px] md:pb-6", wide ? "max-w-6xl" : "max-w-5xl")}>
      <div className="flex-1">{children}</div>
      <footer className="print:hidden">
        <div className="mt-10 border-t py-4 text-right text-[11px] text-muted-foreground/80">
          LS Tech — an{" "}
          <a
            href="https://ahromlabs.com"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            ahromlabs.com
          </a>{" "}
          product · © {new Date().getFullYear()} Ahrom Labs
        </div>
      </footer>
    </main>
  );
}
