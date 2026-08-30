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
        .catch(() => {
          if (!cancelled) {
            onErrorRef.current("Camera access denied or unavailable");
            setActive(false);
          }
        });
    });

    return () => {
      cancelled = true;
      scannerInstance
        ?.stop()
        .then(() => scannerInstance?.clear())
        .catch(() => {});
    };
  }, [active, elementId]);

  return { active, setActive };
}
