import { Nav } from "@/components/layout/Nav";
import { BottomNav } from "@/components/layout/BottomNav";
import { DailyGateOverlay } from "@/components/layout/DailyGateOverlay";
import { PageShell } from "@/components/layout/PageShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <PageShell>{children}</PageShell>
      <BottomNav />
      <DailyGateOverlay />
    </>
  );
}
