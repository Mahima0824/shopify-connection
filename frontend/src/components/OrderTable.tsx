import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./primitives";

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

/* Payment states must not read as "bad", so they use Badge's secondary/outline
   variants rather than destructive; only a genuine failure earns destructive. */
function StatusBadge({ status, dotMap }: { status: string; dotMap: Record<string, string> }) {
  const dot = dotMap[status?.toUpperCase()] ?? "var(--muted-foreground)";
  return (
    <Badge variant="secondary">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {status}
    </Badge>
  );
}

export default function OrderTable({ orders }: { orders: any[] }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        No orders found. Click &quot;Sync Shopify Orders&quot; to import data.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order Name</TableHead>
            <TableHead>Financial Status</TableHead>
            <TableHead>Fulfillment / Op Status</TableHead>
            <TableHead>Total Amount</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="font-semibold">
                <Link to={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
              </TableCell>
              <TableCell>
                <StatusBadge status={o.operational_status || "NEW"} dotMap={OPERATIONAL_DOTS} />
              </TableCell>
              <TableCell className="font-semibold tabular-nums">
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                  ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleString()
                  : "-"}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/orders/${o.id}`}>View Timeline</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}