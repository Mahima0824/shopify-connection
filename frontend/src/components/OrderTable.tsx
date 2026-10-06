import React from "react";
import { Link } from "react-router-dom";

const FINANCIAL_DOTS: Record<string, string> = {
  PAID: "var(--success)",
  PENDING: "var(--warning)",
  REFUNDED: "var(--error)",
};

const OPERATIONAL_DOTS: Record<string, string> = {
  DISPATCHED: "var(--success)",
  PACKED: "var(--accent)",
  RETURN_RECEIVED: "var(--warning)",
  RTO: "var(--error)",
};

function StatusBadge({ status, dotMap }: { status: string; dotMap: Record<string, string> }) {
  const dot = dotMap[status?.toUpperCase()] ?? "var(--muted)";
  return (
    <span className="badge-pill">
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
      <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
        No orders found. Click "Sync Shopify Orders" to import data.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", background: "#ffffff", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
      <table className="modern-table" style={{ border: "none" }}>
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
              <td style={{ fontWeight: 600, color: "var(--ink)", borderBottom: "1px solid var(--hairline)" }}>
                <Link to={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </td>
              <td style={{ borderBottom: "1px solid var(--hairline)" }}>
                <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
              </td>
              <td style={{ borderBottom: "1px solid var(--hairline)" }}>
                <StatusBadge status={o.operational_status || "NEW"} dotMap={OPERATIONAL_DOTS} />
              </td>
              <td className="tnum" style={{ fontWeight: 600, color: "var(--ink)", borderBottom: "1px solid var(--hairline)" }}>
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </td>
              <td style={{ color: "var(--muted)", fontSize: "13px", borderBottom: "1px solid var(--hairline)" }}>
                {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                  ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleString()
                  : "-"}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)" }}>
                <Link to={`/orders/${o.id}`} className="btn-secondary" style={{ whiteSpace: "nowrap" }}>
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
