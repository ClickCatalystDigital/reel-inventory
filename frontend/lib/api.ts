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

// Saves a PDF response as a file. Throws (no file saved) on an error status or an empty/non-PDF body,
// so a failed generation never turns into a silent 0 KB download.
export async function downloadFile(res: Response, filename: string): Promise<void> {
  const blob = await res.blob();
  if (!res.ok || blob.size === 0 || !blob.type.includes("pdf")) {
    let msg = `Download failed (${res.status})`;
    try { msg = JSON.parse(await blob.text()).error || msg; } catch {}
    throw new Error(msg);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can cancel the save before the browser reads the blob → 0 KB file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
