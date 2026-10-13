import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `${BRAND.company} — Sign in` };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
