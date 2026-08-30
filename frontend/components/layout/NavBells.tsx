"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, MessageSquare } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { APPROVER_ROLES, NOTIFICATION_ROLES } from "@/lib/role-allowlist";
import { todayISTDateString } from "@/lib/format";

function BellButton({ href, count, title, icon: Icon }: { href: string; count: number; title: string; icon: typeof Bell }) {
  return (
    <Link href={href} title={title} className="relative rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white">
      <Icon className="size-[18px]" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}

// Approvals bell — pending-requests count, polled every 30s, approvers only.
export function ApprovalsBell() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const isApprover = !!user && APPROVER_ROLES.includes(user.role);

  useEffect(() => {
    if (!isApprover) return;
    const refresh = () =>
      fetch("/api/requests/count")
        .then((r) => r.json())
        .then((d) => setCount(d.count || 0))
        .catch(() => {});
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [isApprover]);

  if (!isApprover) return null;
  return <BellButton href="/requests" count={count} title="Pending Approvals" icon={Bell} />;
}

// Notifications bell — today's outward event count, polled every 30s, admin/manager only.
export function NotificationsBell() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const visible = !!user && NOTIFICATION_ROLES.includes(user.role);

  useEffect(() => {
    if (!visible) return;
    const refresh = () => {
      const today = todayISTDateString();
      fetch(`/api/outward/recent?limit=1&date_from=${today}&date_to=${today}`)
        .then((r) => r.json())
        .then((d) => setCount(d.total || 0))
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;
  return <BellButton href="/notifications" count={count} title="Notifications" icon={MessageSquare} />;
}
