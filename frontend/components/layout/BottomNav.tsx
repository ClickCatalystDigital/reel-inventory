"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { getVisibleNavLinks } from "@/lib/nav-links";

export function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-center justify-around border-t border-border bg-[var(--nav-bg)] md:hidden">
      {getVisibleNavLinks(user?.role).map((l) => {
        const Icon = l.icon;
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "flex flex-col items-center gap-0.5 text-[10px] text-white/50",
              active && "text-white"
            )}
          >
            <Icon className="size-5" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
