import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import MetricCard from "../components/MetricCard";
import EmptyState from "../components/EmptyState";
import { Button, buttonVariants, Badge, Card, Input, Label, Checkbox } from "../components/primitives";
import {
  IconAlert,
  IconBox,
  IconClock,
  IconCoin,
  IconReceipt,
  IconRefund,
  IconReturn,
  IconSpark,
  IconTag,
  IconTruck,
  IconArrowUpRight,
} from "../components/icons";
import SelectField from "../components/SelectField";
import DateRangePicker from "../components/DateRangePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import "../styles/shopify-dashboard.css";

/* Matches the other filter controls in this header row. */
const DASH_TRIGGER =
  "w-full h-9 px-3 bg-card border border-border/80 rounded-lg text-xs font-semibold text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";

interface SparklineProps {
  type: "gross" | "rto" | "pending" | "orders" | "shipping";
}

function Sparkline({ type }: SparklineProps) {
  const width = 80;
  const height = 24;

  let pathD = "";
  if (type === "gross") {
    pathD = `M 0 ${height - 4} L 45 ${height - 4} Q 55 ${height - 4} 65 6 L 78 2`;
  } else if (type === "rto") {
    pathD = `M 0 ${height - 6} Q 30 ${height - 10} 50 ${height - 6} T 78 ${height - 6}`;
  } else if (type === "pending") {
    pathD = `M 0 ${height - 12} Q 25 ${height - 4} 50 ${height - 14} T 78 ${height - 8}`;
  } else if (type === "shipping") {
    pathD = `M 0 ${height - 4} L 30 ${height - 8} L 55 ${height - 6} L 78 ${height - 14}`;
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
        {type === "pending" && <circle cx="78" cy={height - 8} r="2" fill="var(--primary)" />}
        {type === "shipping" && <circle cx="78" cy={height - 14} r="2" fill="var(--primary)" />}
        {type === "orders" && <circle cx="78" cy={12} r="2" fill="var(--primary)" />}
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

function SalesOverTimeChart({
  currencySymbol,
  grossSales,
}: {
  currencySymbol: string;
  grossSales: number;
}) {
  const width = 640;
  const height = 220;
  const paddingTop = 20;
  const paddingBottom = 30;
  const paddingLeft = 45;
  const paddingRight = 20;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const times = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM", "11 PM"];
  const maxVal = Math.max(3000, Math.ceil(grossSales / 1000) * 1000);
  const octData = [
    0,
    0,
    0,
    Math.round(grossSales * 0.15),
    Math.round(grossSales * 0.6),
    Math.round(grossSales * 0.85),
    grossSales,
  ];
  const sepData = [0, 0, 0, 0, 0, 0, 0];

  const getX = (idx: number) => paddingLeft + (idx / (times.length - 1)) * chartWidth;
  const getY = (val: number) =>
    paddingTop + chartHeight - (val / (maxVal || 1)) * chartHeight;

  const octSolidPoints = octData
    .slice(0, 6)
    .map((val, idx) => `${getX(idx)},${getY(val)}`)
    .join(" L ");
  const octDashedPoints = octData
    .slice(5)
    .map((val, idx) => `${getX(idx + 5)},${getY(val)}`)
    .join(" L ");
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

  const gridSteps = [maxVal, Math.round(maxVal * 0.66), Math.round(maxVal * 0.33), 0];

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
        {gridSteps.map((val) => {
          const y = getY(val);
          const label =
            val === 0
              ? `${currencySymbol}0`
              : `${currencySymbol}${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}K`;
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

        <path
          d={`M ${sepPoints}`}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.4"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />
        <path d={`M ${octSolidPoints}`} fill="none" stroke="var(--primary)" strokeWidth="2" />
        <path
          d={`M ${octDashedPoints}`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
        <circle
          cx={getX(5)}
          cy={getY(octData[5])}
          r="3.5"
          fill="var(--primary)"
          stroke="#fff"
          strokeWidth="2"
        />

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
            <circle
              cx={hover.x}
              cy={getY(hover.octVal)}
              r="4.5"
              fill="var(--primary)"
              stroke="#ffffff"
              strokeWidth="2"
            />

            <g
              transform={`translate(${Math.min(hover.x - 60, width - 150)}, ${Math.max(
                paddingTop,
                getY(hover.octVal) - 60
              )})`}
            >
              <rect width="140" height="50" rx="6" fill="var(--foreground)" opacity="0.92" />
              <text
                x="10"
                y="18"
                fill="var(--background)"
                opacity="0.75"
                fontSize="11"
                fontFamily="inherit"
              >
                Period • {hover.timeLabel}
              </text>
              <text
                x="10"
                y="36"
                fill="var(--background)"
                fontSize="13"
                fontWeight="bold"
                fontFamily="inherit"
              >
                {currencySymbol}
                {hover.octVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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
  const [live, setLive] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Filter States - matching Orders section
  const [datePreset, setDatePreset] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [codMode, setCodMode] = useState(""); // "" (ALL), "PREPAID", "COD"

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    if (preset === "TODAY") {
      const todayStr = fmt(now);
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === "YESTERDAY") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = fmt(y);
      setDateFrom(yStr);
      setDateTo(yStr);
    } else if (preset === "THIS_MONTH") {
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      setDateFrom(firstDay);
      setDateTo(lastDay);
    } else if (preset === "LAST_MONTH") {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const firstDay = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = fmt(new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0));
      setDateFrom(firstDay);
      setDateTo(lastDay);
    } else if (preset === "ALL") {
      setDateFrom("");
      setDateTo("");
    }
  };

  const clearFilters = () => {
    setDatePreset("ALL");
    setDateFrom("");
    setDateTo("");
    setCodMode("");
  };

  const activeFiltersCount =
    (datePreset !== "ALL" || dateFrom || dateTo ? 1 : 0) + (codMode ? 1 : 0);

  const loadSummary = (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.append("date_from", dateFrom);
    if (dateTo) params.append("date_to", dateTo);
    if (codMode) params.append("cod_mode", codMode);
    const qs = params.toString() ? `?${params.toString()}` : "";

    api<any>(`/api/v1/dashboard/summary${qs}`)
      .then((res) => {
        setData(res?.data || res);
        setUpdatedAt(new Date().toLocaleTimeString());
      })
      .catch(() => {})
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    loadSummary();
  }, [dateFrom, dateTo, codMode]);

  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => loadSummary(true), 15000);
    return () => clearInterval(interval);
  }, [live, dateFrom, dateTo, codMode]);

  const currencySymbol = "₹";

  const kpis = data?.kpis;
  const financials = data?.financials;

  const grossSalesVal =
    financials?.gross_sales !== undefined
      ? financials.gross_sales
      : data
      ? 0
      : 17488.85;

  const formattedGrossSales = `${currencySymbol}${grossSalesVal.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const totalShippingVal =
    kpis?.total_shipping !== undefined
      ? kpis.total_shipping
      : financials?.total_shipping !== undefined
      ? financials.total_shipping
      : 0;

  const formattedTotalShipping = `${currencySymbol}${totalShippingVal.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const pendingOrdersVal = kpis?.pending_orders !== undefined ? `${kpis.pending_orders}` : "0";
  const inRtoVal = kpis?.in_rto !== undefined ? `${kpis.in_rto}` : "0";
  const totalOrdersVal = kpis?.orders_total !== undefined ? `${kpis.orders_total}` : "0";

  const selectClass =
    "w-full h-9 px-3 bg-card border border-border/80 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition shadow-xs";

  return (
    <div className="page-shell flex flex-col gap-6 bg-background">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-medium tracking-tight text-foreground text-2xl sm:text-3xl">
              Dashboard
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Sync
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Real-time operational metrics, order fulfillment pipeline &amp; shipping charges
          </p>
        </div>

        {/* Right-aligned Filter Controls */}
        <div className="flex flex-wrap items-end gap-2.5 sm:gap-3">
          {/* Payment Mode Filter: ALL, PREPAID, COD */}
          <SelectField
            label="Payment Mode"
            ariaLabel="Payment Mode"
            value={codMode}
            allLabel="ALL"
            onChange={setCodMode}
            options={[
              { value: "PREPAID", label: "PREPAID" },
              { value: "COD", label: "COD" },
            ]}
          />

          {/* Date Range Preset Filter. Uses a raw Select because "ALL" is a real
              preset here, not an empty-string sentinel. */}
          <div className="flex flex-col gap-1">
            <span className="font-heading text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Date Range
            </span>
            <Select value={datePreset} onValueChange={handleDatePresetChange}>
              <SelectTrigger className={DASH_TRIGGER} aria-label="Date Range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="bottom">
                <SelectItem value="TODAY">Today</SelectItem>
                <SelectItem value="YESTERDAY">Yesterday</SelectItem>
                <SelectItem value="THIS_MONTH">This Month</SelectItem>
                <SelectItem value="LAST_MONTH">Last Month</SelectItem>
                <SelectItem value="CUSTOM">Custom Date</SelectItem>
                <SelectItem value="ALL">All Dates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Clear button if active */}
          {activeFiltersCount > 0 && (
            <div className="flex flex-col gap-1 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs font-semibold shadow-xs"
                onClick={clearFilters}
                title="Reset all filters"
              >
                Clear ({activeFiltersCount})
              </Button>
            </div>
          )}

          {/* Live indicator */}
          <div className="flex flex-col gap-1 justify-end pl-2 sm:pl-3 border-l border-border/80">
            <Label className="cursor-pointer gap-2 h-9 text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap flex items-center">
              <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} aria-label="Live updates" />
              <span className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${live ? "bg-status-success animate-pulse" : "bg-muted-foreground"}`} />
                Live{updatedAt ? ` · ${updatedAt}` : ""}
              </span>
            </Label>
          </div>
        </div>
      </div>

      {/* Custom Date Pickers - shown only when 'Custom Date' is selected */}
      {datePreset === "CUSTOM" && (
        <div className="flex flex-wrap items-center justify-end gap-3 -mt-3 bg-muted/20 px-4 py-2.5 rounded-lg border border-border/60 animate-in fade-in-50 duration-200">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-heading">
            Custom Date Range:
          </span>
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={({ from, to }) => {
              setDateFrom(from);
              setDateTo(to);
            }}
            className="w-[280px] max-w-full"
          />
        </div>
      )}

      {/* Top 4 KPI Metrics Row with Sparklines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative p-4 shadow-xs border-border/80 flex items-center justify-between overflow-hidden">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">
              Gross sales
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-semibold font-heading text-foreground tabular-nums">
                {formattedGrossSales}
              </span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded border border-status-success/20">
                <IconArrowUpRight size={11} /> Live
              </span>
            </div>
          </div>
          <Sparkline type="gross" />
        </Card>

        <Card className="relative p-4 shadow-xs border-border/80 flex items-center justify-between overflow-hidden">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">
              Total Orders
            </span>
            <div className="mt-1">
              <span className="text-xl font-semibold font-heading text-foreground tabular-nums">
                {totalOrdersVal}
              </span>
            </div>
          </div>
          <Sparkline type="orders" />
        </Card>

        <Card className="relative p-4 shadow-xs border-border/80 flex items-center justify-between overflow-hidden">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">
              Pending Orders
            </span>
            <div className="mt-1">
              <span className="text-xl font-semibold font-heading text-foreground tabular-nums">
                {pendingOrdersVal}
              </span>
            </div>
          </div>
          <Sparkline type="pending" />
        </Card>

        <Card className="relative p-4 shadow-xs border-border/80 flex items-center justify-between overflow-hidden">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-heading">
              In RTO
            </span>
            <div className="mt-1">
              <span className="text-xl font-semibold font-heading text-foreground tabular-nums">
                {inRtoVal}
              </span>
            </div>
          </div>
          <Sparkline type="rto" />
        </Card>
      </div>

      {/* Main 2-Column Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
        {/* Sales Chart Card */}
        <Card className="p-5 shadow-xs border-border/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium font-heading text-foreground uppercase tracking-wider">
                Total sales over time
              </h3>
              <Badge variant="outline" className="text-[11px]">
                Realtime
              </Badge>
            </div>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-2xl font-semibold font-heading text-foreground tabular-nums">
                {formattedGrossSales}
              </span>
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded border border-status-success/20">
                <IconArrowUpRight size={12} /> Active
              </span>
            </div>
          </div>
          <SalesOverTimeChart currencySymbol={currencySymbol} grossSales={grossSalesVal} />
        </Card>

        {/* Sales Breakdown Card */}
        <Card className="p-5 shadow-xs border-border/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium font-heading text-foreground uppercase tracking-wider">
                Total sales breakdown
              </h3>
              <Badge variant="outline" className="text-[11px]">
                Tally ERP
              </Badge>
            </div>

            <div className="flex flex-col divide-y divide-border/60 text-sm">
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Gross sales</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formattedGrossSales}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Discounts</span>
                <span className="font-medium tabular-nums text-foreground">
                  {currencySymbol}0.00
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Sales reversals</span>
                <span className="font-medium tabular-nums text-foreground">
                  {currencySymbol}0.00
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between bg-primary/5 px-2 rounded-md">
                <span className="font-semibold text-primary">Net sales</span>
                <span className="font-semibold tabular-nums text-primary">
                  {formattedGrossSales}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Shipping charges</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formattedTotalShipping}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Taxes</span>
                <span className="font-medium tabular-nums text-foreground">
                  {currencySymbol}
                  {(financials?.total_tax ?? 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="pt-3 pb-1 flex items-center justify-between border-t-2 border-border">
                <span className="font-semibold font-heading text-foreground">Total sales</span>
                <span className="text-base font-semibold font-heading tabular-nums text-foreground">
                  {formattedGrossSales}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Operational KPI Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading font-medium tracking-tight text-lg text-foreground">
              Operational Health
            </h2>
            <p className="text-xs text-muted-foreground">
              Order fulfillment pipeline and shipping charges in selected timeframe
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            Audit Level: Active
          </Badge>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <MetricCard
            title="Total Orders"
            value={totalOrdersVal}
            icon={<IconBox />}
            subtitle={`${kpis?.paid_orders ?? 0} Paid (${
              kpis?.orders_total
                ? ((kpis.paid_orders / kpis.orders_total) * 100).toFixed(0)
                : 0
            }%)`}
          />
          <MetricCard
            title="Pending Orders"
            value={pendingOrdersVal}
            icon={<IconClock />}
            subtitle="Awaiting fulfillment / processing"
          />
          <MetricCard
            title="In RTO"
            value={inRtoVal}
            icon={<IconReturn />}
            subtitle="Return to origin in transit"
          />
          <MetricCard
            title="Total Shipping Charges"
            value={formattedTotalShipping}
            icon={<IconTruck />}
            subtitle="For orders in selected timeframe"
          />
        </div>
      </div>
    </div>
  );
}
