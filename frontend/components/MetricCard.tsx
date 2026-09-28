import React from "react";

export default function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  points,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: string;
  points?: number[];
}) {
  const sparkline =
    points && points.length > 1
      ? (() => {
          const w = 120;
          const h = 32;
          const min = Math.min(...points);
          const max = Math.max(...points);
          const range = max - min || 1;
          const coords = points.map((p, i) => {
            const x = (i / (points.length - 1)) * w;
            const y = h - 4 - ((p - min) / range) * (h - 8);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          });
          return (
            <svg width={w} height={h} aria-hidden="true" style={{ display: "block", marginTop: "12px" }}>
              <polyline
                points={coords.join(" ")}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="1.5"
              />
            </svg>
          );
        })()
      : null;

  return (
    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {title}
        </span>
        {icon && (
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: "var(--card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px"
          }}>
            {icon}
          </div>
        )}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {(subtitle || trend) && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "12px" }}>
          {trend && <span style={{ color: "var(--ink)", fontWeight: 600 }}>{trend}</span>}
          {subtitle && <span style={{ color: "var(--muted)" }}>{subtitle}</span>}
        </div>
      )}
      {sparkline}
    </div>
  );
}
