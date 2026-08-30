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
