import { toast } from "sonner";
import { showToast } from "./toast";

// Direct port of public/js/app.js's api(). Same contract: pass a plain object
// as `body` (it gets JSON-stringified here), non-OK responses throw and toast,
// same-origin fetch carries the existing JWT cookie automatically — no
// Authorization header needed.
export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function api<T = unknown>(url: string, options: ApiOptions = {}): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    showToast(message, "error");
    throw err;
  }
}

// Saves a file response (PDF or CSV). Throws (no file saved) on an error status or an empty/error body,
// so a failed generation never turns into a silent 0 KB download. `filename` falls back to the server's.
export async function downloadFile(res: Response, filename?: string): Promise<void> {
  const blob = await res.blob();
  if (!res.ok || blob.size === 0 || /json|html/.test(blob.type)) {
    let msg = `Download failed (${res.status})`;
    try { msg = JSON.parse(await blob.text()).error || msg; } catch {}
    throw new Error(msg);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || /filename="?([^";]+)/.exec(res.headers.get("content-disposition") || "")?.[1] || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can cancel the save before the browser reads the blob → 0 KB file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// GET a report/export and save it, with a toast either way. For links that used to be window.location.href = url,
// which left the app for a raw JSON error page when the server failed.
export async function downloadUrl(url: string, startedMsg = "Preparing download..."): Promise<void> {
  const t = toast.loading(startedMsg);
  try {
    await downloadFile(await fetch(url));
    toast.success("Downloaded", { id: t });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Download failed", { id: t });
  }
}
