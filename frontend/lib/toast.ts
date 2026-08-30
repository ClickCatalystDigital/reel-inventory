import { toast } from "sonner";

// Preserves the old app.js call signature (showToast(message, type)) so ported
// page logic doesn't need touching just because the underlying toast lib changed.
export function showToast(message: string, type: "success" | "error" = "success") {
  if (type === "error") toast.error(message);
  else toast.success(message);
}
