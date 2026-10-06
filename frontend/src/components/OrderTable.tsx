import React from "react";
import { Link } from "react-router-dom";

const FINANCIAL_DOTS: Record<string, string> = {
  PAID: "var(--success)",
  PENDING: "var(--warning)",
  REFUNDED: "var(--error)",
};

const OPERATIONAL_DOTS: Record<string, string> = {
  DISPATCHED: "var(--success)",
  PACKED: "var(--primary)",
  RETURN_RECEIVED: "var(--warning)",
  RTO: "var(--error)",
};

function StatusBadge({ status, dotMap }: { status: string; dotMap: Record<string, string> }) {
  const dot = dotMap[status?.toUpperCase()] ?? "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-foreground">
      <span
        aria-hidden="true"
        style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, flexShrink: 0 }}
      />
      <span>{status}</span>
    </span>
  );
}

export default function OrderTable({ orders }: { orders: any[] }) {
  if (!orders || orders.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px", color: "var(--muted-foreground)" }}>
        No orders found. Click "Sync Shopify Orders" to import data.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", background: "#ffffff", border: "1px solid var(--border)", borderRadius: "12px" }}>
      <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted" style={{ border: "none" }}>
        <thead>
          <tr>
            <th>Order Name</th>
            <th>Financial Status</th>
            <th>Fulfillment / Op Status</th>
            <th>Total Amount</th>
            <th>Date</th>
            <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={{ fontWeight: 600, color: "var(--foreground)", borderBottom: "1px solid var(--border)" }}>
                <Link to={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </td>
              <td style={{ borderBottom: "1px solid var(--border)" }}>
                <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
              </td>
              <td style={{ borderBottom: "1px solid var(--border)" }}>
                <StatusBadge status={o.operational_status || "NEW"} dotMap={OPERATIONAL_DOTS} />
              </td>
              <td className="tabular-nums" style={{ fontWeight: 600, color: "var(--foreground)", borderBottom: "1px solid var(--border)" }}>
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </td>
              <td style={{ color: "var(--muted-foreground)", fontSize: "13px", borderBottom: "1px solid var(--border)" }}>
                {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                  ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleString()
                  : "-"}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>
                <Link to={`/orders/${o.id}`} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ whiteSpace: "nowrap" }}>
                  View Timeline
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
