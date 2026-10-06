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
  icon?: React.ReactNode;
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
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
            </svg>
          );
        })()
      : null;

  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {title}
        </span>
        {icon && (
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            background: "var(--neutral-bg)",
            border: "1px solid var(--hairline)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink)"
          }}>
            {icon}
          </div>
        )}
      </div>
      <div className="font-bold tracking-tight text-[var(--ink)] tabular-nums" style={{ fontSize: "28px", fontWeight: 600, lineHeight: 1.1 }}>
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
