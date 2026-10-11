import * as React from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar } from "./ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { Button } from "./primitives";
import { cn } from "@/lib/utils";
import { IconCalendar } from "./icons";

export type DateRangeValue = { from: string; to: string };

/* The picker speaks the same "yyyy-MM-dd" strings the orders API expects, so
   nothing downstream has to re-format. parseISO/fmt keeps the parsing in one
   place and handles the local-midnight edge that `new Date("yyyy-MM-dd")`
   gets wrong in negative UTC offsets. */
const toApiDate = (d: Date) => format(d, "yyyy-MM-dd");

function describe(from: string, to: string) {
  if (from && to) {
    return from === to
      ? format(parseISO(from), "d MMM yyyy")
      : `${format(parseISO(from), "d MMM")} - ${format(parseISO(to), "d MMM yyyy")}`;
  }
  if (from) return `${format(parseISO(from), "d MMM yyyy")} -`;
  return "Pick a date range";
}

export function DateRangePicker({
  from,
  to,
  onChange,
  className,
  disabled,
  id,
}: {
  from: string;
  to: string;
  onChange: (next: DateRangeValue) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);

  // An incomplete range is the normal mid-selection state: react-day-picker
  // holds `from` with `to` undefined until the second click, and we mirror
  // that rather than dropping the partial pick on every re-render.
  const selected = React.useMemo<DateRange | undefined>(() => {
    if (!from && !to) return undefined;
    return {
      from: from ? parseISO(from) : undefined,
      to: to ? parseISO(to) : undefined,
    };
  }, [from, to]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      onChange({ from: "", to: "" });
      return;
    }
    onChange({
      from: toApiDate(range.from),
      // to is undefined until the second click; keep the from-only pick so the
      // trigger text can show "1 Mar 2026 -" and the caller still filters.
      to: range.to ? toApiDate(range.to) : "",
    });
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ from: "", to: "" });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-start gap-2 rounded-md px-3 text-sm font-normal",
            // Mirror the native date input's chrome so this reads as the same
            // control it replaces rather than as a button.
            "bg-card text-foreground shadow-xs",
            "data-[empty=true]:text-muted-foreground",
            className,
          )}
          data-empty={!from && !to}
        >
          <IconCalendar size={15} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{describe(from, to)}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-auto gap-3 p-3"
        // The popover is a filter control; letting Escape fall through to the
        // dialog/row handlers would close unrelated surfaces.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Calendar
          mode="range"
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={handleSelect}
          // Two months side by side on wide screens so a range is pickable in
          // one pass rather than paging back and forth.
          numberOfMonths={2}
          autoFocus
        />

        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="truncate text-[11px] text-muted-foreground">
            {from || to ? (
              <>
                {from ? format(parseISO(from), "d MMM yyyy") : "Start"}
                {" – "}
                {to ? format(parseISO(to), "d MMM yyyy") : "End"}
              </>
            ) : (
              "Select a start and end date"
            )}
          </span>
          {(from || to) && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={clear}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* Single-date variant. Shares the trigger treatment with the range picker so a
   from/to pair reads as one control family. */
export function DatePicker({
  value,
  onChange,
  className,
  id,
  ariaLabel = "Date",
  placeholder = "Pick a date",
  disabled,
  min,
  max,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(
    () => (value ? parseISO(value) : undefined),
    [value]
  );

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
          <span className="truncate">
            {selected ? format(selected, "d MMM yyyy") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-auto p-3"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (d) onChange(toApiDate(d));
          }}
          disabled={[
            ...(min ? [{ before: parseISO(min) }] : []),
            ...(max ? [{ after: parseISO(max) }] : []),
          ]}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export default DateRangePicker;