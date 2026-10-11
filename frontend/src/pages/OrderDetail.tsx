import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import Timeline, { TNode } from "../components/Timeline";
import { IconAlert, IconChevronLeft } from "../components/icons";
import {
  Badge,
  Button,
  Card,
} from "../components/primitives";

function getFinancialBadgeVariant(status?: string): "success" | "warning" | "destructive" | "secondary" {
  if (!status) return "secondary";
  const s = status.toUpperCase();
  if (s === "PAID") return "success";
  if (s === "PENDING" || s === "AUTHORIZED") return "warning";
  if (s === "REFUNDED" || s === "VOIDED") return "destructive";
  return "secondary";
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TNode[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api<any>(`/api/v1/orders/${id!}`)
      .then((data) => setOrder(data))
      .catch((err) => setError(err?.message ?? "Failed to load order"));
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: TNode[] }>(`/api/v1/orders/${id!}/timeline`, {}, token)
      .then((data) => setTimeline(data.items ?? []))
      .catch(() => setTimeline([]));
    api<{ items: any[] }>(`/api/v1/shipments?order_id=${id!}`, {}, token)
      .then((data) => setShipments(data.items ?? []))
      .catch(() => setShipments([]));
  }, [id]);

  async function handleDeleteOrder() {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete Order ${order?.shopify_order_name || order?.internal_order_number || id}? This action cannot be undone.`
    );
    if (!confirmDelete) return;

    setDeleting(true);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      await api(`/api/v1/orders/${id!}`, { method: "DELETE" }, token);
      navigate("/orders");
    } catch (err: any) {
      alert(err?.message ?? "Failed to delete order");
    } finally {
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <div className="page-shell flex flex-col gap-4 bg-background py-6">
        <Link to="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <IconChevronLeft size={14} /> Back to Orders Directory
        </Link>
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-sm text-destructive">
          <IconAlert size={16} /> {error}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page-shell bg-background py-12 text-center text-muted-foreground">
        Loading Order Details...
      </div>
    );
  }

  const finStatus = order.financial_status || "PENDING";

  return (
    <div className="page-shell flex flex-col gap-6 bg-background py-6">
      {/* Back Link & Header */}
      <div className="border-b border-border pb-6">
        <Link to="/orders" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <IconChevronLeft size={14} /> Back to Orders Directory
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-heading font-medium tracking-tight text-2xl sm:text-3xl text-foreground">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financial Status</div>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant={getFinancialBadgeVariant(finStatus)} className="text-xs font-bold uppercase tracking-wider">
              {finStatus}
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

      {/* Order Timeline Section */}
      <Card className="p-6 border-border/80 shadow-xs">
        <h2 className="mb-5 text-xl font-medium tracking-tight text-foreground font-heading">Order Lifecycle Timeline</h2>
        <Timeline items={timeline} />
      </Card>

      {/* Courier & Money Section */}
      {shipments.length > 0 && (
        <Card className="p-6 border-border/80 shadow-xs">
          <h2 className="mb-4 text-xl font-medium tracking-tight text-foreground font-heading">Courier &amp; Money</h2>
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

      {/* Delete Order Action Card */}
      <Card className="p-6 border-destructive/30 bg-destructive/5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-destructive font-heading">Delete Order</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permanently remove this order and all associated shipment records from the system.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDeleteOrder}
          disabled={deleting}
          className="font-semibold text-xs h-9 px-4 shadow-xs"
        >
          {deleting ? "Deleting Order..." : "Delete Order"}
        </Button>
      </Card>
    </div>
  );
}

