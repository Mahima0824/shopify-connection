import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import MetricCard from "../components/MetricCard";
import EmptyState from "../components/EmptyState";
import { Button } from "../components/primitives";
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
} from "../components/icons";

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
      <div className="mx-auto flex min-h-[400px] w-full max-w-[1280px] items-center justify-center bg-background px-6 max-[480px]:px-4">
        <p className="text-base text-muted-foreground">Loading Executive Dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
        <div>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">Executive Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time Operational Ledger &amp; Financial Reconciliation Metrics
          </p>
        </div>
        <EmptyState
          icon={<IconAlert size={24} />}
          title="Dashboard unavailable"
          body="Please sign in or sync Shopify orders to populate metrics."
          primary={{ label: "Sign in", href: "/login" }}
          secondary={{ label: "Sync orders", href: "/orders" }}
        />
      </div>
    );
  }

  const { kpis, financials } = data;

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 bg-background px-6 max-[480px]:px-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">Executive Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time Operational Ledger &amp; Financial Reconciliation Metrics
          </p>
        </div>
        <Button onClick={handleExcelExport} disabled={exporting}>
          <IconReceipt size={16} data-icon="inline-start" />
          {exporting ? "Generating Export..." : "Download Excel Workbook"}
        </Button>
      </div>

      {/* Operational KPI Grid */}
      <div>
        <h2 className="mb-4 font-bold tracking-tight text-lg text-foreground">Operational Health</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
          <MetricCard title="Total Orders" value={kpis.orders_total} icon={<IconBox />} subtitle={`${kpis.paid_orders} Paid`} />
          <MetricCard title="Dispatched Scans" value={kpis.dispatched_orders} icon={<IconTag />} subtitle={`${kpis.packed_orders} Packed`} />
          <MetricCard title="Returns / RTO" value={`${kpis.returns_total}`} icon={<IconReturn />} subtitle={`RTO Total: ${kpis.rto_total}`} />
          <MetricCard title="Open Exceptions" value={kpis.open_exceptions} icon={<IconAlert />} subtitle={`Reconciled: ${kpis.reconciled_rate}%`} />
        </div>
      </div>

      {/* Financial Breakdown Grid */}
      <div>
        <h2 className="mb-4 font-bold tracking-tight text-lg text-foreground">Financial Summary</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
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