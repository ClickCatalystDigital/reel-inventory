"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { getVisibleNavLinks, isCrmPath } from "@/lib/nav-links";
import { StoreSelector } from "./StoreSelector";
import { ApprovalsBell, NotificationsBell } from "./NavBells";
import { CogMenu } from "./CogMenu";

// Declarative replacement for the nav markup that used to be copy-pasted into
// every view plus the imperative DOM injection in app.js (store selector,
// bells, cog extras). Desktop-only nav-links bar; CogMenu renders on both
// desktop and mobile (see its own comment for why).
export function Nav() {
  const pathname = usePathname();
  const { user } = useAuth();
  // The store view-filter is meaningless on the CRM pages (Home, Clients).
  const showStore = !isCrmPath(pathname);

  return (
    <nav className="sticky top-0 z-40 bg-[var(--nav-bg)] text-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <Link href="/" className="shrink-0 font-bold tracking-wide">
          LS TECH
        </Link>

        <div className="hidden h-5 w-px shrink-0 bg-white/15 md:block" />

        <div className="hidden flex-1 items-center gap-1 md:flex">
          {getVisibleNavLinks(user?.role).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white",
                pathname === l.href && "bg-white/10 text-white"
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* One right-hand cluster at every width (bells used to be mounted twice and, on mobile, sat in
            their own row): store filter on desktop only, bells + cog always. */}
        <div className="flex items-center gap-1 md:gap-2">
          {showStore && (
            <div className="hidden md:block">
              <StoreSelector />
            </div>
          )}
          <ApprovalsBell />
          <NotificationsBell />
          <CogMenu />
        </div>
      </div>

      {/* Mobile-only strip, and only where the store view-filter applies: the filter has no room in the
          top bar, so it gets its own full-width row. CRM pages (Home, Clients) have no strip at all. */}
      {showStore && (
        <div className="border-t border-white/10 px-4 py-2 md:hidden">
          <StoreSelector className="w-full py-2 text-sm" />
        </div>
      )}
    </nav>
  );
}
