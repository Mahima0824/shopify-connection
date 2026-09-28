import React from "react";

export default function ScanBanner({ kind, text }: { kind: "ok" | "error" | "warn"; text: string }) {
  const icon = kind === "ok" ? "✅" : kind === "warn" ? "⚠️" : "❌";
  const statusColor = kind === "ok" ? "#10b981" : kind === "warn" ? "#f59e0b" : "#ef4444";

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{
        background: "var(--canvas)",
        border: "1px solid var(--hairline)",
        borderLeft: `4px solid ${statusColor}`,
        color: "var(--ink)",
        padding: "16px 20px",
        borderRadius: "10px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "15px",
        fontWeight: 600,
      }}
    >
      <span style={{ fontSize: "20px" }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
