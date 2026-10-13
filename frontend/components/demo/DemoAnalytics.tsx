"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
// Same GA4 property and consent cookie as ahromlabs.com (ahrom-labs/src/components/Analytics.tsx, docs/
// analytics-strategy.md), so one visitor is followed from the website into the demo. Rendered only in the
// demo build (NEXT_PUBLIC_DEMO=1), never on lstechnologies.in.
const GA_ID = "G-BC080TXMMZ";

// No-op until the visitor accepts (gtag only exists after consent).
export function track(event: string, params?: Record<string, string>) {
  (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", event, params);
}

// Consent lives in a cookie on .ahromlabs.com so the demo (boiler-erp.ahromlabs.com)
// reads the same answer and doesn't ask again. gtag.js isn't fetched at all until
// the visitor accepts, so nothing reaches Google before then.
const COOKIE = "ga_consent";

function readConsent(): string | null {
  return document.cookie.match(/(?:^|; )ga_consent=([^;]*)/)?.[1] ?? null;
}

function saveConsent(value: "granted" | "denied") {
  const domain = location.hostname.endsWith("ahromlabs.com") ? "; domain=ahromlabs.com" : "";
  document.cookie = `${COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax${domain}`;
}

const noSubscribe = () => () => {};

function loadGa() {
  if (document.getElementById("ga-js")) return;
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  // gtag.js expects the arguments object itself, not an array.
  w.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", GA_ID);
  const s = document.createElement("script");
  s.id = "ga-js";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

export function DemoAnalytics() {
  // "pending" on the server, so the bar never flashes into prerendered HTML.
  const consent = useSyncExternalStore(noSubscribe, readConsent, () => "pending");
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (readConsent() === "granted") loadGa();
  }, []);

  if (consent !== null || answered) return null;

  const choose = (value: "granted" | "denied") => {
    saveConsent(value);
    if (value === "granted") loadGa();
    setAnswered(true);
  };

  return (
    <div role="region" aria-label="Analytics consent" className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-lg border bg-background p-3 text-sm text-muted-foreground shadow-md print:hidden">
      <p className="flex-[1_1_16rem]">We use Google Analytics to see which parts of the demo help. No ads, nothing sold.</p>
      <div className="flex gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 font-medium text-foreground" onClick={() => choose("denied")}>
          Decline
        </button>
        <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground" onClick={() => choose("granted")}>
          Accept
        </button>
      </div>
    </div>
  );
}
