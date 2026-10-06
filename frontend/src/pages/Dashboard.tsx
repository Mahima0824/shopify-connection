import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import MetricCard from "../components/MetricCard";
import EmptyState from "../components/EmptyState";
import { Button, buttonVariants, Badge, Card } from "../components/primitives";
import {
  IconAlert,
  IconBox,
  IconCoin,
  IconReceipt,
  IconRefund,
  IconReturn,
  IconSpark,
  IconTag,
  IconTruck,
  IconCalendar,
  IconCalendarCompare,
  IconChevronDown,
  IconChevronUp,
  IconArrowUpRight,
  IconCurrencyExchange,
} from "../components/icons";
import "../styles/shopify-dashboard.css";

interface SparklineProps {
  type: "gross" | "rto" | "dispatch" | "orders";
}

function Sparkline({ type }: SparklineProps) {
  const width = 80;
  const height = 24;

  let pathD = "";
  if (type === "gross") {
    pathD = `M 0 ${height - 4} L 45 ${height - 4} Q 55 ${height - 4} 65 6 L 78 2`;
  } else if (type === "rto") {
    pathD = `M 0 ${height - 6} Q 30 ${height - 10} 50 ${height - 6} T 78 ${height - 6}`;
  } else if (type === "dispatch") {
    pathD = `M 0 ${height - 4} L 50 ${height - 4} L 78 ${height - 10}`;
  } else {
    pathD = `M 0 ${height - 4} L 60 ${height - 4} Q 70 ${height - 4} 78 ${height - 12}`;
  }

  return (
    <div className="shopify-sparkline-box">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
        <path
          d={pathD}
          stroke="var(--primary)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {type === "gross" && <circle cx="78" cy="2" r="2" fill="var(--primary)" />}
        {type === "dispatch" && <circle cx="78" cy={height - 10} r="2" fill="var(--primary)" />}
        {type === "orders" && <circle cx="78" cy="12" r="2" fill="var(--primary)" />}
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
  const width = 640;
  const height = 220;
  const paddingTop = 20;
  const paddingBottom = 30;
  const paddingLeft = 45;
  const paddingRight = 20;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const times = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM", "11 PM"];
  const octData = [0, 0, 0, 100, 2629.95, 2629.95, 2629.95];
  const sepData = [0, 0, 0, 0, 0, 0, 0];
  const maxVal = 3000;

  const getX = (idx: number) => paddingLeft + (idx / (times.length - 1)) * chartWidth;
  const getY = (val: number) => paddingTop + chartHeight - (val / maxVal) * chartHeight;

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
        {[3000, 2000, 1000, 0].map((val) => {
          const y = getY(val);
          const label = val === 0 ? "$0" : `$${val / 1000}K`;
          return (
            <g key={val}>
              <text
                x={paddingLeft - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--muted-foreground)"
                fontFamily="inherit"
              >
                {label}
              </text>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={val === 0 ? "none" : "3 3"}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {times.map((time, idx) => {
          const x = getX(idx);
          return (
            <text
              key={time}
              x={x}
              y={height - 10}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted-foreground)"
              fontFamily="inherit"
            >
              {time}
            </text>
          );
        })}

        <path d={`M ${sepPoints}`} fill="none" stroke="var(--primary)" strokeOpacity="0.4" strokeWidth="1.8" strokeDasharray="4 3" />
        <path d={`M ${octSolidPoints}`} fill="none" stroke="var(--primary)" strokeWidth="2" />
        <path d={`M ${octDashedPoints}`} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx={getX(5)} cy={getY(octData[5])} r="3.5" fill="var(--primary)" stroke="#fff" strokeWidth="2" />

        {hover && (
          <g>
            <line
              x1={hover.x}
              y1={paddingTop}
              x2={hover.x}
              y2={height - paddingBottom}
              stroke="var(--primary)"
              strokeDasharray="2 2"
              strokeWidth="1.2"
            />
            <circle cx={hover.x} cy={getY(hover.octVal)} r="4.5" fill="var(--primary)" stroke="#ffffff" strokeWidth="2" />

            <g transform={`translate(${Math.min(hover.x - 60, width - 150)}, ${Math.max(paddingTop, getY(hover.octVal) - 60)})`}>
              <rect width="140" height="50" rx="6" fill="var(--foreground)" opacity="0.92" />
              <text x="10" y="18" fill="var(--background)" opacity="0.75" fontSize="11" fontFamily="inherit">
                Period • {hover.timeLabel}
              </text>
              <text x="10" y="36" fill="var(--background)" fontSize="13" fontWeight="bold" fontFamily="inherit">
                {currencySymbol}{hover.octVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </text>
            </g>
          </g>
        )}
      </svg>

      <div className="flex justify-center items-center gap-6 mt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary inline-block" />
          <span>Current Period</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/40 inline-block" />
          <span>Previous Period</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [dateFilter, setDateFilter] = useState("Today");
  const [compareFilter, setCompareFilter] = useState("Yesterday");
  const [currency, setCurrency] = useState<"USD" | "INR">("INR");
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);

  const loadSummary = (silent = false) => {
    if (!silent) setLoading(true);
    api<any>("/api/v1/dashboard/summary")
      .then((res) => setData(res?.data || res))
      .catch(() => {})
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const handleQuickDemoLogin = async () => {
    try {
      setLoading(true);
      const res = await api<{ token: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "admin@t.in", password: "Pass123!" }),
      });
      localStorage.setItem("token", res.token);
      const summary = await api<any>("/api/v1/dashboard/summary");
      setData(summary?.data || summary);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleExcelExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:8000/api/v1/export/excel", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "recon_export.csv";
        a.click();
      }
    } catch (e) {
      console.error("Export error", e);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[400px] w-full max-w-[1280px] items-center justify-center bg-background px-6 max-[480px]:px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-muted-foreground">Loading Executive Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 bg-background px-6 max-[480px]:px-4">
        <div className="border-b border-border pb-6">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-foreground text-2xl sm:text-3xl">
              Executive Dashboard
            </h1>
            <Badge variant="outline" className="text-xs">
              Authentication Required
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time Operational Ledger &amp; Financial Reconciliation Metrics
          </p>
        </div>

        <div className="py-6 flex flex-col items-center w-full">
          <EmptyState
            icon={<IconAlert size={26} />}
            title="Dashboard unavailable"
            body="Please sign in or sync Shopify orders to populate metrics."
            primary={{ label: "Sign in", href: "/login" }}
            secondary={{ label: "Sync orders", href: "/orders" }}
          />

          <div className="mt-8 flex flex-col items-center gap-2.5 text-center">
            <p className="text-xs text-muted-foreground">
              Testing locally? Click below to authenticate and load live metrics immediately:
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickDemoLogin}
              className="gap-2 text-xs font-semibold shadow-xs hover:border-primary/50"
            >
              <span className="text-primary">
                <IconSpark size={14} />
              </span>
              One-Click Demo Login (admin@t.in)
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { kpis, financials } = data;
  const currencySymbol = currency === "USD" ? "$" : "₹";
  const multiplier = currency === "USD" ? 1 / 84 : 1;

  const rawGross = financials?.gross_sales ?? 0;
  const grossSalesVal = rawGross * multiplier;
  const formattedGrossSales = `${currencySymbol}${grossSalesVal.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const rtoValue = kpis?.rto_total !== undefined ? `${kpis.rto_total}` : "0";
  const dispatchedValue = kpis?.dispatched_orders !== undefined ? `${kpis.dispatched_orders}` : "0";
  const totalOrders = kpis?.orders_total !== undefined ? `${kpis.orders_total}` : "0";

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-foreground text-2xl sm:text-3xl">
              Executive Dashboard
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Sync
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time Operational Ledger &amp; Financial Reconciliation Metrics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDateFilter(dateFilter === "Today" ? "Last 7 Days" : "Today")}
            className="gap-1.5 text-xs shadow-xs"
          >
            <IconCalendar size={14} />
            <span>{dateFilter}</span>
            <IconChevronDown size={12} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCompareFilter(compareFilter === "Yesterday" ? "Previous Period" : "Yesterday")}
            className="gap-1.5 text-xs shadow-xs"
          >
            <IconCalendarCompare size={14} />
            <span>{compareFilter}</span>
            <IconChevronDown size={12} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrency(currency === "USD" ? "INR" : "USD")}
            title="Click to toggle currency"
            className="gap-1.5 text-xs shadow-xs"
          >
            <IconCurrencyExchange size={14} />
            <span>{currency === "USD" ? "$ USD" : "₹ INR"}</span>
          </Button>

          <Button onClick={handleExcelExport} disabled={exporting} size="sm" className="shadow-xs text-xs gap-1.5">
            <IconReceipt size={14} />
            {exporting ? "Generating..." : "Download Excel"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDashboardCollapsed(!dashboardCollapsed)}
            title={dashboardCollapsed ? "Expand Dashboard" : "Collapse Dashboard"}
            className="size-8 p-0"
          >
            {dashboardCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
          </Button>
        </div>
      </div>

      {!dashboardCollapsed && (
        <>
          {/* Top 4 KPI Metrics Row with Sparklines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 shadow-xs border-border/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">Gross Sales</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xl font-bold font-heading text-foreground tabular-nums">{formattedGrossSales}</span>
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    <IconArrowUpRight size={11} /> Live
                  </span>
                </div>
              </div>
              <Sparkline type="gross" />
            </Card>

            <Card className="p-4 shadow-xs border-border/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">RTO &amp; Returns</span>
                <div className="mt-1">
                  <span className="text-xl font-bold font-heading text-foreground tabular-nums">{rtoValue}</span>
                </div>
              </div>
              <Sparkline type="rto" />
            </Card>

            <Card className="p-4 shadow-xs border-border/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">Dispatched</span>
                <div className="mt-1">
                  <span className="text-xl font-bold font-heading text-foreground tabular-nums">{dispatchedValue}</span>
                </div>
              </div>
              <Sparkline type="dispatch" />
            </Card>

            <Card className="p-4 shadow-xs border-border/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">Total Orders</span>
                <div className="mt-1">
                  <span className="text-xl font-bold font-heading text-foreground tabular-nums">{totalOrders}</span>
                </div>
              </div>
              <Sparkline type="orders" />
            </Card>
          </div>

          {/* Main 2-Column Analytics Section */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
            {/* Sales Chart Card */}
            <Card className="p-5 shadow-xs border-border/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold font-heading text-foreground uppercase tracking-wider">
                    Total sales over time
                  </h3>
                  <Badge variant="outline" className="text-[11px]">Realtime</Badge>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-2xl font-bold font-heading text-foreground tabular-nums">{formattedGrossSales}</span>
                  <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    <IconArrowUpRight size={12} /> Active
                  </span>
                </div>
              </div>
              <SalesOverTimeChart currencySymbol={currencySymbol} />
            </Card>

            {/* Sales Breakdown Card */}
            <Card className="p-5 shadow-xs border-border/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold font-heading text-foreground uppercase tracking-wider">
                    Total sales breakdown
                  </h3>
                  <Badge variant="outline" className="text-[11px]">Tally ERP</Badge>
                </div>

                <div className="flex flex-col divide-y divide-border/60 text-sm">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Gross sales</span>
                    <span className="font-semibold tabular-nums text-foreground">{formattedGrossSales}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Discounts</span>
                    <span className="font-semibold tabular-nums text-foreground">{currencySymbol}0.00</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Sales reversals</span>
                    <span className="font-semibold tabular-nums text-foreground">{currencySymbol}0.00</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between bg-primary/5 px-2 rounded-md">
                    <span className="font-semibold text-primary">Net sales</span>
                    <span className="font-bold tabular-nums text-primary">{formattedGrossSales}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Shipping charges</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {currencySymbol}{(financials?.total_shipping ? financials.total_shipping * multiplier : 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Taxes</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {currencySymbol}{(financials?.total_tax ? financials.total_tax * multiplier : 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pt-3 pb-1 flex items-center justify-between border-t-2 border-border">
                    <span className="font-bold font-heading text-foreground">Total sales</span>
                    <span className="text-base font-bold font-heading tabular-nums text-foreground">{formattedGrossSales}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Operational KPI Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-heading font-bold tracking-tight text-lg text-foreground">Operational Health</h2>
                <p className="text-xs text-muted-foreground">Order fulfillment, dispatch, and settlement metrics</p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Audit Level: Active
              </Badge>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
              <MetricCard title="Total Orders" value={kpis.orders_total} icon={<IconBox />} subtitle={`${kpis.paid_orders} Paid`} />
              <MetricCard title="Dispatched Scans" value={kpis.dispatched_orders} icon={<IconTag />} subtitle={`${kpis.packed_orders} Packed`} />
              <MetricCard title="Returns / RTO" value={`${kpis.returns_total}`} icon={<IconReturn />} subtitle={`RTO Total: ${kpis.rto_total}`} />
              <MetricCard title="Open Exceptions" value={kpis.open_exceptions} icon={<IconAlert />} subtitle={`Reconciled: ${kpis.reconciled_rate}%`} />
            </div>
          </div>

          {/* Financial Breakdown Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-heading font-bold tracking-tight text-lg text-foreground">Financial Summary</h2>
                <p className="text-xs text-muted-foreground">Sales ledger and remittance reconciliation</p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Tally Prime Matched
              </Badge>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              <MetricCard title="Gross Sales" value={`₹${(financials?.gross_sales ?? 0).toLocaleString()}`} icon={<IconCoin />} />
              <MetricCard title="Total Tax" value={`₹${(financials?.total_tax ?? 0).toLocaleString()}`} icon={<IconReceipt />} />
              <MetricCard title="Total Shipping" value={`₹${(financials?.total_shipping ?? 0).toLocaleString()}`} icon={<IconTruck />} />
              <MetricCard title="Total Refunds" value={`₹${(financials?.total_refunds ?? 0).toLocaleString()}`} icon={<IconRefund />} />
              <MetricCard title="Net Revenue" value={`₹${(financials?.net_revenue ?? 0).toLocaleString()}`} icon={<IconSpark />} subtitle="Gross Sales minus Refunds" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}