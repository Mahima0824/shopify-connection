import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import SeverityBadge from "../components/SeverityBadge";
import Timeline, { TNode } from "../components/Timeline";
import { IconAlert, IconSpark } from "../components/icons";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/primitives";

type ReconIssue = { code: string; severity: string; message: string };
type ReconState = { status: string; issues: ReconIssue[] } | null;

function getFinancialBadgeVariant(status?: string): "success" | "warning" | "destructive" | "secondary" {
  if (!status) return "secondary";
  const s = status.toUpperCase();
  if (s === "PAID") return "success";
  if (s === "PENDING" || s === "AUTHORIZED") return "warning";
  if (s === "REFUNDED" || s === "VOIDED") return "destructive";
  return "secondary";
}

function getOpBadgeVariant(status?: string): "success" | "warning" | "destructive" | "info" | "secondary" {
  if (!status) return "secondary";
  const s = status.toUpperCase();
  if (s === "DELIVERED" || s === "FULFILLED") return "success";
  if (s === "IN_TRANSIT" || s === "OUT_FOR_DELIVERY") return "info";
  if (s === "RTO" || s === "RETURNED" || s === "LOST") return "destructive";
  if (s === "NEW" || s === "PENDING") return "warning";
  return "secondary";
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TNode[]>([]);
  const [recon, setRecon] = useState<ReconState>(null);
  const [shipments, setShipments] = useState<any[]>([]);

  useEffect(() => {
    api<any>(`/api/v1/orders/${id!}`)
      .then((data) => setOrder(data))
      .catch((err) => setError(err?.message ?? "Failed to load order"));
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: TNode[] }>(`/api/v1/orders/${id!}/timeline`, {}, token)
      .then((data) => setTimeline(data.items ?? []))
      .catch(() => setTimeline([]));
    api<ReconState>(`/api/v1/reconciliation/order/${id!}`, { method: "POST" }, token)
      .then((data) => setRecon(data))
      .catch(() => setRecon(null));
    api<{ items: any[] }>(`/api/v1/shipments?order_id=${id!}`, {}, token)
      .then((data) => setShipments(data.items ?? []))
      .catch(() => setShipments([]));
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 bg-background px-6 py-6 max-[480px]:px-4">
        <Link to="/orders" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back to Orders Directory
        </Link>
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-sm text-destructive">
          <IconAlert size={16} /> {error}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-[1000px] bg-background px-6 py-12 text-center text-muted-foreground max-[480px]:px-4">
        Loading Order Details...
      </div>
    );
  }

  const finStatus = order.financial_status || "PENDING";
  const opStatus = order.operational_status || "NEW";

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 py-6 max-[480px]:px-4">
      {/* Back Link & Header */}
      <div className="border-b border-border pb-6">
        <Link to="/orders" className="mb-3 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Orders Directory
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
                Order {order.shopify_order_name || order.internal_order_number || order.id}
              </h1>
              <Badge variant="secondary" className="text-xs">
                {order.source_name || "Shopify"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Internal ID: <span className="font-mono text-foreground">{order.id}</span> · Created: {order.created_at ? new Date(order.created_at).toLocaleDateString() : "N/A"}
            </p>
          </div>
          <div className="text-right">
            <span className="tabular-nums text-3xl font-extrabold text-foreground">
              ₹{Number(order.total_amount || 0).toLocaleString()}
            </span>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{order.currency || "INR"} Net</p>
          </div>
        </div>
      </div>

      {/* Order Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financial Status</div>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant={getFinancialBadgeVariant(finStatus)} className="text-xs font-bold uppercase tracking-wider">
              {finStatus}
            </Badge>
          </div>
        </Card>
        <Card className="p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fulfillment / Op Status</div>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant={getOpBadgeVariant(opStatus)} className="text-xs font-bold uppercase tracking-wider">
              {opStatus}
            </Badge>
          </div>
        </Card>
        <Card className="p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment Details</div>
          <div className="mt-2 text-base font-bold text-foreground">
            {order.payment_gateway || "Standard Gateway"}
          </div>
          <p className="text-xs text-muted-foreground">Currency: {order.currency || "INR"}</p>
        </Card>
      </div>

      {/* Reconciliation Engine Alert Block */}
      {recon && (
        <Card className={`p-6 transition-colors ${recon.status === "RECONCILED" ? "border-emerald-500/40 bg-emerald-500/[0.03]" : "border-destructive/40 bg-destructive/[0.03]"}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold tracking-tight text-foreground">Reconciliation Engine Status</h2>
            <Badge variant={recon.status === "RECONCILED" ? "success" : "destructive"}>
              {recon.status}
            </Badge>
          </div>
          {recon.status === "RECONCILED" ? (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <IconSpark size={16} /> <span>Fully Reconciled — Operational state agrees across Shopify, physical scans, payments, and returns.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {(recon.issues ?? []).map((issue) => (
                <div key={issue.code} className="flex items-center gap-3 rounded-xl border border-border/80 bg-background/90 p-3 shadow-xs">
                  <SeverityBadge severity={issue.severity} />
                  <div>
                    <span className="font-semibold text-foreground text-sm">{issue.code}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">{issue.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Order Timeline Section */}
      <Card className="p-6 border-border/80 shadow-xs">
        <h2 className="mb-5 text-xl font-bold tracking-tight text-foreground font-heading">Order Lifecycle Timeline</h2>
        <Timeline items={timeline} />
      </Card>

      {/* Courier & Money Section */}
      {shipments.length > 0 && (
        <Card className="p-6 border-border/80 shadow-xs">
          <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground font-heading">Courier &amp; Money</h2>
          <div className="flex flex-col gap-3">
            {shipments.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 p-3.5 hover:bg-muted/30 transition-colors">
                <div>
                  <Link to={`/shipments/${s.id}`} className="font-bold text-foreground text-sm hover:underline">
                    {s.carrier_code} · {s.awb_number}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.current_location ? `${s.current_location} · ` : ""}
                    {s.last_checkpoint_at ? `Updated: ${new Date(s.last_checkpoint_at).toLocaleString()}` : "No checkpoints"}
                  </div>
                </div>
                <Badge variant={s.tracking_status === "DELIVERED" ? "success" : s.tracking_status === "IN_TRANSIT" ? "info" : "secondary"}>
                  {s.tracking_status || "UNKNOWN"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
