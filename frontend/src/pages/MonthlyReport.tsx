import React, { useEffect, useRef, useState } from "react";
import { DatePicker } from "../components/DatePicker";
import { MonthPicker } from "../components/MonthPicker";
import { API } from "../lib/api";
import { api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import SelectField from "../components/SelectField";
import MetricCard from "../components/MetricCard";
import SeverityBadge from "../components/SeverityBadge";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
} from "../components/primitives";
import {
  GstReport,
  ProfitReport,
  REPORT_PRESETS,
  buildReportRangeQuery,
  getGstReport,
  getProfitReport,
} from "../lib/api";

function inr(v: string | number): string {
  const n = Number(v ?? 0);
  return `\u20B9${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

export default function MonthlyPage() {
  const [month, setMonth] = useState("2026-09");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [preset, setPreset] = useState("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [gst, setGst] = useState<GstReport | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const reqRef = useRef(0);

  function load(m: string) {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/reports/monthly?month=${m}`, {}, token)
      .then((d) => setData(d))
      .catch((e) => setError(e?.message ?? "Failed to load report"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function loadCards() {
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    setCardsLoading(true);
    setCardsError(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    const params =
      preset === "custom"
        ? { preset, ...(from ? { from } : {}), ...(to ? { to } : {}) }
        : { preset };
    void buildReportRangeQuery(params);
    Promise.all([getGstReport(params, token), getProfitReport(params, token)])
      .then(([g, p]) => {
        if (!isCurrent()) return;
        setGst(g);
        setProfit(p);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        setGst(null);
        setProfit(null);
        setCardsError(e?.message ?? "Failed to load GST/profit");
      })
      .finally(() => {
        if (isCurrent()) setCardsLoading(false);
      });
  }

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  async function download() {
    const token = localStorage.getItem("token") ?? "";
    setDownloading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/v1/reports/monthly/export?month=${month}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monthly_report_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="page-shell flex flex-col gap-6 bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-medium tracking-tight text-2xl sm:text-3xl text-foreground">
              Monthly Financial Report
            </h1>
            <Badge variant="secondary" className="text-xs">
              P&amp;L · GST Analytics
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational and financial metrics with profitability breakdowns and tax ledger validation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker
            value={month}
            onChange={setMonth}
            ariaLabel="Month"
            className="w-[170px]"
          />
          <Button onClick={download} disabled={downloading || !data}>
            {downloading ? "Exporting..." : "Download Excel"}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => load(month)}>
            Retry
          </Button>
        </div>
      )}

      <Card className="flex flex-col gap-3 p-5 border-border/80 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="preset" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Period preset
          </Label>
          <SelectField
            id="preset"
            ariaLabel="Period preset"
            value={preset}
            includeAll={false}
            onChange={setPreset}
            triggerClassName="w-full max-w-[220px]"
            options={REPORT_PRESETS.map((p) => ({ value: p, label: p }))}
          />
          {preset === "custom" && (
            <div className="flex flex-wrap gap-2">
              <DatePicker
                value={from}
                onChange={setFrom}
                ariaLabel="From"
                className="w-[170px]"
              />
              <DatePicker
                value={to}
                onChange={setTo}
                ariaLabel="To"
                className="w-[170px]"
              />
            </div>
          )}
          <Button variant="outline" onClick={loadCards} disabled={cardsLoading}>
            Apply period
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Financial year runs Apr to Mar (financial_year / last_fy). Explicit from/to wins over the preset.
        </p>
      </Card>

      {cardsError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{cardsError}</span>
          <Button variant="outline" size="sm" onClick={loadCards}>
            Retry
          </Button>
        </div>
      )}

      {cardsLoading ? (
        <div className="p-4 text-center text-sm text-muted-foreground">
          Loading GST and profit&hellip;
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="text-base font-medium text-foreground mb-3">GST</h2>
            {gst ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <MetricCard title="Taxable" value={inr(gst.totals?.taxable ?? 0)} />
                  <MetricCard title="CGST" value={inr(gst.totals?.cgst ?? 0)} />
                  <MetricCard title="SGST" value={inr(gst.totals?.sgst ?? 0)} />
                  <MetricCard title="IGST" value={inr(gst.totals?.igst ?? 0)} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {gst.orders ?? 0} orders &middot; {gst.invalid ?? 0} invalid
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  GST treatment must be reviewed by the CA before filing.
                </p>
                {(gst.rows ?? []).some((r) =>
                  (r.warnings ?? []).some((w) => w === "IGST_UNVERIFIED" || w === "JURISDICTION_UNKNOWN"),
                ) && (
                  <div className="mt-2 flex items-center gap-2">
                    <SeverityBadge severity="HIGH" />
                    <span className="text-xs text-foreground">IGST-UNVERIFIED: intra-state split assumed, CA review required.</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No GST data for this period.</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-medium text-foreground mb-3">Profit</h2>
            {profit ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <MetricCard title="Gross profit" value={inr(profit.profit?.gross_profit ?? 0)} />
                  <MetricCard title="Operating profit" value={inr(profit.profit?.operating_profit ?? 0)} subtitle={profit.profit?.label ?? ""} />
                  <MetricCard title="Margin" value={`${profit.profit?.margin_pct ?? "0.00"}%`} />
                  <MetricCard title="Net sales" value={inr(profit.revenue?.net_exclusive ?? 0)} />
                </div>
                {profit.profit?.warning ? (
                  <div className="mt-2 flex items-center gap-2">
                    <SeverityBadge severity="MEDIUM" />
                    <span className="text-xs text-foreground">{profit.profit.warning}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No profit data for this period.</p>
            )}
          </Card>
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading report...</div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {data.orders?.total === 0 ? (
            <EmptyState
              title={`No orders in ${month}`}
              body="Sync Shopify or import a CSV, then come back."
              primary={{ label: "Sync orders", href: "/orders" }}
              secondary={{ label: "Import CSV", href: "/import" }}
            />
          ) : (
            <>
              <Card className="p-5">
                <h2 className="text-base font-medium text-foreground mb-2">Orders</h2>
                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-4 text-xs font-mono text-foreground">
                  {JSON.stringify(data.orders, null, 2)}
                </pre>
              </Card>
              <Card className="p-5">
                <h2 className="text-base font-medium text-foreground mb-2">Money</h2>
                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-4 text-xs font-mono text-foreground">
                  {JSON.stringify(data.money, null, 2)}
                </pre>
              </Card>
              <Card className="p-5">
                <h2 className="text-base font-medium text-foreground mb-2">
                  Profitability ({data.profitability?.label})
                </h2>
                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-4 text-xs font-mono text-foreground">
                  {JSON.stringify(data.profitability, null, 2)}
                </pre>
              </Card>
              <Card className="p-5">
                <h2 className="text-base font-medium text-foreground mb-2">Exceptions</h2>
                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-4 text-xs font-mono text-foreground">
                  {JSON.stringify(data.exceptions, null, 2)}
                </pre>
              </Card>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
