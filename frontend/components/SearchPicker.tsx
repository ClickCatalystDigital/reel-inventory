"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Option<V> {
  value: V;
  label: string;
}
interface Common<V> {
  options: Option<V>[];
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
}
type Props<V> = Common<V> &
  ({ multiple: true; value: V[]; onChange: (v: V[]) => void } | { multiple?: false; value: V | null; onChange: (v: V | null) => void });

// Searchable dropdown: single pick (category) or multi pick with checkboxes (companies).
export function SearchPicker<V extends string | number>(props: Props<V>) {
  const { options, placeholder, searchPlaceholder = "Search", className } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = props.multiple ? props.value : props.value === null ? [] : [props.value];
  const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));

  function pick(v: V) {
    if (props.multiple) props.onChange(selected.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    else {
      props.onChange(v);
      setOpen(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // Same look as <Input>: transparent field, input border, focus ring.
          className={cn(
            "h-8 justify-between rounded-lg border-input bg-transparent px-2.5 font-normal hover:bg-transparent aria-expanded:bg-transparent dark:bg-input/30 dark:hover:bg-input/30",
            className
          )}
        >
          <span className={cn("truncate", !labels.length && "text-muted-foreground")}>
            {labels.length === 0 ? placeholder : labels.length === 1 ? labels[0] : `${labels.length} selected`}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-2" align="start">
        <Input autoFocus className="mb-2 h-8" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto">
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => pick(o.value)}
            >
              {props.multiple ? (
                <Checkbox checked={selected.includes(o.value)} tabIndex={-1} className="pointer-events-none" />
              ) : (
                <Check className={cn("size-4", selected.includes(o.value) ? "opacity-100" : "opacity-0")} />
              )}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
          {shown.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No match</div>}
        </div>
        {selected.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              if (props.multiple) props.onChange([]);
              else props.onChange(null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
