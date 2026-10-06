import React, { useEffect, useRef, useState } from "react";
import { API } from "../lib/api";
import { api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import MetricCard from "../components/MetricCard";
import SeverityBadge from "../components/SeverityBadge";
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
  // "U+20B9" (rupee sign) as a unicode escape keeps this file pure ASCII.
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
    // Keep query-builder import referenced so preset wiring stays covered.
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>Monthly report</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Operational + financial summary with profitability</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input type="month" value={month} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} aria-label="Month" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" />
          <button onClick={download} disabled={downloading || !data} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">
            {downloading ? "Exporting..." : "Download Excel"}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {error} <button onClick={() => load(month)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="preset" style={{ fontSize: "13px", fontWeight: 600 }}>Period preset</label>
          <select
            id="preset"
            aria-label="Period preset"
            className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
            value={preset}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPreset(e.target.value)}
            style={{ width: "220px" }}
          >
            {REPORT_PRESETS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" aria-label="From" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
              <input type="date" aria-label="To" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
            </>
          )}
          <button onClick={loadCards} disabled={cardsLoading} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">Apply period</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "12px", margin: "8px 0 0" }}>
          Financial year runs Apr to Mar (financial_year / last_fy). Explicit from/to wins over the preset.
        </p>
      </div>
      {cardsError && (
        <div role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {cardsError} <button onClick={loadCards} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}
      {cardsLoading ? (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)" }}>Loading GST and profit&hellip;</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: "16px 20px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>GST</h2>
            {gst ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <MetricCard title="Taxable" value={inr(gst.totals?.taxable ?? 0)} />
                  <MetricCard title="CGST" value={inr(gst.totals?.cgst ?? 0)} />
                  <MetricCard title="SGST" value={inr(gst.totals?.sgst ?? 0)} />
                  <MetricCard title="IGST" value={inr(gst.totals?.igst ?? 0)} />
                </div>
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: "12px 0 0" }}>
                  {gst.orders ?? 0} orders &middot; {gst.invalid ?? 0} invalid
                </p>
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                  GST treatment must be reviewed by the CA before filing.
                </p>
                {(gst.rows ?? []).some((r) =>
                  (r.warnings ?? []).some((w) => w === "IGST_UNVERIFIED" || w === "JURISDICTION_UNKNOWN"),
                ) && (
                  <p style={{ margin: "8px 0 0", display: "flex", gap: "8px", alignItems: "center" }}>
                    <SeverityBadge severity="HIGH" />
                    <span style={{ fontSize: "12px" }}>IGST-UNVERIFIED: intra-state split assumed, CA review required.</span>
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>No GST data for this period.</p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: "16px 20px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>Profit</h2>
            {profit ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <MetricCard title="Gross profit" value={inr(profit.profit?.gross_profit ?? 0)} />
                  <MetricCard title="Operating profit" value={inr(profit.profit?.operating_profit ?? 0)} subtitle={profit.profit?.label ?? ""} />
                  <MetricCard title="Margin" value={`${profit.profit?.margin_pct ?? "0.00"}%`} />
                  <MetricCard title="Net sales" value={inr(profit.revenue?.net_exclusive ?? 0)} />
                </div>
                {profit.profit?.warning ? (
                  <p style={{ margin: "8px 0 0", display: "flex", gap: "8px", alignItems: "center" }}>
                    <SeverityBadge severity="MEDIUM" />
                    <span style={{ fontSize: "12px" }}>{profit.profit.warning}</span>
                  </p>
                ) : null}
              </>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>No profit data for this period.</p>
            )}
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading report...</div>
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {data.orders?.total === 0 ? (
            <EmptyState
              title={`No orders in ${month}`}
              body="Sync Shopify or import a CSV, then come back."
              primary={{ label: "Sync orders", href: "/orders" }}
              secondary={{ label: "Import CSV", href: "/import" }}
            />
          ) : (
            <>
              <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5"><h2>Orders</h2><pre>{JSON.stringify(data.orders, null, 2)}</pre></div>
              <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5"><h2>Money</h2><pre>{JSON.stringify(data.money, null, 2)}</pre></div>
              <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5"><h2>Profitability ({data.profitability.label})</h2><pre>{JSON.stringify(data.profitability, null, 2)}</pre></div>
              <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5"><h2>Exceptions</h2><pre>{JSON.stringify(data.exceptions, null, 2)}</pre></div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
