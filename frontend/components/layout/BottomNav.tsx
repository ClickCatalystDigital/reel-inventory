"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { getVisibleNavLinks } from "@/lib/nav-links";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// Phones fit about 6 tabs; past that the rest go behind "More". The scanning pages warehouse staff use
// all day stay on the bar.
const MAX_TABS = 6;
const PHONE_FIRST = ["/", "/inward", "/outward", "/transfer", "/catalog"];

export function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [more, setMore] = useState(false);
  const all = getVisibleNavLinks(user?.role);
  const links = [...all.filter((l) => PHONE_FIRST.includes(l.href)), ...all.filter((l) => !PHONE_FIRST.includes(l.href))];
  const overflow = links.length > MAX_TABS;
  const tabs = overflow ? links.slice(0, MAX_TABS - 1) : links;
  const rest = overflow ? links.slice(MAX_TABS - 1) : [];
  const tab = "flex flex-col items-center gap-0.5 text-[10px] text-white/50";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-center justify-around border-t border-border bg-[var(--nav-bg)] md:hidden">
      {tabs.map((l) => {
        const Icon = l.icon;
        return (
          <Link key={l.href} href={l.href} className={cn(tab, pathname === l.href && "text-white")}>
            <Icon className="size-5" />
            {l.label}
          </Link>
        );
      })}
      {overflow && (
        <>
          <button className={cn(tab, rest.some((l) => l.href === pathname) && "text-white")} onClick={() => setMore(true)}>
            <MoreHorizontal className="size-5" />
            More
          </button>
          <Sheet open={more} onOpenChange={setMore}>
            <SheetContent side="bottom" className="rounded-t-2xl pb-6">
              <SheetHeader>
                <SheetTitle>More</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2 px-4">
                {rest.map((l) => {
                  const Icon = l.icon;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMore(false)}
                      className={cn("flex flex-col items-center gap-1 rounded-lg border p-3 text-xs", pathname === l.href && "border-foreground font-semibold")}
                    >
                      <Icon className="size-5" />
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </nav>
  );
}
