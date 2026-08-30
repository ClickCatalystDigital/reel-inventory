"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Deliberately outside the (app) route group and doesn't use the shared api()
// wrapper — this is the entry point before any auth exists.
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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
        document.cookie = `token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Strict`;
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
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-[380px] p-5">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-bold tracking-tight">LS TECHNOLOGY</h1>
          <p className="mt-1 text-xs text-muted-foreground">Inventory Management System</p>
        </div>
        <Card className="p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Login</div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                autoFocus
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && passwordRef.current?.focus()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                ref={passwordRef}
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
              />
            </div>
            <Button className="w-full" onClick={login} disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </Button>
            {error && <div className="text-center text-sm text-destructive">{error}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
