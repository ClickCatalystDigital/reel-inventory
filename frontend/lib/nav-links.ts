import { LayoutGrid, PackagePlus, PackageMinus, ArrowLeftRight, ClipboardList, FileText, Warehouse } from "lucide-react";
import { isNavLinkVisible, GELCO_DOCS_ROLES, GELCO_STOCKS_ROLES } from "./role-allowlist";

// The 5 primary links shown in both the desktop nav-links bar and the mobile
// bottom-nav on every "full chrome" page.
export const PRIMARY_NAV_LINKS = [
  { href: "/", label: "Catalog", icon: LayoutGrid },
  { href: "/inward", label: "Inward", icon: PackagePlus },
  { href: "/outward", label: "Outward", icon: PackageMinus },
  { href: "/transfer", label: "Transfer", icon: ArrowLeftRight },
  { href: "/reports", label: "Reports", icon: ClipboardList },
] as const;

// Docs (/gelco-docs) isn't in PRIMARY_NAV_LINKS/ROLE_PAGE_ALLOWLIST's usual
// per-role page list — it's gated by the separate GELCO_DOCS_ROLES allowlist
// (admin/manager/gelco_manager only, deliberately excluding plain "user",
// which isNavLinkVisible's blanket "no allowlist entry = visible" rule would
// otherwise show it to). Centralized here so Nav.tsx and BottomNav.tsx don't
// each need their own copy of this extra rule.
const DOCS_LINK = { href: "/gelco-docs", label: "Docs", icon: FileText } as const;

// Stocks (/stocks) is gelco_manager's own Stock Summary view (with its own
// LS/Gelco store dropdown, unlike the rest of Reports which they can't reach
// at all) — same "extra link outside the per-role page list" pattern as Docs.
const STOCKS_LINK = { href: "/stocks", label: "Stocks", icon: Warehouse } as const;

export function getVisibleNavLinks(role: string | undefined) {
  const links: { href: string; label: string; icon: typeof FileText }[] = PRIMARY_NAV_LINKS.filter((l) =>
    isNavLinkVisible(role, l.href)
  );
  if (role && (GELCO_DOCS_ROLES as readonly string[]).includes(role)) links.push(DOCS_LINK);
  if (role && (GELCO_STOCKS_ROLES as readonly string[]).includes(role)) links.push(STOCKS_LINK);
  return links;
}
