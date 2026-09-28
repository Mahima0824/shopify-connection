import React from "react";
import Link from "next/link";

const FINANCIAL_DOTS: Record<string, string> = {
  PAID: "var(--brand-mint)",
  PENDING: "var(--brand-ochre)",
  REFUNDED: "var(--brand-coral)",
};

const OPERATIONAL_DOTS: Record<string, string> = {
  DISPATCHED: "var(--brand-mint)",
  PACKED: "var(--brand-lavender)",
  RETURN_RECEIVED: "var(--brand-peach)",
  RTO: "var(--brand-coral)",
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
    <div style={{ overflowX: "auto", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
      <table className="modern-table" style={{ border: "none" }}>
        <thead>
          <tr>
            <th>Order Name</th>
            <th>Financial Status</th>
            <th>Fulfillment / Op Status</th>
            <th>Total Amount</th>
            <th>Date</th>
            <th style={{ textAlign: "right" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={{ fontWeight: 600, color: "var(--ink)", borderBottom: "1px solid var(--hairline)" }}>
                <Link href={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </td>
              <td style={{ borderBottom: "1px solid var(--hairline)" }}>
                <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
              </td>
              <td style={{ borderBottom: "1px solid var(--hairline)" }}>
                <StatusBadge status={o.operational_status || "NEW"} dotMap={OPERATIONAL_DOTS} />
              </td>
              <td style={{ fontWeight: 600, color: "var(--ink)", borderBottom: "1px solid var(--hairline)" }}>
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </td>
              <td style={{ color: "var(--muted)", fontSize: "13px", borderBottom: "1px solid var(--hairline)" }}>
                {o.created_at ? new Date(o.created_at).toLocaleDateString() : "-"}
              </td>
              <td style={{ textAlign: "right", borderBottom: "1px solid var(--hairline)" }}>
                <Link href={`/orders/${o.id}`} className="btn-secondary">
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
