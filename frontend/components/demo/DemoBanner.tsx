"use client";
// Demo build only: a small pill so visitors know the data is sample data, can switch login and can WhatsApp Pujan. In the
// owner-pass browser it says so instead: that browser's changes are kept (utils/demo.js).
import { useEffect, useState } from "react";
import { DemoWhatsApp } from "./DemoWhatsApp";

export function DemoBanner() {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    fetch("/api/demo/roles").then((r) => r.json()).then((d) => setOwner(!!d.owner)).catch(() => {});
  }, []);
  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur md:bottom-4 print:hidden">
      {owner ? (
        <span className="font-medium text-primary">Owner mode<span className="hidden sm:inline"> · changes saved</span></span>
      ) : (
        <>Demo<span className="hidden sm:inline"> · resets nightly</span></>
      )}{" "}
      ·{" "}
      <a href="/demo" className="font-medium text-foreground underline-offset-2 hover:underline">
        Switch login
      </a>{" "}
      · <DemoWhatsApp />
    </div>
  );
}
