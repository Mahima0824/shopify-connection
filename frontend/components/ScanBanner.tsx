import React from "react";
import { IconAlert, IconSpark } from "./icons";

export default function ScanBanner({ kind, text }: { kind: "ok" | "error" | "warn"; text: string }) {
  const statusColor = kind === "ok" ? "var(--success)" : kind === "warn" ? "var(--warning)" : "var(--error)";

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="content-card"
      style={{
        borderLeft: `4px solid ${statusColor}`,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "15px",
        fontWeight: 600,
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--ink)" }}>
        {kind === "ok" ? <IconSpark /> : <IconAlert />}
      </span>
      <span>{text}</span>
    </div>
  );
}
