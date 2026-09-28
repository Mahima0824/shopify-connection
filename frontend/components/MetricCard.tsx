import React from "react";

export default function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: string;
}) {
  return (
    <div className="glass-card" style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {title}
        </span>
        {icon && (
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: "rgba(99, 102, 241, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px"
          }}>
            {icon}
          </div>
        )}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {(subtitle || trend) && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "12px" }}>
          {trend && <span style={{ color: "var(--success)", fontWeight: 600 }}>{trend}</span>}
          {subtitle && <span style={{ color: "var(--text-muted)" }}>{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
