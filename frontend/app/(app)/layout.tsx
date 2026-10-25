import { Nav } from "@/components/layout/Nav";
import { BottomNav } from "@/components/layout/BottomNav";
import { DailyGateOverlay } from "@/components/layout/DailyGateOverlay";
import { PageShell } from "@/components/layout/PageShell";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DEMO } from "@/lib/brand";
import { AskHost } from "@/components/layout/AskDialog";

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
      <AskHost />
      {/* Ohm AI chat bubble: renders only for the admin role (the API enforces it too) */}
      {DEMO && <DemoBanner />}
      {/* In the demo the bubble appears only when the demo has its own AI key, with two questions per visitor. */}
      <AssistantWidget />
    </>
  );
}
