import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Electronics Component Inventory ERP: Live Demo | Ahrom Labs",
  description:
    "Try a reel-level inventory and CRM system for electronics-component traders: QR-labelled reels, two stores, scan-cart dispatch against customer POs, approvals and a customer stock portal.",
  robots: { index: true, follow: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
