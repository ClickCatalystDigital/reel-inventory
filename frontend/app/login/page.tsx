"use client";

import { useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Phones only: a hairline grid in the page's own foreground colour (so it also works in dark mode). It sits behind the name and tagline only
// and fades out completely before the Username field.
const PHONE_GRID = {
  backgroundImage:
    "linear-gradient(color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px)",
  backgroundSize: "40px 40px",
  maskImage: "linear-gradient(to bottom, black 20%, transparent 82%)",
} as const;

// Deliberately outside the (app) route group and doesn't use the shared api()
// wrapper — this is the entry point before any auth exists.
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function login() {
    const user = username.trim();
    if (!user || !password) {
      setError("Enter both username and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password }),
      });
      const data = await res.json();
      if (res.ok) {
        // The server sets the session cookie (HttpOnly) — nothing to store here.
        window.location.href = data.role === "client" ? "/stock" : "/";
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden md:grid md:grid-cols-[1.15fr_1fr]">
      {/* Brand side. Deliberately generic: it says what kind of partner LS Technologies is, never who it serves or how. */}
      <aside className="relative hidden overflow-hidden bg-[#131312] text-white md:flex md:flex-col md:justify-end md:p-12 lg:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(52rem 32rem at 0% 0%, rgba(255,255,255,0.11), transparent 62%), linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 44px 44px, 44px 44px",
            maskImage: "linear-gradient(to bottom, black, rgba(0,0,0,0.15) 72%)",
          }}
        />

        <div className="relative mb-16 max-w-xl">
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight lg:text-6xl">LS Technologies</h1>
          <p className="mt-5 text-xl leading-snug text-white/75 lg:text-2xl">Electronics and industrial solutions.<br />Built around your requirements.</p>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} LS Technologies</p>
      </aside>

      <main className="relative flex flex-1 flex-col md:bg-background px-6 pb-8 pt-20 sm:px-12 md:justify-center md:py-10">
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col md:block md:flex-none">
          {/* Phones: just the name and the line, large, above the form — no band, no card. */}
          <div className="relative mb-12 md:hidden">
            <div aria-hidden className="pointer-events-none absolute -bottom-12 -top-20 left-1/2 w-screen -translate-x-1/2" style={PHONE_GRID} />
            <h1 className="relative text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em]">LS Technologies</h1>
            <p className="relative mt-4 text-[15px] leading-snug text-muted-foreground">
              Electronics and industrial solutions.
              <br />
              Built around your requirements.
            </p>
          </div>

          <h2 className="hidden text-2xl font-semibold tracking-tight md:block">Sign in</h2>
          <p className="mt-1.5 hidden text-sm text-muted-foreground md:block">Use your account to continue to your workspace.</p>

          <form
            className="space-y-4 md:mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              login();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="h-11"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && passwordRef.current && (e.preventDefault(), passwordRef.current.focus())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  ref={passwordRef}
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  className="h-11 pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="h-11 w-full text-[15px]" disabled={loading}>
              {loading ? (
                <>
                  <span className="md:hidden">Logging in…</span>
                  <span className="hidden md:inline">Signing in…</span>
                </>
              ) : (
                <>
                  <span className="md:hidden">Login</span>
                  <span className="hidden md:inline">Sign in</span>
                  <ArrowRight className="hidden md:block" />
                </>
              )}
            </Button>
            <p role="alert" className="min-h-5 text-center text-sm text-destructive">{error}</p>
          </form>

          <p className="mt-auto pt-10 text-center text-[11px] text-muted-foreground/70 md:mt-10 md:pt-0">LS Tech — an ahromlabs.com product</p>
        </div>
      </main>
    </div>
  );
}
