"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import MetricCard from "../../components/MetricCard";
import NavPillGroup from "../../components/NavPillGroup";
import { APP_NAV_ITEMS } from "../../lib/app-nav";
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
} from "../../components/icons";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<any>("/api/v1/dashboard/summary")
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleExcelExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:8000/api/v1/export/excel", {
        headers: { Authorization: `Bearer ${token}` }
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
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px", background: "var(--canvas)" }}>
        <p style={{ color: "var(--muted)", fontSize: "16px" }}>Loading Executive Dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
        <NavPillGroup items={APP_NAV_ITEMS} active="/dashboard" />
        <div className="feature-card-peach">
          <h1 className="display" style={{ fontSize: "32px" }}>Executive Dashboard</h1>
          <p style={{ color: "var(--ink)", fontSize: "14px", marginTop: "4px" }}>
            Real-time Operational Ledger & Financial Reconciliation Metrics
          </p>
        </div>
        <div className="content-card" style={{ textAlign: "center", padding: "48px" }}>
          <h3 className="display" style={{ fontSize: "20px" }}>Dashboard Unavailable</h3>
          <p style={{ color: "var(--muted)", marginTop: "8px" }}>Please log in or sync Shopify orders to populate metrics.</p>
        </div>
      </div>
    );
  }

  const { kpis, financials } = data;

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "32px", background: "var(--canvas)" }}>

      <NavPillGroup items={APP_NAV_ITEMS} active="/dashboard" />

      {/* Peach signature band */}
      <div className="feature-card-peach" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "32px" }}>Executive Dashboard</h1>
          <p style={{ color: "var(--ink)", fontSize: "14px", marginTop: "4px" }}>
            Real-time Operational Ledger & Financial Reconciliation Metrics
          </p>
        </div>
        <button
          onClick={handleExcelExport}
          disabled={exporting}
          className="btn-primary"
        >
          <span style={{ display: "inline-flex", marginRight: "8px" }}><IconReceipt size={16} /></span>
          {exporting ? "Generating Export..." : "Download Excel Workbook"}
        </button>
      </div>

      {/* Operational KPI Grid */}
      <div>
        <h2 className="display" style={{ fontSize: "18px", marginBottom: "16px" }}>Operational Health</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
          <MetricCard title="Total Orders" value={kpis.orders_total} icon={<IconBox />} subtitle={`${kpis.paid_orders} Paid`} />
          <MetricCard title="Dispatched Scans" value={kpis.dispatched_orders} icon={<IconTag />} subtitle={`${kpis.packed_orders} Packed`} />
          <MetricCard title="Returns / RTO" value={`${kpis.returns_total}`} icon={<IconReturn />} subtitle={`RTO Total: ${kpis.rto_total}`} />
          <MetricCard title="Open Exceptions" value={kpis.open_exceptions} icon={<IconAlert />} subtitle={`Reconciled: ${kpis.reconciled_rate}%`} />
        </div>
      </div>

      {/* Financial Breakdown Grid */}
      <div>
        <h2 className="display" style={{ fontSize: "18px", marginBottom: "16px" }}>Financial Summary</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
          <MetricCard title="Gross Sales" value={`₹${financials.gross_sales.toLocaleString()}`} icon={<IconCoin />} />
          <MetricCard title="Total Tax" value={`₹${financials.total_tax.toLocaleString()}`} icon={<IconReceipt />} />
          <MetricCard title="Total Shipping" value={`₹${financials.total_shipping.toLocaleString()}`} icon={<IconTruck />} />
          <MetricCard title="Total Refunds" value={`₹${financials.total_refunds.toLocaleString()}`} icon={<IconRefund />} />
          <MetricCard title="Net Revenue" value={`₹${financials.net_revenue.toLocaleString()}`} icon={<IconSpark />} subtitle="Gross Sales minus Refunds" />
        </div>
      </div>

    </div>
  );
}
