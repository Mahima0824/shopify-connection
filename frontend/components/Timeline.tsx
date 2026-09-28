import React from "react";

export type TNode = { at: string | null; kind: string; label: string; detail: string | null };

const KIND_DOTS: Record<string, string> = {
  DISPATCHED: "#34d399",
  RETURN: "#fb923c",
  REFUND: "#ef4444",
};

export default function Timeline({ items }: { items: TNode[] }) {
  if (!items || items.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "14px" }}>No timeline events recorded yet.</div>;
  }

  return (
    <div style={{ position: "relative", paddingLeft: "20px" }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "5px",
          top: "8px",
          bottom: "8px",
          width: "1px",
          background: "var(--hairline)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {items.map((n, ix) => {
          const dot = KIND_DOTS[n.kind] || "#8b5cf6";
          return (
            <div key={ix} style={{ display: "flex", gap: "16px", alignItems: "flex-start", position: "relative" }}>
              <div
                aria-hidden="true"
                style={{
                  width: "11px",
                  height: "11px",
                  borderRadius: "50%",
                  background: dot,
                  marginTop: "4px",
                  marginLeft: "-20px",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, background: "var(--canvas)", padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: "14px" }}>{n.label}</span>
                  {n.at && <span style={{ fontSize: "12px", color: "var(--muted)" }}>{n.at}</span>}
                </div>
                {n.detail && <p style={{ fontSize: "13px", color: "var(--body)", marginTop: "4px" }}>{n.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
