import React from "react";

const BADGE_CLASSES: Record<string, string> = {
  CRITICAL: "badge-danger",
  HIGH: "badge-warning",
  MEDIUM: "badge-info",
  LOW: "badge-neutral",
};

const DOT_COLORS: Record<string, string> = {
  CRITICAL: "var(--error)",
  HIGH: "var(--warning)",
  MEDIUM: "var(--primary)",
  LOW: "var(--muted-foreground)",
};

export default function SeverityBadge({ severity }: { severity: string }) {
  const cls = BADGE_CLASSES[severity] ?? "badge-neutral";
  const dot = DOT_COLORS[severity] ?? "var(--muted-foreground)";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground ${cls}`}>
      <span
        aria-hidden="true"
        style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, flexShrink: 0 }}
      />
      <span>{severity}</span>
    </span>
  );
}
