"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu, LayoutDashboard, Search, LineChart, AlertTriangle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/reports", label: "Stock Summary", icon: LayoutDashboard },
  { href: "/reports/search", label: "Search & Trace", icon: Search },
  { href: "/reports/analytics", label: "Analytics", icon: LineChart },
  { href: "/reports/alerts", label: "Dead & Low Stock", icon: AlertTriangle },
  { href: "/reports/daily", label: "Daily Report", icon: CalendarClock },
] as const;

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {SECTIONS.map((s) => {
        const active = pathname === s.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <s.icon className="size-4" />
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Hand-rolled instead of shadcn's Sidebar component: that component's desktop
// variant renders as `fixed inset-y-0` (viewport-anchored), which sits under
// this app's sticky top nav (Nav.tsx, h-14, z-40) rather than below it, and
// its sidebar-* theme tokens don't match anything else in the app (every
// other panel here is a plain Card). Building the nav list from Card/Sheet/
// Button — components already used everywhere else — sidesteps both: a
// normal sticky (not fixed) column on desktop, a real Sheet-based hamburger
// drawer on mobile (Sheet already portals above the nav at z-50, no offset
// math needed there).
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = SECTIONS.find((s) => s.href === pathname);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="flex items-center gap-2 md:hidden">
        <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
          <Menu />
          <span className="sr-only">Open report sections</span>
        </Button>
        <span className="text-sm font-medium">{current?.label ?? "Reports"}</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64">
          <SheetHeader>
            <SheetTitle>Report Sections</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <Card size="sm" className="hidden w-56 shrink-0 self-start md:sticky md:top-20 md:block">
        <NavList pathname={pathname} />
      </Card>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
