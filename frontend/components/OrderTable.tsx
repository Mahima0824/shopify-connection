import React from "react";
import Link from "next/link";

export default function OrderTable({ orders }: { orders: any[] }) {
  if (!orders || orders.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
        No orders found. Click "Sync Shopify Orders" to import data.
      </div>
    );
  }

  const getFinancialBadgeClass = (status: string) => {
    switch (status?.toUpperCase()) {
      case "PAID": return "badge-success";
      case "PENDING": return "badge-warning";
      case "REFUNDED": return "badge-danger";
      default: return "badge-neutral";
    }
  };

  const getOperationalBadgeClass = (status: string) => {
    switch (status?.toUpperCase()) {
      case "DISPATCHED": return "badge-success";
      case "PACKED": return "badge-info";
      case "RETURN_RECEIVED":
      case "RTO": return "badge-danger";
      default: return "badge-neutral";
    }
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="modern-table">
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
              <td style={{ fontWeight: 600, color: "#ffffff" }}>
                <Link href={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </td>
              <td>
                <span className={`badge ${getFinancialBadgeClass(o.financial_status)}`}>
                  {o.financial_status || "PENDING"}
                </span>
              </td>
              <td>
                <span className={`badge ${getOperationalBadgeClass(o.operational_status)}`}>
                  {o.operational_status || "NEW"}
                </span>
              </td>
              <td style={{ fontWeight: 600, color: "#f8fafc" }}>
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </td>
              <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                {o.created_at ? new Date(o.created_at).toLocaleDateString() : "-"}
              </td>
              <td style={{ textAlign: "right" }}>
                <Link href={`/orders/${o.id}`} className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}>
                  View Timeline →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
