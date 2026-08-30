"use client";

import { useTheme } from "next-themes";
import Link from "next/link";
import { Settings, Moon, Sun, LogOut, ClipboardList } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { APPROVER_ROLES, isNavLinkVisible } from "@/lib/role-allowlist";

// Legacy quirk preserved on purpose: the cog handles the theme toggle on BOTH
// desktop and mobile, since the old standalone desktop .theme-toggle button
// was removed from every view except stock.html.
export function CogMenu() {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // isApprover alone isn't enough — gelco_manager is still an approver (their own
  // Outward executes immediately), but /requests is deliberately no longer in their
  // page allowlist (daily-gate overlay replaced per-request review for that role),
  // so also check the page is actually reachable before linking to it.
  const isApprover = !!user && APPROVER_ROLES.includes(user.role) && isNavLinkVisible(user.role, "/requests");
  const isAdminOrManager = user?.role === "admin" || user?.role === "manager";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
          title="Settings"
        >
          <Settings className="size-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isApprover && (
          <DropdownMenuItem asChild>
            <Link href="/requests">
              <ClipboardList className="size-4" />
              Pending Requests
            </Link>
          </DropdownMenuItem>
        )}
        {isAdminOrManager && (
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings className="size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {isDark ? "Light Mode" : "Dark Mode"}
        </DropdownMenuItem>
        <DropdownMenuItem asChild variant="destructive">
          <a href="/api/logout">
            <LogOut className="size-4" />
            Logout
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
