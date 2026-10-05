// LS AI's mark: a microchip (body + pins) with a small spark in the die. Uses currentColor so it follows the surface it sits on.
export function ChipMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
      <path d="M12 9.3l.95 1.75 1.75.95-1.75.95-.95 1.75-.95-1.75-1.75-.95 1.75-.95z" fill="currentColor" stroke="none" />
    </svg>
  );
}
