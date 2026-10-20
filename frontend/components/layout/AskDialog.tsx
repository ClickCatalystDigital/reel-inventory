"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// In-app replacement for window.confirm / window.prompt: `if (!(await askConfirm({...}))) return;`.
// One <AskHost/> (mounted in the app layout) renders whichever question is open.

interface AskOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}
interface AskTextOptions extends AskOptions {
  inputLabel?: string;
  placeholder?: string;
  password?: boolean;
  /** an empty answer is refused (Confirm stays disabled) */
  required?: boolean;
}
type Pending = AskTextOptions & { text: boolean; resolve: (v: string | null) => void };

let setPending: ((p: Pending | null) => void) | null = null;

function open(opts: AskTextOptions, text: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    if (!setPending) return resolve(null); // host not mounted: treat as cancelled, never as a silent yes
    setPending({ ...opts, text, resolve });
  });
}

/** Yes/no question. Resolves true only when the confirm button is pressed. */
export async function askConfirm(opts: AskOptions): Promise<boolean> {
  return (await open(opts, false)) !== null;
}

/** Question with a text (or password) field. Resolves the typed text, or null when cancelled. */
export function askText(opts: AskTextOptions): Promise<string | null> {
  return open(opts, true);
}

export function AskHost() {
  const [pending, setP] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    setPending = (p) => { setValue(""); setP(p); };
    return () => { setPending = null; };
  }, []);

  function finish(answer: string | null) {
    pending?.resolve(answer);
    setP(null);
  }
  const blocked = !!pending?.text && !!pending.required && !value.trim();

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && finish(null)}>
      {/* Above PdfOverlay (z-9999): pages ask mid-submit while their "Processing..." overlay is up. */}
      <DialogContent className="z-[10000] max-w-md" overlayClassName="z-[10000]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) finish(pending?.text ? value : "");
          }}
        >
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.description && <DialogDescription className="whitespace-pre-line">{pending.description}</DialogDescription>}
          </DialogHeader>
          {pending?.text && (
            <div className="space-y-1.5">
              {pending.inputLabel && <Label htmlFor="ask-input">{pending.inputLabel}</Label>}
              <Input
                id="ask-input"
                autoFocus
                type={pending.password ? "password" : "text"}
                autoComplete={pending.password ? "current-password" : "off"}
                placeholder={pending.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>{pending?.cancelLabel ?? "Cancel"}</Button>
            <Button type="submit" variant={pending?.destructive ? "destructive" : "default"} disabled={blocked} autoFocus={!pending?.text}>
              {pending?.confirmLabel ?? "OK"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
