import React from "react";
const ICONS: Record<string, string> = { CRITICAL: "❌", HIGH: "❌", MEDIUM: "⚠", LOW: "⚠" };
export default function SeverityBadge({ severity }: { severity: string }) {
  return <span>{ICONS[severity] ?? "○"} <span>{severity}</span></span>;
}
