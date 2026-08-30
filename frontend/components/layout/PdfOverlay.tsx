"use client";

// Full-viewport blocking overlay shown while a PDF is generated server-side —
// port of the #pdfOverlay pattern used on inward.html/outward.html.
export function PdfOverlay({ active, message }: { active: boolean; message: string }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-black/50">
      <div className="size-11 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      <div className="text-sm font-semibold text-white">{message}</div>
      <div className="text-xs text-white/60">Please wait, do not refresh</div>
    </div>
  );
}
