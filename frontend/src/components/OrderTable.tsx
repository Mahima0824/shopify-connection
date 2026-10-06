import React from "react";
import { Link } from "react-router-dom";
import { isAwaiting, pushStateLabel, statusTone, type OrderShipment } from "../lib/shipments";

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

const PILL_CLASSES: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

function ShipmentPill({ status }: { status: string }) {
  const cls = PILL_CLASSES[statusTone(status)] ?? PILL_CLASSES.neutral;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

// AWAITING_TRACKING is deliberately NOT in shipments.TERMINAL_STATUSES: it is
// the one state that asks the user for the missing tracking number, so it has to
// stay visible here as a green Add Shipment button rather than be filtered out
// as a finished shipment.
function ShipmentCell({ shipment, onAdd }: {
  shipment: OrderShipment | null | undefined;
  onAdd: () => void;
}) {
  if (!shipment) {
    return <span className="text-xs text-slate-400">{pushStateLabel("none")}</span>;
  }

  if (isAwaiting(shipment)) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={onAdd}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition cursor-pointer"
        >
          Add Shipment
        </button>
        <span className="text-[11px] text-amber-700">{pushStateLabel("awaiting")}</span>
      </div>
    );
  }

  if (shipment.push_state === "rejected") {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="font-mono text-xs text-slate-900">{shipment.awb_number}</span>
        <span className="text-[11px] text-red-700">{pushStateLabel("rejected")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {shipment.id ? (
        <Link
          to={`/shipments/${shipment.id}`}
          className="font-mono text-xs font-semibold text-emerald-800 hover:underline"
        >
          {shipment.awb_number}
        </Link>
      ) : (
        <span className="font-mono text-xs text-slate-900">{shipment.awb_number}</span>
      )}
      <ShipmentPill status={shipment.tracking_status ?? ""} />
      {shipment.current_location && (
        <span className="text-[11px] text-slate-500">{shipment.current_location}</span>
      )}
    </div>
  );
}

export default function OrderTable({
  orders,
  onAddShipment,
}: {
  orders: any[];
  onAddShipment: (order: any) => void;
}) {
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
            <th>Shipment</th>
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
                <ShipmentCell shipment={o.shipment} onAdd={() => onAddShipment(o)} />
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
