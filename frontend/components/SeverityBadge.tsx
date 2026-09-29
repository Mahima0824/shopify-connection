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
  MEDIUM: "var(--accent)",
  LOW: "var(--muted)",
};

export default function SeverityBadge({ severity }: { severity: string }) {
  const cls = BADGE_CLASSES[severity] ?? "badge-neutral";
  const dot = DOT_COLORS[severity] ?? "var(--muted)";
  return (
    <span className={`badge ${cls}`}>
      <span
        aria-hidden="true"
        style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, flexShrink: 0 }}
      />
      <span>{severity}</span>
    </span>
  );
}
