import * as React from "react";
import { format, parseISO } from "date-fns";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./primitives";
import { IconCalendar } from "./icons";
import { cn } from "@/lib/utils";

export type MonthPickerProps = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* Replaces <input type="month">. The native control renders with the OS chrome
   and could not be styled to match the rest of the form, so this is a button +
   popover built on the same Calendar the range picker uses. It speaks the same
   "yyyy-MM" string the native input produced, so callers keep their format. */
export function MonthPicker({
  value,
  onChange,
  className,
  id,
  ariaLabel = "Month",
  placeholder = "Pick a month",
  disabled,
  min,
  max,
}: MonthPickerProps) {
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(() => {
    if (!value) return undefined;
    const [y, m] = value.split("-").map(Number);
    if (!y || !m) return undefined;
    return new Date(y, m - 1, 1);
  }, [value]);

  const now = new Date();
  const [viewYear, setViewYear] = React.useState(
    () => selected?.getFullYear() ?? now.getFullYear()
  );

  // Follow the committed value when the field is changed from outside.
  React.useEffect(() => {
    if (selected) setViewYear(selected.getFullYear());
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = selected ? `${MONTHS[selected.getMonth()]} ${selected.getFullYear()}` : "";

  const disabledFor = (y: number, m: number) => {
    const stamp = `${y}-${String(m + 1).padStart(2, "0")}`;
    if (min && stamp < min) return true;
    if (max && stamp > max) return true;
    return false;
  };

  const shiftYear = (delta: number) => setViewYear((y) => y + delta);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!value}
          aria-label={ariaLabel}
          className={cn(
            "h-9 w-full justify-start gap-2 rounded-md px-3 text-sm font-normal",
            "bg-card text-foreground shadow-xs",
            "data-[empty=true]:text-muted-foreground",
            className,
          )}
        >
          <IconCalendar size={15} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{label || placeholder}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[248px] p-3" onKeyDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous year"
            onClick={() => shiftYear(-1)}
          >
            ‹
          </Button>
          <span className="font-heading text-sm font-medium text-foreground tabular-nums">
            {viewYear}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next year"
            onClick={() => shiftYear(1)}
          >
            ›
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5" role="listbox" aria-label={ariaLabel}>
          {MONTHS.map((m, idx) => {
            const isSelected =
              selected?.getFullYear() === viewYear && selected?.getMonth() === idx;
            const disabled = disabledFor(viewYear, idx);
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                onClick={() => {
                  onChange(`${viewYear}-${String(idx + 1).padStart(2, "0")}`);
                  setOpen(false);
                }}
                className={cn(
                  "rounded-md border px-1 py-2 text-xs font-medium transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MonthPicker;