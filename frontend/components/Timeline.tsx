import React from "react";

export type TNode = { at: string | null; kind: string; label: string; detail: string | null };

const KIND_COLORS: Record<string, string> = {
  CREATED: "#6366f1",
  PAYMENT: "#10b981",
  PACKED: "#06b6d4",
  DISPATCHED: "#10b981",
  RETURN: "#f59e0b",
  REFUND: "#ef4444",
  AUDIT: "#8b5cf6",
};

export default function Timeline({ items }: { items: TNode[] }) {
  if (!items || items.length === 0) {
    return <div style={{ color: "var(--text-muted)", fontSize: "14px" }}>No timeline events recorded yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "relative", paddingLeft: "8px" }}>
      {items.map((n, ix) => {
        const nodeColor = KIND_COLORS[n.kind] || "#94a3b8";
        return (
          <div key={ix} style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: nodeColor,
              marginTop: "4px",
              boxShadow: `0 0 10px ${nodeColor}`
            }} />
            <div style={{ flex: 1, background: "rgba(15, 23, 42, 0.6)", padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "#ffffff", fontSize: "14px" }}>{n.label}</span>
                {n.at && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{n.at}</span>}
              </div>
              {n.detail && <p style={{ fontSize: "13px", color: "#cbd5e1", marginTop: "4px" }}>{n.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
