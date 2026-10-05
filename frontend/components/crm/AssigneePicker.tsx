"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { avatarColor, initialsFor, type Assignee } from "@/lib/crm";

export function UserAvatar({ username, className }: { username: string | null; className?: string }) {
  if (!username) {
    return (
      <Avatar className={cn("size-6", className)}>
        <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">–</AvatarFallback>
      </Avatar>
    );
  }
  return (
    <Avatar className={cn("size-6", className)} title={username}>
      <AvatarFallback className={cn("text-[10px] font-semibold text-white", avatarColor(username))}>
        {initialsFor(username)}
      </AvatarFallback>
    </Avatar>
  );
}

// Avatar that, for approvers, opens a picker to (re)assign or unassign a task.
export function AssigneePicker({
  value,
  assignees,
  onAssign,
  className,
}: {
  value: string | null;
  assignees: Assignee[];
  onAssign: (username: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (u: string | null) => {
    setOpen(false);
    if (u !== value) onAssign(u);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
          title="Assign"
        >
          <UserAvatar username={value} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
        {[{ username: null as string | null, label: "Unassigned" }, ...assignees.map((a) => ({ username: a.username as string | null, label: a.username }))].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => pick(o.username)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          >
            <UserAvatar username={o.username} className="size-5" />
            <span className="flex-1 truncate">{o.label}</span>
            {o.username === value && <Check className="size-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
