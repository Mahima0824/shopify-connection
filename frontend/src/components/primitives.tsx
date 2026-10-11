import * as React from "react";
import {
  Button as ShadcnButton,
  buttonVariants as shadcnButtonVariants,
} from "./ui/button";
import { Input as ShadcnInput } from "./ui/input";
import { Textarea as ShadcnTextarea } from "./ui/textarea";
import {
  Card as ShadcnCard,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
  CardDescription as ShadcnCardDescription,
  CardContent as ShadcnCardContent,
  CardFooter as ShadcnCardFooter,
} from "./ui/card";
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableRow as ShadcnTableRow,
  TableHead as ShadcnTableHead,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from "./ui/table";
import { Badge as ShadcnBadge } from "./ui/badge";
import { Label as ShadcnLabel } from "./ui/label";
import { Checkbox as ShadcnCheckbox } from "./ui/checkbox";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof ShadcnButton> & {
  pill?: boolean;
};

function buttonVariants(opts?: Parameters<typeof shadcnButtonVariants>[0]) {
  return cn(
    "inline-flex items-center justify-center font-medium transition-all duration-300 ease-linear cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    shadcnButtonVariants(opts),
  );
}

/* forwardRef is load-bearing: Radix's Slot (PopoverTrigger, DropdownMenuTrigger
   and friends) attaches a ref to the child to measure its anchor. A plain
   function component swallows the ref, which breaks trigger positioning and
   logs a React warning. */
const Button = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & { asChild?: boolean }
>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    pill = false,
    asChild = false,
    ...props
  },
  ref,
) {
  /* Radii follow the measured reference: 6px on buttons (--radius-sm), 10px
     on cards (--radius-lg). Height/padding keep this app's dense control
     scale so tables and filter bars keep their row rhythm. */
  const sizeClasses = {
    default: "h-9 px-4 py-2 text-sm rounded-md gap-2",
    sm: "h-8 px-3 text-xs rounded-md gap-1.5",
    lg: "h-10 px-5 text-sm font-medium rounded-md gap-2",
    xs: "h-7 px-2.5 text-xs rounded-sm gap-1",
    icon: "size-9 p-0 rounded-md",
    "icon-sm": "size-8 p-0 rounded-sm",
    "icon-lg": "size-10 p-0 rounded-md",
  }[size as string] || "h-9 px-4 py-2 text-sm rounded-md gap-2";

  return (
    <ShadcnButton
      ref={ref}
      variant={variant}
      size={size}
      asChild={asChild}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-300 ease-linear cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] shadow-xs hover:shadow-sm",
        sizeClasses,
        pill && "rounded-full px-5",
        className,
      )}
      {...props}
    />
  );
});

function Input({ className, ...props }: React.ComponentProps<typeof ShadcnInput>) {
  return (
    <ShadcnInput
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background/90 px-3 py-1.5 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<typeof ShadcnTextarea>) {
  return (
    <ShadcnTextarea
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-background/90 px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<typeof ShadcnLabel>) {
  return (
    <ShadcnLabel
      className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    />
  );
}

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-lg border border-border/80 bg-card text-card-foreground text-sm shadow-xs transition-all duration-300 ease-linear",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-6 pb-4", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("font-heading text-lg font-medium tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs sm:text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-6 pt-0", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  );
}

type TableProps = React.ComponentProps<typeof ShadcnTable> & {
  containerClassName?: string;
  bare?: boolean;
};

function Table({ className, containerClassName, bare, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "w-full overflow-x-auto no-scrollbar",
        bare ? "" : "rounded-lg border border-border/80 bg-card shadow-xs",
        containerClassName,
      )}
    >
      {/* Vertical rules between columns give the grid structure that row
          borders alone cannot; without them dense tables read as loose text. */}
      <ShadcnTable
        className={cn(
          "w-full text-sm [&_td]:border-l [&_td]:border-border/40 [&_th]:border-l [&_th]:border-border/40 [&_td:first-child]:border-l-0 [&_th:first-child]:border-l-0",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <ShadcnTableHeader
      className={cn("bg-muted/50 border-b border-border [&_tr]:border-b-0", className)}
      {...props}
    />
  );
}

const TableBody = ShadcnTableBody;

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <ShadcnTableRow
      className={cn(
        "border-b border-border/50 transition-colors duration-150 ease-in-out hover:bg-muted/40 data-[state=selected]:bg-primary/10 last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <ShadcnTableHead
      className={cn(
        "h-11 px-4 py-2.5 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-heading select-none whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <ShadcnTableCell
      className={cn(
        "px-4 py-3 text-xs sm:text-sm text-foreground align-middle whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

const TableCaption = ShadcnTableCaption;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";

/* A Badge wrapping an empty value used to render an empty pill - border and
     padding with nothing inside, which reads as a broken input box. Call sites
     pass the value straight through, so the fallback belongs here rather than
     being repeated at each of the ~9 sites that render a possibly-null field. */
function Badge({
  className,
  variant = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof ShadcnBadge>, "variant"> & { variant?: BadgeVariant }) {
  /* Tones come from the measured status tokens, not the raw Tailwind palette,
     and carry no dark: variant because the app ships no ThemeProvider. */
  const variantClasses: Record<BadgeVariant, string> = {
    default: "bg-primary text-primary-foreground border-transparent shadow-xs",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    outline: "border-border text-foreground bg-background",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    success: "bg-status-success/10 text-status-success border-status-success/20",
    warning: "bg-status-warning/10 text-status-warning border-status-warning/20",
    info: "bg-status-info/10 text-status-info border-status-info/20",
  };

  const isCustomVariant = ["success", "warning", "info"].includes(variant);
  const shadcnVariant = isCustomVariant ? "default" : (variant as any);
  const isEmpty = children === null || children === undefined || children === "";

  return (
    <ShadcnBadge
      variant={shadcnVariant}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors duration-150 ease-in-out",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {isEmpty ? "—" : children}
    </ShadcnBadge>
  );
}

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnCheckbox>) {
  return (
    <ShadcnCheckbox
      className={cn(
        "size-4 rounded border-input ring-offset-background focus-visible:ring-ring focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export {
  Button,
  Input,
  Textarea,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  Badge,
  Checkbox,
  buttonVariants,
};
export type { ButtonProps };