import React from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives";
import { API } from "../lib/api";
import { downloadXlsx } from "../lib/india-post";
import { isAwaiting, pushStateLabel, statusTone, type OrderShipment } from "../lib/shipments";

const FINANCIAL_DOTS: Record<string, string> = {
  PAID: "var(--destructive)",
  PENDING: "var(--secondary-foreground)",
  REFUNDED: "var(--muted-foreground)",
};

const OPERATIONAL_DOTS: Record<string, string> = {
  DISPATCHED: "var(--destructive)",
  PACKED: "var(--primary)",
  RETURN_RECEIVED: "var(--secondary-foreground)",
  RTO: "var(--muted-foreground)",
};

function StatusBadge({ status, dotMap }: { status: string; dotMap: Record<string, string> }) {
  const dot = dotMap[status?.toUpperCase()] ?? "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-muted/60 border border-border/80 text-foreground">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {status}
    </span>
  );
}

const PILL_CLASSES: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  neutral: "bg-muted text-muted-foreground border border-border",
};

function ShipmentPill({ status }: { status: string }) {
  const cls = PILL_CLASSES[statusTone(status)] ?? PILL_CLASSES.neutral;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function ShipmentCell({
  shipment,
  onAdd,
}: {
  shipment: OrderShipment | null | undefined;
  onAdd: () => void;
}) {
  if (!shipment) {
    return <span className="text-xs text-muted-foreground">{pushStateLabel("none")}</span>;
  }

  if (isAwaiting(shipment)) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
        >
          Add Shipment
        </Button>
        <span className="text-[11px] text-amber-600 font-medium">{pushStateLabel("awaiting")}</span>
      </div>
    );
  }

  if (shipment.push_state === "rejected") {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="font-mono text-xs text-foreground font-medium">{shipment.awb_number}</span>
        <span className="text-[11px] text-destructive font-medium">{pushStateLabel("rejected")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {shipment.id ? (
        <Link
          to={`/shipments/${shipment.id}`}
          className="font-mono text-xs font-semibold text-primary hover:underline"
        >
          {shipment.awb_number}
        </Link>
      ) : (
        <span className="font-mono text-xs text-foreground font-medium">{shipment.awb_number}</span>
      )}
      <ShipmentPill status={shipment.tracking_status ?? ""} />
      {shipment.current_location && (
        <span className="text-[11px] text-muted-foreground">{shipment.current_location}</span>
      )}
    </div>
  );
}

export default function OrderTable({
  orders,
  onAddShipment,
}: {
  orders: any[];
  onAddShipment?: (order: any) => void;
}) {
  if (!orders || orders.length === 0) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-12 text-center text-sm text-muted-foreground shadow-xs">
        No orders found. Click &quot;Sync Shopify Orders&quot; to import data.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order Name</TableHead>
          <TableHead>Shipment</TableHead>
          <TableHead>Financial Status</TableHead>
          <TableHead>Fulfillment / Op Status</TableHead>
          <TableHead className="text-right">Total Amount</TableHead>
          <TableHead>COD</TableHead>
          <TableHead>City / Pincode</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <Link
                to={`/orders/${o.id}`}
                className="font-mono text-xs font-semibold text-foreground hover:text-primary transition-colors bg-muted/40 hover:bg-muted/80 px-2 py-1 rounded-md border border-border/70 inline-block"
              >
                {o.shopify_order_name || o.internal_order_number || o.id}
              </Link>
            </TableCell>
            <TableCell>
              <ShipmentCell shipment={o.shipment} onAdd={() => onAddShipment?.(o)} />
            </TableCell>
            <TableCell>
              <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
            </TableCell>
            <TableCell>
              <StatusBadge status={o.operational_status || "NEW"} dotMap={OPERATIONAL_DOTS} />
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums text-foreground">
              ₹{Number(o.total_amount || 0).toLocaleString()}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground tabular-nums">
              {(!o.cod_mode && (o.cod_value === undefined || o.cod_value === null || o.cod_value === ""))
                ? "-"
                : `${o.cod_mode ?? ""}${o.cod_mode && o.cod_value !== undefined && o.cod_value !== null && o.cod_value !== "" ? " " : ""}${o.cod_value !== undefined && o.cod_value !== null && o.cod_value !== "" ? `₹${o.cod_value}` : ""}`}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {`${o.receiver_city ?? ""} ${o.receiver_pincode ?? ""}`.trim() || "-"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground font-mono">
              {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleString()
                : "-"}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="shadow-xs hover:border-primary/50 text-xs">
                  <Link to={`/orders/${o.id}`}>Timeline</Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shadow-xs hover:border-primary/50 text-xs"
                  onClick={() => downloadXlsx(`${API}/api/v1/orders/${o.id}/export/india-post.xlsx`, "india-post.xlsx")}
                >
                  XLSX
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}