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
} from "../components/icons";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadSummary = (silent = false) => {
    if (!silent) setLoading(true);
    api<any>("/api/v1/dashboard/summary")
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false); });
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
      setData(summary);
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

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 bg-background px-6 max-[480px]:px-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-foreground text-2xl sm:text-3xl">Executive Dashboard</h1>
            <Badge variant="secondary" className="text-xs">Live Sync</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time Operational Ledger &amp; Financial Reconciliation Metrics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link to="/orders" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Orders Directory
          </Link>
          <Link to="/scan" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Scan Hub
          </Link>
          <Button onClick={handleExcelExport} disabled={exporting} size="sm" className="shadow-xs">
            <IconReceipt size={15} data-icon="inline-start" />
            {exporting ? "Generating Export..." : "Download Excel Workbook"}
          </Button>
        </div>
      </div>

      {/* Operational KPI Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading font-bold tracking-tight text-lg text-foreground">Operational Health</h2>
            <p className="text-xs text-muted-foreground">Parcel fulfillment and station scan throughput</p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            Audit Level: Active
          </Badge>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5">
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