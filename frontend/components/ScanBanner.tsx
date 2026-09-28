import React from "react";

export default function ScanBanner({ kind, text }: { kind: "ok" | "error" | "warn"; text: string }) {
  const icon = kind === "ok" ? "✅" : kind === "warn" ? "⚠️" : "❌";
  const bg = kind === "ok"
    ? "rgba(16, 185, 129, 0.15)"
    : kind === "warn"
    ? "rgba(245, 158, 11, 0.15)"
    : "rgba(239, 68, 68, 0.15)";
  const border = kind === "ok"
    ? "rgba(16, 185, 129, 0.4)"
    : kind === "warn"
    ? "rgba(245, 158, 11, 0.4)"
    : "rgba(239, 68, 68, 0.4)";
  const color = kind === "ok" ? "#34d399" : kind === "warn" ? "#fbbf24" : "#f87171";

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        color: color,
        padding: "16px 20px",
        borderRadius: "10px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "15px",
        fontWeight: 600,
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
      }}
    >
      <span style={{ fontSize: "20px" }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
