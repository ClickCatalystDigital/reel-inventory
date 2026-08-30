import { Badge } from "@/components/ui/badge";
import { statusVariant } from "@/lib/format";

const VARIANT_CLASS = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};

// Port of statusBadge() — maps a status string to a tinted Badge.
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={VARIANT_CLASS[statusVariant(status)]}>
      {status}
    </Badge>
  );
}
