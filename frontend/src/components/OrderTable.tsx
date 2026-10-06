import React from "react";
import { Link } from "react-router-dom";
import { API } from "../lib/api";
import { downloadXlsx } from "../lib/india-post";
import { isAwaiting, pushStateLabel, statusTone, type OrderShipment } from "../lib/shipments";

const FINANCIAL_CLASSES: Record<string, { bg: string; text: string; dot: string }> = {
  PAID: { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-600" },
  PENDING: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
  REFUNDED: { bg: "bg-red-50", text: "text-red-800", dot: "bg-red-600" },
};

const OPERATIONAL_CLASSES: Record<string, { bg: string; text: string; dot: string }> = {
  DISPATCHED: { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-600" },
  PACKED: { bg: "bg-teal-50", text: "text-teal-800", dot: "bg-teal-600" },
  RETURN_RECEIVED: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
  RTO: { bg: "bg-red-50", text: "text-red-800", dot: "bg-red-600" },
};

function StatusBadge({ status, styleMap }: { status: string; styleMap: Record<string, { bg: string; text: string; dot: string }> }) {
  const conf = styleMap[status?.toUpperCase()] ?? { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${conf.bg} ${conf.text}`}>
      <span className={`w-2 h-2 rounded-full ${conf.dot} shrink-0`} aria-hidden="true" />
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
      <div className="text-center py-10 text-slate-500 text-sm">
        No orders found. Click "Sync Shopify Orders" to import data.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-xs">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3.5">Order Name</th>
            <th className="px-4 py-3.5">Shipment</th>
            <th className="px-4 py-3.5">Financial Status</th>
            <th className="px-4 py-3.5">Fulfillment / Op Status</th>
            <th className="px-4 py-3.5">Total Amount</th>
            <th className="px-4 py-3.5">COD</th>
            <th className="px-4 py-3.5">City / Pincode</th>
            <th className="px-4 py-3.5">Date</th>
            <th className="px-4 py-3.5 text-right whitespace-nowrap">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
              <td className="px-4 py-3.5 font-semibold text-emerald-800 hover:underline">
                <Link to={`/orders/${o.id}`}>
                  {o.shopify_order_name || o.internal_order_number || o.id}
                </Link>
              </td>
              <td className="px-4 py-3.5">
                <ShipmentCell shipment={o.shipment} onAdd={() => onAddShipment(o)} />
              </td>
              <td className="px-4 py-3.5">
                <StatusBadge status={o.financial_status || "PENDING"} styleMap={FINANCIAL_CLASSES} />
              </td>
              <td className="px-4 py-3.5">
                <StatusBadge status={o.operational_status || "NEW"} styleMap={OPERATIONAL_CLASSES} />
              </td>
              <td className="px-4 py-3.5 font-bold tabular-nums text-slate-900">
                ₹{Number(o.total_amount || 0).toLocaleString()}
              </td>
              <td className="px-4 py-3.5 text-slate-600">
                {(!o.cod_mode && (o.cod_value === undefined || o.cod_value === null || o.cod_value === ""))
                  ? "-"
                  : `${o.cod_mode ?? ""}${o.cod_mode && o.cod_value !== undefined && o.cod_value !== null && o.cod_value !== "" ? " " : ""}${o.cod_value !== undefined && o.cod_value !== null && o.cod_value !== "" ? `₹${o.cod_value}` : ""}`}
              </td>
              <td className="px-4 py-3.5 text-slate-600">
                {`${o.receiver_city ?? ""} ${o.receiver_pincode ?? ""}`.trim() || "-"}
              </td>
              <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                  ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleString()
                  : "-"}
              </td>
              <td className="px-4 py-3.5 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    to={`/orders/${o.id}`}
                    className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-xs font-medium hover:bg-slate-50 transition"
                  >
                    Timeline
                  </Link>
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-xs font-medium hover:bg-slate-50 transition cursor-pointer"
                    onClick={() => downloadXlsx(`${API}/api/v1/orders/${o.id}/export/india-post.xlsx`, "india-post.xlsx")}
                  >
                    XLSX
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
