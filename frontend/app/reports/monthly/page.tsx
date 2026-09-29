"use client";

import React, { useEffect, useState } from "react";
import { API } from "../../../lib/api";
import { api } from "../../../lib/api";
import EmptyState from "../../../components/EmptyState";

export default function MonthlyPage() {
  const [month, setMonth] = useState("2026-09");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Monthly report</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Operational + financial summary with profitability</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input type="month" value={month} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} aria-label="Month" className="input-control" />
          <button onClick={download} disabled={downloading || !data} className="btn-primary">
            {downloading ? "Exporting…" : "Download Excel"}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {error} <button onClick={() => load(month)} className="btn-secondary" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading report…</div>
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
              <div className="content-card"><h2>Orders</h2><pre>{JSON.stringify(data.orders, null, 2)}</pre></div>
              <div className="content-card"><h2>Money</h2><pre>{JSON.stringify(data.money, null, 2)}</pre></div>
              <div className="content-card"><h2>Profitability ({data.profitability.label})</h2><pre>{JSON.stringify(data.profitability, null, 2)}</pre></div>
              <div className="content-card"><h2>Exceptions</h2><pre>{JSON.stringify(data.exceptions, null, 2)}</pre></div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
