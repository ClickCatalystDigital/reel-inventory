import { Nav } from "@/components/layout/Nav";
import { BottomNav } from "@/components/layout/BottomNav";
import { DailyGateOverlay } from "@/components/layout/DailyGateOverlay";
import { PageShell } from "@/components/layout/PageShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Full-height column so short pages still push the footer to the bottom of the window. */}
      <div className="flex min-h-dvh flex-col">
        <Nav />
        <PageShell>{children}</PageShell>
      </div>
      <BottomNav />
      <DailyGateOverlay />
    </>
  );
}
