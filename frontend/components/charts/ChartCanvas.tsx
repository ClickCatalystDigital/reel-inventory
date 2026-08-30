"use client";

import { useEffect, useRef } from "react";
import { Chart, type ChartConfiguration, registerables } from "chart.js";

Chart.register(...registerables);

// Thin React wrapper around Chart.js — kept as Chart.js (not rewritten to
// Recharts) per the migration plan's guardrail: lower risk, smaller diff.
// Always destroy()s before creating a new instance (in the cleanup AND
// defensively before the new Chart() call), which is exactly the
// "canvas already in use" failure the legacy code's manual
// Chart.getChart(id)?.destroy() calls existed to avoid.
export function ChartCanvas({ config, height = 280 }: { config: ChartConfiguration; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const configKey = JSON.stringify(config);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
