"use client";

import { cn } from "@/lib/utils";

interface FabProps {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  secondary?: boolean;
}

// Mobile-only floating action button, matches legacy .fab/.fab-secondary
// (hidden on desktop via the md: breakpoint, same as the old CSS media query).
export function Fab({ onClick, title, icon, secondary }: FabProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "fixed z-40 flex size-[52px] items-center justify-center rounded-full text-white shadow-lg md:hidden",
        secondary ? "right-[84px] bottom-[76px] bg-secondary text-secondary-foreground" : "right-4 bottom-[76px] bg-primary"
      )}
    >
      {icon}
    </button>
  );
}
