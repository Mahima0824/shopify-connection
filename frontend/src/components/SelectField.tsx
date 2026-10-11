import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "@/lib/utils";

/* Radix Select cannot hold an empty-string value, so every "no filter" option
   needs a non-empty sentinel. Handling that here means the 26 call sites do
   not each re-implement it (and none can forget, which would silently filter
   on a literal "ALL"). */
export const ALL = "__all__";
const fromSelect = (v: string) => (v === ALL ? "" : v);

const TRIGGER =
  "w-full h-9 px-3 bg-card border border-border/80 rounded-md text-sm font-normal text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";

/* The tracking pages originally used a taller native select (min-h-11) that did
   not line up with the h-9 Input beside it. Height now matches the Input so the
   filter row reads as one baseline; only the width behaviour differs. */
const TALL_TRIGGER =
  "h-9 w-full flex-1 min-w-[140px] px-3 py-1.5 rounded-md border border-input bg-background text-sm font-normal text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 transition-colors";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /* Rendered ahead of the label in both the list and the trigger. Radix's
     SelectValue mirrors the selected item's children, so the icon follows the
     selection into the closed trigger without extra plumbing. */
  icon?: React.ReactNode;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
  triggerClassName,
  ariaLabel,
  allLabel = "All",
  includeAll = true,
  tall = false,
  id,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  allLabel?: string;
  /* Turn off for selects where "empty" is not meaningful, e.g. a required
     page-size or carrier choice. */
  includeAll?: boolean;
  tall?: boolean;
  /* For pages that pair the field with an external <Label htmlFor>. */
  id?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <span className="font-heading text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <Select value={value || (includeAll ? ALL : "")} onValueChange={(v) => onChange(fromSelect(v))}>
        <SelectTrigger
          id={id}
          className={cn(tall ? TALL_TRIGGER : TRIGGER, triggerClassName)}
          aria-label={ariaLabel ?? label}
        >
          <SelectValue placeholder={placeholder ?? allLabel} />
        </SelectTrigger>
        <SelectContent side="bottom">
          {includeAll && (
            <SelectItem value={ALL}>{allLabel}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.icon ? (
                <span className="flex items-center gap-2">
                  {o.icon}
                  <span>{o.label}</span>
                </span>
              ) : (
                o.label
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default SelectField;