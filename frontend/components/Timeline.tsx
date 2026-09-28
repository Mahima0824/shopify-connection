import React from "react";

export type TNode = { at: string | null; kind: string; label: string; detail: string | null };

const KIND_DOTS: Record<string, string> = {
  CREATED: "var(--brand-lavender)",
  PAYMENT: "var(--brand-mint)",
  PACKED: "var(--brand-lavender)",
  DISPATCHED: "var(--brand-mint)",
  RETURN: "var(--brand-peach)",
  REFUND: "var(--brand-coral)",
  CANCELLED: "var(--brand-coral)",
  PAYMENT_PENDING: "var(--muted)",
  AUDIT: "var(--muted)",
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
          width: "2px",
          background: "var(--card)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {items.map((n, ix) => {
          const dot = KIND_DOTS[n.kind] || "var(--brand-lavender)";
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
              <div className="content-card" style={{ flex: 1, padding: "12px 16px" }}>
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
