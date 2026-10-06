import React from "react";

export default function Loading() {
  const bar = (width: string): React.CSSProperties => ({
    height: 14,
    width,
    borderRadius: 7,
    background: "var(--neutral-bg)",
  });
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-busy="true" aria-label="Loading page">
      <div style={{ ...bar("32%"), height: 28 }} />
      <div style={bar("55%")} />
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={bar("90%")} />
        <div style={bar("75%")} />
        <div style={bar("82%")} />
      </div>
    </div>
  );
}
