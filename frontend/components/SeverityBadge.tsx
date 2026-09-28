import React from "react";

const DOT_COLORS: Record<string, string> = {
  CRITICAL: "var(--brand-coral)",
  HIGH: "var(--brand-ochre)",
  MEDIUM: "var(--brand-lavender)",
  LOW: "var(--brand-teal)",
};

export default function SeverityBadge({ severity }: { severity: string }) {
  const dot = DOT_COLORS[severity] ?? "var(--muted)";
  return (
    <span className="badge-pill">
      <span
        aria-hidden="true"
        style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, flexShrink: 0 }}
      />
      <span>{severity}</span>
    </span>
  );
}
