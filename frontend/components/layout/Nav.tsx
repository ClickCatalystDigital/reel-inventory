"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { getVisibleNavLinks } from "@/lib/nav-links";
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

  return (
    <nav className="sticky top-0 z-40 bg-[var(--nav-bg)] text-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <Link href="/" className="shrink-0 font-bold tracking-wide">
          LS INV MGT
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

        <div className="hidden items-center gap-2 md:flex">
          <StoreSelector />
          <ApprovalsBell />
          <NotificationsBell />
        </div>

        <CogMenu />
      </div>

      {/* Mobile-only: the store selector and bells above are md:flex-only and
          otherwise have nowhere to live on small screens — CogMenu's dropdown
          only ever carried Settings/Pending Requests/theme/logout, so store
          context and approval/notification counts were completely unreachable
          on mobile. Reuses the exact same components as the desktop row above,
          just relocated to their own strip — no desktop markup touched.
          Store selector takes the flexible width (bigger tap target, and it's
          the control people actually reach for) with a touch-sized bell group
          pinned to the right, instead of cramming all three into a tight
          right-aligned cluster with dead space on the left. */}
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2 md:hidden">
        <StoreSelector className="w-full flex-1 py-2 text-sm" />
        <div className="flex shrink-0 items-center gap-1">
          <ApprovalsBell />
          <NotificationsBell />
        </div>
      </div>
    </nav>
  );
}
