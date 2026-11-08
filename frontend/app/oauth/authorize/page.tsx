"use client";

// "Connect Claude to LS TECH?" — the consent step of the MCP sign-in (utils/oauth.js, routes/mcp.js). worker.mjs sends a
// signed-out person to /login?next=… first and back here after. Allow posts the form to /api/oauth/approve, which
// redirects to the AI app with a one-time code. Off in the public demo.
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

export default function Authorize() {
  // Read once in the browser (the page is a static file; the server render shows "Checking…" only).
  const [params] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    return Object.fromEntries(FIELDS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k) as string]));
  });
  const [info, setInfo] = useState<{ name: string; user: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/oauth/check?${new URLSearchParams(params)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (r.ok) setInfo(d); else setProblem(d.error || "This connection can't be made."); })
      .catch(() => setProblem("Could not reach the server."));
  }, [params]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        {problem ? (
          <>
            <h1 className="text-lg font-semibold">Couldn’t connect</h1>
            <p className="mt-2 text-sm text-muted-foreground">{problem}</p>
          </>
        ) : !info ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Connect {info.name} to {BRAND.app}?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{info.user}</span>.{" "}
              <a href={`/api/logout`} className="underline underline-offset-2">Not you?</a>
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              <li>• It can ask {BRAND.ai} about stock, reels, shipments, transfers, purchase orders, approvals, tasks and clients.</li>
              <li>• It can prepare everyday changes. Each one is shown to you there first, and made only when you confirm it.</li>
              <li>• It acts as you: it sees and does only what your login may.</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">You can disconnect it any time in Settings → AI.</p>
            <form method="post" action="/api/oauth/approve" className="mt-5 flex justify-end gap-2">
              {Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <button name="decision" value="deny" className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              <button name="decision" value="allow" className="rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90">Allow</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
