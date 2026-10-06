import React from "react";
import { Badge } from "./primitives";

/* Severity maps onto Badge variants rather than bespoke background colours, so
   the tones follow the theme instead of hardcoding emerald/amber/red. The dot
   colour is separate because Badge's variant already sets the text colour. */
const VARIANT: Record<string, "destructive" | "secondary" | "outline" | "default"> = {
  CRITICAL: "destructive",
  HIGH: "secondary",
  MEDIUM: "default",
  LOW: "outline",
};

const DOT: Record<string, string> = {
  CRITICAL: "var(--destructive)",
  HIGH: "var(--secondary-foreground)",
  MEDIUM: "var(--primary)",
  LOW: "var(--muted-foreground)",
};

export default function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={VARIANT[severity] ?? "outline"}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: DOT[severity] ?? "var(--muted-foreground)" }}
      />
      {severity}
    </Badge>
  );
}