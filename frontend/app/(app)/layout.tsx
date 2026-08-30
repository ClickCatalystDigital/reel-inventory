import { Nav } from "@/components/layout/Nav";
import { BottomNav } from "@/components/layout/BottomNav";
import { DailyGateOverlay } from "@/components/layout/DailyGateOverlay";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-[88px] md:pb-6">{children}</main>
      <BottomNav />
      <DailyGateOverlay />
    </>
  );
}
