import { Nav } from "@/components/layout/Nav";
import { BottomNav } from "@/components/layout/BottomNav";
import { DailyGateOverlay } from "@/components/layout/DailyGateOverlay";
import { PageShell } from "@/components/layout/PageShell";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DEMO } from "@/lib/brand";

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
      {/* LS AI chat bubble: renders only for the admin role (the API enforces it too) */}
      {/* The demo has no AI key (the API refuses /api/assistant there), so no bubble either. */}
      {DEMO ? <DemoBanner /> : <AssistantWidget />}
    </>
  );
}
