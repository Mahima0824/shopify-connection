import React from "react";
import { Card } from "./primitives";

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
            <svg width={w} height={h} aria-hidden="true" className="mt-3 block">
              <polyline points={coords.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
            </svg>
          );
        })()
      : null;

  return (
    <Card className="p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-md hover:border-border/90">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {title}
        </span>
        {icon && (
          <div className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-foreground">
            {icon}
          </div>
        )}
      </div>
      <div className="text-[28px] leading-[1.1] font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {(subtitle || trend) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {trend && <span className="font-semibold text-foreground">{trend}</span>}
          {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
        </div>
      )}
      {sparkline}
    </Card>
  );
}