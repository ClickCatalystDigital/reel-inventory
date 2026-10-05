import { toast } from "sonner";
import { api } from "./api";

// Mark a task done, then offer a one-click Undo (reopen) — same flow as the CRM's undo toast.
export async function completeTask(id: number, onChanged: () => void) {
  await api(`/api/tasks/${id}/done`, { method: "POST" });
  onChanged();
  toast.success("Task completed", {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await api(`/api/tasks/${id}/reopen`, { method: "POST" });
          onChanged();
        } catch {
          // api() already toasted
        }
      },
    },
  });
}
