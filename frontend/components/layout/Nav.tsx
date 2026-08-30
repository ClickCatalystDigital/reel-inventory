"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { isNavLinkVisible } from "@/lib/role-allowlist";
import { PRIMARY_NAV_LINKS } from "@/lib/nav-links";
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
    <nav className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 bg-[var(--nav-bg)] px-4 text-white">
      <Link href="/" className="shrink-0 font-bold tracking-wide">
        LS INV MGT
      </Link>

      <div className="hidden h-5 w-px shrink-0 bg-white/15 md:block" />

      <div className="hidden flex-1 items-center gap-1 md:flex">
        {PRIMARY_NAV_LINKS.filter((l) => isNavLinkVisible(user?.role, l.href)).map((l) => (
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
    </nav>
  );
}
