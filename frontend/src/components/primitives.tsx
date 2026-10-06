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
    "inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    shadcnButtonVariants(opts),
  );
}

function Button({
  className,
  variant = "default",
  size = "default",
  pill = false,
  ...props
}: ButtonProps) {
  const sizeClasses = {
    default: "h-9 px-4 py-2 text-sm rounded-lg gap-2",
    sm: "h-8 px-3 text-xs rounded-md gap-1.5",
    lg: "h-10 px-5 text-sm font-medium rounded-lg gap-2",
    xs: "h-7 px-2.5 text-xs rounded-md gap-1",
    icon: "size-9 p-0 rounded-lg",
    "icon-sm": "size-8 p-0 rounded-md",
    "icon-lg": "size-10 p-0 rounded-lg",
  }[size as string] || "h-9 px-4 py-2 text-sm rounded-lg gap-2";

  return (
    <ShadcnButton
      variant={variant}
      size={size}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] shadow-xs hover:shadow-sm",
        sizeClasses,
        pill && "rounded-full px-5",
        className,
      )}
      {...props}
    />
  );
}

function Input({ className, ...props }: React.ComponentProps<typeof ShadcnInput>) {
  return (
    <ShadcnInput
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-background/90 px-3 py-1.5 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
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
        "min-h-20 w-full rounded-lg border border-input bg-background/90 px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
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
        "rounded-xl border border-border/80 bg-card text-card-foreground text-sm shadow-xs transition-all duration-200",
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
      className={cn("font-heading text-lg font-bold tracking-tight text-foreground", className)}
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
        "w-full overflow-x-auto",
        bare ? "" : "rounded-xl border border-border/80 bg-card shadow-xs",
        containerClassName,
      )}
    >
      <ShadcnTable className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <ShadcnTableHeader
      className={cn("bg-muted/40 border-b border-border/80 [&_tr]:border-b-0", className)}
      {...props}
    />
  );
}

const TableBody = ShadcnTableBody;

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <ShadcnTableRow
      className={cn(
        "border-b border-border/60 transition-colors duration-150 hover:bg-primary/[0.035] data-[state=selected]:bg-primary/10 last:border-b-0",
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
        "h-11 px-4 py-3 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-heading select-none whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <ShadcnTableCell
      className={cn("px-4 py-3 text-sm text-foreground align-middle whitespace-nowrap", className)}
      {...props}
    />
  );
}

const TableCaption = ShadcnTableCaption;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";

function Badge({
  className,
  variant = "default",
  ...props
}: Omit<React.ComponentProps<typeof ShadcnBadge>, "variant"> & { variant?: BadgeVariant }) {
  const variantClasses: Record<BadgeVariant, string> = {
    default: "bg-primary text-primary-foreground border-transparent shadow-xs",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    outline: "border-border text-foreground bg-background",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  };

  const isCustomVariant = ["success", "warning", "info"].includes(variant);
  const shadcnVariant = isCustomVariant ? "default" : (variant as any);

  return (
    <ShadcnBadge
      variant={shadcnVariant}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
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