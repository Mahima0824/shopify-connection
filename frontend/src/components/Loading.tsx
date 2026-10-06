import React from "react";

export default function Loading() {
  const bar = (width: string): React.CSSProperties => ({
    height: 14,
    width,
    borderRadius: 7,
    background: "var(--neutral-bg)",
  });
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-busy="true" aria-label="Loading page">
      <div style={{ ...bar("32%"), height: 28 }} />
      <div style={bar("55%")} />
      <div className="content-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={bar("90%")} />
        <div style={bar("75%")} />
        <div style={bar("82%")} />
      </div>
    </div>
  );
}
