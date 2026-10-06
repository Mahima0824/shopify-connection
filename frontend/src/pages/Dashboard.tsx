import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import "../styles/shopify-dashboard.css";
import {
  IconCalendar,
  IconCalendarCompare,
  IconChevronDown,
  IconChevronUp,
  IconArrowUpRight,
  IconCurrencyExchange,
} from "../components/icons";

interface SparklineProps {
  type: "gross" | "rto" | "dispatch" | "orders";
}

function Sparkline({ type }: SparklineProps) {
  const width = 80;
  const height = 24;

  let pathD = "";
  if (type === "gross") {
    // Starts flat, shoots up sharply at the end
    pathD = `M 0 ${height - 4} L 45 ${height - 4} Q 55 ${height - 4} 65 6 L 78 2`;
  } else if (type === "rto") {
    // Flat line with a small wave for RTO
    pathD = `M 0 ${height - 6} Q 30 ${height - 10} 50 ${height - 6} T 78 ${height - 6}`;
  } else if (type === "dispatch") {
    // Steady line with small upward trend
    pathD = `M 0 ${height - 4} L 50 ${height - 4} L 78 ${height - 10}`;
  } else {
    // Orders: flat then small tick up
    pathD = `M 0 ${height - 4} L 60 ${height - 4} Q 70 ${height - 4} 78 ${height - 12}`;
  }

  return (
    <div className="shopify-sparkline-box">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
        <path
          d={pathD}
          stroke="#00a3e0"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {type === "gross" && (
          <circle cx="78" cy="2" r="2" fill="#00a3e0" />
        )}
        {type === "dispatch" && (
          <circle cx="78" cy={height - 10} r="2" fill="#00a3e0" />
        )}
        {type === "orders" && (
          <circle cx="78" cy="12" r="2" fill="#00a3e0" />
        )}
      </svg>
    </div>
  );
}

interface ChartHoverState {
  x: number;
  timeLabel: string;
  octVal: number;
  sepVal: number;
}

function SalesOverTimeChart({ currencySymbol }: { currencySymbol: string }) {
  const width = 800;
  const height = 260;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const times = [
    "12 AM", "2 AM", "4 AM", "6 AM", "8 AM", "10 AM",
    "12 PM", "2 PM", "4 PM", "6 PM", "8 PM", "10 PM"
  ];

  // Data points corresponding to time slots
  const octData = [20, 25, 15, 10, 30, 2629.95, 2629.95, 2629.95, 2629.95, 2629.95, 2629.95, 2629.95];
  const sepData = [5, 10, 8, 12, 15, 20, 18, 15, 22, 10, 8, 5];

  const maxVal = 3000;

  const getX = (index: number) => {
    return paddingLeft + (index / (times.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / maxVal) * chartHeight;
  };

  const octSolidPoints = octData.slice(0, 6).map((val, idx) => `${getX(idx)},${getY(val)}`).join(" L ");
  const octDashedPoints = octData.slice(5).map((val, idx) => `${getX(idx + 5)},${getY(val)}`).join(" L ");
  const sepPoints = sepData.map((val, idx) => `${getX(idx)},${getY(val)}`).join(" L ");

  const [hover, setHover] = useState<ChartHoverState | null>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    if (mouseX < paddingLeft || mouseX > width - paddingRight) {
      setHover(null);
      return;
    }

    const relX = mouseX - paddingLeft;
    const idx = Math.round((relX / chartWidth) * (times.length - 1));
    const clampedIdx = Math.max(0, Math.min(times.length - 1, idx));

    setHover({
      x: getX(clampedIdx),
      timeLabel: times[clampedIdx],
      octVal: octData[clampedIdx],
      sepVal: sepData[clampedIdx],
    });
  };

  const handleMouseLeave = () => setHover(null);

  return (
    <div className="shopify-chart-container">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ overflow: "visible", cursor: "crosshair" }}
      >
        {/* Horizontal Gridlines & Y-Axis Labels */}
        {[3000, 2000, 1000, 0].map((val) => {
          const y = getY(val);
          const label = val === 0 ? `${currencySymbol}0` : `${currencySymbol}${val / 1000}K`;
          return (
            <g key={val}>
              <text
                x={paddingLeft - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#616161"
                fontFamily="sans-serif"
              >
                {label}
              </text>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="#e1e3e5"
                strokeDasharray={val === 0 ? "none" : "3 3"}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* X-Axis Labels */}
        {times.map((time, idx) => {
          const x = getX(idx);
          return (
            <text
              key={time}
              x={x}
              y={height - 10}
              textAnchor="middle"
              fontSize="11"
              fill="#616161"
              fontFamily="sans-serif"
            >
              {time}
            </text>
          );
        })}

        {/* Sep 30 Comparison Line */}
        <path
          d={`M ${sepPoints}`}
          fill="none"
          stroke="#a4d8fa"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />

        {/* Oct 1 Solid Line */}
        <path
          d={`M ${octSolidPoints}`}
          fill="none"
          stroke="#00a3e0"
          strokeWidth="2"
        />

        {/* Oct 1 Dashed Line */}
        <path
          d={`M ${octDashedPoints}`}
          fill="none"
          stroke="#00a3e0"
          strokeWidth="2"
          strokeDasharray="3 3"
        />

        {/* Active peak dot at 10 AM */}
        <circle cx={getX(5)} cy={getY(octData[5])} r="3.5" fill="#00a3e0" stroke="#fff" strokeWidth="2" />

        {/* Interactive Hover Guide Line & Tooltip */}
        {hover && (
          <g>
            <line
              x1={hover.x}
              y1={paddingTop}
              x2={hover.x}
              y2={height - paddingBottom}
              stroke="#00a3e0"
              strokeDasharray="2 2"
              strokeWidth="1.2"
            />
            <circle cx={hover.x} cy={getY(hover.octVal)} r="4.5" fill="#00a3e0" stroke="#ffffff" strokeWidth="2" />
            
            <g transform={`translate(${Math.min(hover.x - 60, width - 150)}, ${Math.max(paddingTop, getY(hover.octVal) - 60)})`}>
              <rect
                width="140"
                height="50"
                rx="6"
                fill="#1a1a1a"
                opacity="0.92"
              />
              <text x="10" y="18" fill="#a6a6a6" fontSize="11" fontFamily="sans-serif">
                Oct 1, 2026 • {hover.timeLabel}
              </text>
              <text x="10" y="36" fill="#ffffff" fontSize="13" fontWeight="bold" fontFamily="sans-serif">
                {currencySymbol}{hover.octVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </text>
            </g>
          </g>
        )}
      </svg>

      {/* Legend Below Chart */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "24px", marginTop: "12px", fontSize: "12px", color: "#616161" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00a3e0", display: "inline-block" }}></span>
          <span>Oct 1, 2026</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#a4d8fa", display: "inline-block" }}></span>
          <span>Sep 30, 2026</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filter States
  const [dateFilter, setDateFilter] = useState("Today");
  const [compareFilter, setCompareFilter] = useState("Yesterday");
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);

  useEffect(() => {
    api<any>("/api/v1/dashboard/summary")
      .then((res) => setData(res?.data || res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const currencySymbol = "₹";

  const grossSalesVal = data?.financials?.gross_sales
    ? data.financials.gross_sales
    : 17488.85;

  const formattedGrossSales = `${currencySymbol}${grossSalesVal.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  // Operational metrics for RTO & Dispatch
  const rtoValue = data?.kpis?.rto_total !== undefined ? `${data.kpis.rto_total}` : "0 —";
  const dispatchedValue = data?.kpis?.dispatched_orders !== undefined ? `${data.kpis.dispatched_orders}` : "0 —";
  const totalOrders = data?.kpis?.orders_total !== undefined ? `${data.kpis.orders_total}` : "1 —";

  return (
    <div className="shopify-dashboard-bg">
      <div className="shopify-dashboard-container">
        
        {/* Top Control Toolbar */}
        <div className="shopify-toolbar">
          <div style={{ position: "relative" }}>
            <button className="shopify-pill-btn" onClick={() => setDateFilter(dateFilter === "Today" ? "Last 7 Days" : "Today")}>
              <IconCalendar size={15} />
              <span>{dateFilter}</span>
              <IconChevronDown size={12} />
            </button>
          </div>

          <div style={{ position: "relative" }}>
            <button className="shopify-pill-btn" onClick={() => setCompareFilter(compareFilter === "Yesterday" ? "Previous Period" : "Yesterday")}>
              <IconCalendarCompare size={15} />
              <span>{compareFilter}</span>
              <IconChevronDown size={12} />
            </button>
          </div>
        </div>

        {/* Header Section */}
        <div className="shopify-section-header">
          <h1 className="shopify-section-title">Dashboard</h1>
          <button
            className="shopify-icon-btn"
            onClick={() => setDashboardCollapsed(!dashboardCollapsed)}
            title={dashboardCollapsed ? "Expand Dashboard" : "Collapse Dashboard"}
          >
            {dashboardCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
          </button>
        </div>

        {!dashboardCollapsed && (
          <>
            {/* Top 4 KPI Metrics Row */}
            <div className="shopify-kpi-grid">
              {/* Card 1: Gross Sales */}
              <div className="shopify-kpi-card">
                <div>
                  <div className="shopify-kpi-header">
                    <span className="shopify-kpi-label">Gross sales</span>
                  </div>
                  <div className="shopify-kpi-val-row">
                    <span className="shopify-kpi-value">{formattedGrossSales}</span>
                    <span className="shopify-trend-tag">
                      <IconArrowUpRight size={11} />
                      5.2K%
                    </span>
                  </div>
                </div>
                <Sparkline type="gross" />
              </div>

              {/* Card 2: RTO & Returns */}
              <div className="shopify-kpi-card">
                <div>
                  <div className="shopify-kpi-header">
                    <span className="shopify-kpi-label">RTO & Returns</span>
                  </div>
                  <div className="shopify-kpi-val-row">
                    <span className="shopify-kpi-value">{rtoValue}</span>
                  </div>
                </div>
                <Sparkline type="rto" />
              </div>

              {/* Card 3: Dispatched */}
              <div className="shopify-kpi-card">
                <div>
                  <div className="shopify-kpi-header">
                    <span className="shopify-kpi-label">Dispatched</span>
                  </div>
                  <div className="shopify-kpi-val-row">
                    <span className="shopify-kpi-value">{dispatchedValue}</span>
                  </div>
                </div>
                <Sparkline type="dispatch" />
              </div>

              {/* Card 4: Orders */}
              <div className="shopify-kpi-card">
                <div>
                  <div className="shopify-kpi-header">
                    <span className="shopify-kpi-label">Orders</span>
                  </div>
                  <div className="shopify-kpi-val-row">
                    <span className="shopify-kpi-value">{totalOrders}</span>
                  </div>
                </div>
                <Sparkline type="orders" />
              </div>
            </div>

            {/* Main Content 2-Column Layout */}
            <div className="shopify-main-grid">
              {/* Left Box: Total sales over time */}
              <div className="shopify-card">
                <div className="shopify-card-title">Total sales over time</div>
                <div className="shopify-big-metric">
                  <span className="shopify-big-number">{formattedGrossSales}</span>
                  <span className="shopify-trend-tag" style={{ fontSize: "14px" }}>
                    <IconArrowUpRight size={13} />
                    5.2K%
                  </span>
                </div>

                <SalesOverTimeChart currencySymbol={currencySymbol} />
              </div>

              {/* Right Box: Total sales breakdown */}
              <div className="shopify-card">
                <div className="shopify-card-title">Total sales breakdown</div>

                <div className="shopify-breakdown-list">
                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Gross sales</span>
                    <div className="shopify-breakdown-val">
                      <span>{formattedGrossSales}</span>
                      <span className="shopify-trend-tag">
                        <IconArrowUpRight size={11} />
                        5.2K%
                      </span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Discounts</span>
                    <div className="shopify-breakdown-val">
                      <span>{currencySymbol}0.00</span>
                      <span className="shopify-trend-neutral">—</span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Sales reversals</span>
                    <div className="shopify-breakdown-val">
                      <span>{currencySymbol}0.00</span>
                      <span className="shopify-trend-neutral">—</span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row highlighted">
                    <span className="shopify-breakdown-label">Net sales</span>
                    <div className="shopify-breakdown-val">
                      <span>{formattedGrossSales}</span>
                      <span className="shopify-trend-tag">
                        <IconArrowUpRight size={11} />
                        5.2K%
                      </span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Shipping charges</span>
                    <div className="shopify-breakdown-val">
                      <span>{currencySymbol}0.00</span>
                      <span className="shopify-trend-neutral">—</span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Return fees</span>
                    <div className="shopify-breakdown-val">
                      <span>{currencySymbol}0.00</span>
                      <span className="shopify-trend-neutral">—</span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row">
                    <span className="shopify-breakdown-label">Taxes</span>
                    <div className="shopify-breakdown-val">
                      <span>{currencySymbol}0.00</span>
                      <span className="shopify-trend-neutral">—</span>
                    </div>
                  </div>

                  <div className="shopify-breakdown-row total-row">
                    <span className="shopify-breakdown-label" style={{ color: "#1a1a1a", fontWeight: 700 }}>Total sales</span>
                    <div className="shopify-breakdown-val">
                      <span style={{ fontSize: "15px", fontWeight: 700 }}>{formattedGrossSales}</span>
                      <span className="shopify-trend-tag">
                        <IconArrowUpRight size={11} />
                        5.2K%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
