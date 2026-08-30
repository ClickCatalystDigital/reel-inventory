import { LayoutGrid, PackagePlus, PackageMinus, ArrowLeftRight, BarChart3 } from "lucide-react";

// The 5 primary links shown in both the desktop nav-links bar and the mobile
// bottom-nav on every "full chrome" page.
export const PRIMARY_NAV_LINKS = [
  { href: "/", label: "Catalog", icon: LayoutGrid },
  { href: "/inward", label: "Inward", icon: PackagePlus },
  { href: "/outward", label: "Outward", icon: PackageMinus },
  { href: "/transfer", label: "Transfer", icon: ArrowLeftRight },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
] as const;
