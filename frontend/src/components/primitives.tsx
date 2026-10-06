import * as React from "react";
import {
  Button as ShadcnButton,
  type buttonVariants,
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

/* The shadcn `mira` preset sizes controls at h-7 (28px). This app is driven by
   warehouse handheld scanners and phone cameras, so every interactive control
   keeps a 44px minimum touch target. DESIGN.md independently requires 44px form
   fields and 44x44 pill buttons, so the two agree here.

   Button shape follows DESIGN.md Components: "Pill-shape is the only button
   shape across both tracks; rounded rectangles do not exist for buttons." */
const TOUCH = "min-h-11";
const PILL = "rounded-pill";
const FIELD =
  "min-h-11 rounded-md border border-input bg-background px-3.5 py-2.5 text-base " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

type ButtonProps = React.ComponentProps<typeof ShadcnButton>;

function Button({ className, size = "lg", ...props }: ButtonProps) {
  return (
    <ShadcnButton
      size={size}
      className={cn(TOUCH, PILL, "px-5 text-sm font-medium", className)}
      {...props}
    />
  );
}

function Input({ className, ...props }: React.ComponentProps<typeof ShadcnInput>) {
  return <ShadcnInput className={cn(FIELD, className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<typeof ShadcnTextarea>) {
  return <ShadcnTextarea className={cn(FIELD, className)} {...props} />;
}

function Label({ className, ...props }: React.ComponentProps<typeof ShadcnLabel>) {
  return <ShadcnLabel className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

/* Card: the preset uses rounded-lg + a 1px ring; this app's surfaces were a
   solid hairline border, so keep the border and lift the padding. */
function Card({ className, ...props }: React.ComponentProps<typeof ShadcnCard>) {
  return (
    <ShadcnCard
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-none",
        "[--card-spacing:--spacing(6)]",
        "max-[768px]:[--card-spacing:--spacing(5)]",
        className,
      )}
      {...props}
    />
  );
}

const CardHeader = ShadcnCardHeader;
const CardTitle = ShadcnCardTitle;
const CardDescription = ShadcnCardDescription;
const CardContent = ShadcnCardContent;
const CardFooter = ShadcnCardFooter;

/* Table: the preset's cells are px-2/p-2 at text-xs with whitespace-nowrap.
   This app's tables were p-4 at text-sm, and long addresses must wrap, so
   restore the roomier cell metrics and allow wrapping. */
function Table({ className, ...props }: React.ComponentProps<typeof ShadcnTable>) {
  return <ShadcnTable className={cn("text-sm", className)} {...props} />;
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <ShadcnTableHeader className={cn("bg-muted/50", className)} {...props} />
  );
}

const TableBody = ShadcnTableBody;

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <ShadcnTableRow className={cn("hover:bg-muted/40", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <ShadcnTableHead
      className={cn(
        "h-auto px-4 py-3.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <ShadcnTableCell
      className={cn("p-4 text-sm text-foreground whitespace-normal", className)}
      {...props}
    />
  );
}

const TableCaption = ShadcnTableCaption;

function Badge({ className, ...props }: React.ComponentProps<typeof ShadcnBadge>) {
  return (
    <ShadcnBadge
      className={cn(
        "h-auto min-h-5 gap-1.5 px-3 py-1 text-xs font-semibold",
        className,
      )}
      {...props}
    />
  );
}

/* Checkbox: the preset renders a size-4 box, below the 44px touch target, so
   pad the hit area rather than inflating the indicator itself. */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof ShadcnCheckbox>) {
  return <ShadcnCheckbox className={cn("size-4", className)} {...props} />;
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