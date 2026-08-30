"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode as Html5QrcodeType } from "html5-qrcode";

// Wraps html5-qrcode's imperative start/stop lifecycle for React. StrictMode
// double-invokes effects in dev, which can double-start the camera unless
// cleanup is exact — this always calls stop()+clear() on unmount/toggle-off,
// swallowing errors from stop() rejecting when start() never resolved (e.g.
// a StrictMode remount racing the async start()).
export function useQrScanner(elementId: string, onScan: (text: string) => void, onError: (msg: string) => void) {
  const [active, setActive] = useState(false);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let scannerInstance: Html5QrcodeType | null = null;
    // html5-qrcode's stop() throws SYNCHRONOUSLY (not a rejected promise) when
    // called on an instance whose start() never actually succeeded — e.g. camera
    // access denied/unavailable. Only stop() a scanner that genuinely started,
    // or cleanup crashes the whole page instead of just failing to scan.
    let started = false;

    // html5-qrcode touches `document` at import time, so it must be a
    // dynamic import inside the effect rather than a top-level one (App
    // Router pages are prerendered on the server, where document doesn't exist).
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode(elementId);
      scannerInstance = scanner;
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => onScanRef.current(decodedText),
          () => {}
        )
        .then(() => {
          started = true;
          // Cleanup may have already run (fast toggle-off, or unmount) while start()
          // was still in flight — at that point `started` was still false, so cleanup
          // skipped stop() and left the camera stream running. Catch that here: if
          // we're cancelled by the time start() actually resolves, stop it ourselves.
          if (cancelled) {
            scanner.stop().then(() => scanner.clear()).catch(() => {});
          }
        })
        .catch(() => {
          if (!cancelled) {
            onErrorRef.current("Camera access denied or unavailable");
            setActive(false);
          }
        });
    });

    return () => {
      cancelled = true;
      if (!started || !scannerInstance) return;
      scannerInstance
        .stop()
        .then(() => scannerInstance?.clear())
        .catch(() => {});
    };
  }, [active, elementId]);

  return { active, setActive };
}
