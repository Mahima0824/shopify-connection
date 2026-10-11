import React, { useEffect, useState } from "react";
import {
  CourierOption,
  OrderStockVerification,
  PushShipmentResult,
  checkOrderStock,
  getShipmentCouriers,
  pushShipment,
} from "../lib/api";
import { IconAlert, IconTruck } from "./icons";
import ProductAvatar from "./ProductAvatar";

export type AddShipmentDialogProps = {
  open: boolean;
  orderId: string | null;
  orderLabel?: string;
  order?: any;
  initialCourier?: string;
  onClose: () => void;
  onPushed: (result: PushShipmentResult) => void;
  onRecovered?: () => void;
};

// Shown until the live catalogue loads from ShipSagar:
const FALLBACK_COURIERS: CourierOption[] = [
  { courier_code: "IP", courier_name: "India Post Speed Post 🇮🇳" },
  { courier_code: "DELHIVERY", courier_name: "Delhivery Surface / Express 🔴" },
  { courier_code: "DTDC", courier_name: "DTDC Express & D2C 📦" },
  { courier_code: "BLUEDART", courier_name: "BlueDart Express Air ✈️" },
];

function isQueuedRetry(err: unknown): boolean {
  const e = err as { status?: number } | null;
  return e?.status === 502;
}

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

export default function AddShipmentDialog({
  open,
  orderId,
  orderLabel,
  order,
  initialCourier,
  onClose,
  onPushed,
  onRecovered,
}: AddShipmentDialogProps) {
  const defaultCode = (initialCourier === "INDIA_POST" ? "IP" : initialCourier) || "IP";
  const [couriers, setCouriers] = useState<CourierOption[]>(FALLBACK_COURIERS);
  const [trackingNo, setTrackingNo] = useState("");
  const [courier, setCourier] = useState(defaultCode);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stockInfo, setStockInfo] = useState<OrderStockVerification | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);

  useEffect(() => {
    if (!open) return;
    const selected = (initialCourier === "INDIA_POST" ? "IP" : initialCourier) || "IP";
    setTrackingNo("");
    setCourier(selected);
    setError(null);
    setNotice(null);
    setSubmitError(null);
    setSubmitting(false);
    setStockInfo(null);
    void getShipmentCouriers().then((rows) => {
      if (rows.length > 0) {
        const priorityCodes = ["IP", "DELHIVERY", "BLUEDART", "DTDC"];
        const priorityCouriers: CourierOption[] = [];
        const otherCouriers: CourierOption[] = [];
        rows.forEach((c) => {
          if (priorityCodes.includes(c.courier_code.toUpperCase())) {
            priorityCouriers.push(c);
          } else {
            otherCouriers.push(c);
          }
        });
        priorityCouriers.sort(
          (a, b) =>
            priorityCodes.indexOf(a.courier_code.toUpperCase()) -
            priorityCodes.indexOf(b.courier_code.toUpperCase())
        );
        setCouriers([...priorityCouriers, ...otherCouriers]);
      }
    });

    if (orderId) {
      setLoadingStock(true);
      void checkOrderStock(orderId)
        .then((res) => {
          if (res) setStockInfo(res);
        })
        .catch(() => {})
        .finally(() => setLoadingStock(false));
    }
  }, [open, orderId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitError(null);
    if (!trackingNo.trim()) {
      setError("Tracking number is required.");
      return;
    }
    if (!orderId) {
      setError("No order was selected, so the tracking number cannot be attached.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await pushShipment({
        order_id: orderId,
        tracking_no: trackingNo.trim(),
        courier_code: courier,
      });
      setTrackingNo("");
      if (!result.pushed) {
        setNotice(result.message || "ShipSagar did not accept this shipment.");
      }
      onPushed(result);
    } catch (err: unknown) {
      if (isQueuedRetry(err)) {
        setNotice(
          "The tracking number was saved, but ShipSagar could not be reached. " +
          "The registration is queued and will be retried automatically.",
        );
        setTrackingNo("");
        onRecovered?.();
      } else {
        setSubmitError(
          err instanceof Error && err.message ? err.message : "Failed to push shipment",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const customerName = order?.receiver_name || "Customer";
  const customerMobile = order?.receiver_mobile || "";
  const customerAddress = [
    order?.receiver_add1,
    order?.receiver_city,
    order?.receiver_state,
    order?.receiver_pincode,
  ].filter(Boolean).join(", ");
  const items = Array.isArray(order?.items) ? order.items : [];

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Shipment"
    >
      <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <IconTruck size={20} /> Add Shipment
              <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                ShipSagar
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {orderLabel
                ? `Order ${orderLabel} — register its tracking number with ShipSagar`
                : "Register a tracking number with ShipSagar"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-5 no-scrollbar">
          {/* Customer & Order Summary Box */}
          {order && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 flex flex-col gap-3">
              <div className="flex items-start justify-between border-b border-slate-200 pb-2">
                <div>
                  <span className="font-bold text-slate-900 text-sm block">{customerName}</span>
                  {customerMobile && <span className="text-slate-500 font-mono">📱 {customerMobile}</span>}
                  {customerAddress && <p className="text-slate-600 mt-0.5">📍 {customerAddress}</p>}
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-slate-900 text-sm block">₹{Number(order.total_amount || 0).toLocaleString()}</span>
                  <span className="inline-block bg-slate-200 text-slate-800 font-semibold px-2 py-0.5 rounded text-[10px] mt-0.5">
                    {order.cod_mode || "PREPAID"}
                  </span>
                </div>
              </div>

              {/* Items & Product Photos & Stock count */}
              {items.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Ordered Items ({items.length})</span>
                  <div className="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1 no-scrollbar">
                    {items.map((it: any, idx: number) => (
                      <div key={it.id || idx} className="flex items-center gap-3 bg-white p-2 rounded-lg border border-slate-200">
                        <ProductAvatar imageUrl={it.image_url} title={it.title} className="size-10" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{it.title || "Product"}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            {it.sku ? `SKU: ${it.sku} · ` : ""}Qty: {it.quantity || 1}
                          </p>
                        </div>
                        <span className="font-mono font-medium text-slate-800 text-xs shrink-0">
                          ₹{Number(it.price || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}


          <form
            id="add-shipment-form"
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            {submitError && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3"
              >
                {submitError}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3"
              >
                <span className="block font-semibold mb-1">
                  The shipment was saved, but ShipSagar did not accept the tracking number.
                </span>
                {notice}
              </div>
            )}

            <div>
              <label htmlFor="add-tracking" className={labelClass}>
                Tracking No
              </label>
              <input
                id="add-tracking"
                className={inputClass}
                placeholder="e.g. EG080960145IN"
                required
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
              {error && (
                <span
                  className="text-xs font-medium text-red-600 flex items-center gap-1 mt-1"
                  role="alert"
                >
                  <IconAlert size={12} /> {error}
                </span>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Tracking number issued by the India Post worker. This becomes the parcel
                barcode and the AWB.
              </p>
            </div>

            <div>
              <label htmlFor="add-courier" className={labelClass}>
                Courier
              </label>
              <select
                id="add-courier"
                className={inputClass}
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              >
                {couriers.map((c) => {
                  const nameUpper = c.courier_name.toUpperCase();
                  const codeUpper = c.courier_code.toUpperCase();
                  const hasCode = nameUpper.includes(`(${codeUpper})`);
                  const label = hasCode ? c.courier_name : `${c.courier_name} (${c.courier_code})`;
                  return (
                    <option key={c.courier_code} value={c.courier_code}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Loaded from ShipSagar. Defaults to India Post.
              </p>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-shipment-form"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition disabled:opacity-60"
          >
            {submitting ? "Pushing…" : "Push shipment"}
          </button>
        </div>
      </div>
    </div>
  );
}