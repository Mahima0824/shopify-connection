import React, { useCallback, useEffect, useState } from "react";
import {
  listOrdersForPush,
  pushShipment,
  PushOrderOption,
  PushShipmentResult,
} from "../lib/api";
import { COURIER_OPTIONS, validatePush } from "../lib/shipments";
import { IconAlert, IconTruck } from "./icons";

export type PushShipmentDialogProps = {
  open: boolean;
  defaultOrderId?: string | null;
  onClose: () => void;
  onPushed: (result: PushShipmentResult) => void;
  /**
   * Fired when the push committed the shipment server-side but could not be
   * confirmed: a 502. onPushed deliberately does not fire for that case, so
   * without this the shipment exists and is invisible until a manual reload,
   * and re-pushing the same order now returns SHIPMENT_EXISTS.
   */
  onRecovered?: () => void;
};

const FIELD_BY_CODE: Record<string, string> = {
  MISSING_TRACKING_NUMBER: "tracking_no",
  INVALID_TRACKING_NUMBER_LENGTH: "tracking_no",
  DUPLICATE_TRACKING: "tracking_no",
  MISSING_COURIER: "courier_code",
  ORDER_NOT_FOUND: "order_id",
  SHIPMENT_EXISTS: "order_id",
};

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

type ApiError = Error & { code?: string; status?: number };

export default function PushShipmentDialog({
  open,
  defaultOrderId,
  onClose,
  onPushed,
  onRecovered,
}: PushShipmentDialogProps) {
  const [orders, setOrders] = useState<PushOrderOption[]>([]);
  const [orderId, setOrderId] = useState(defaultOrderId ?? "");
  const [trackingNo, setTrackingNo] = useState("");
  const [courier, setCourier] = useState("IP");
  const [customCourier, setCustomCourier] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadOrders = useCallback(() => {
    return listOrdersForPush()
      .then((rows) => {
        // shipment_id is the backend's "already pushed" marker; the picker is
        // only offering orders that can still take a tracking number.
        const pushable = rows.filter((r) => !r.shipment_id);
        setOrders(pushable);
        setOrderId((cur) => cur || pushable[0]?.id || "");
      })
      .catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    setOrderId(defaultOrderId ?? "");
    setTrackingNo("");
    setCourier("IP");
    setCustomCourier("");
    setErrors({});
    setSubmitError(null);
    setNotice(null);
    setRetrying(false);
    setSubmitting(false);
    void loadOrders();
  }, [open, defaultOrderId, loadOrders]);

  if (!open) return null;

  const order = orders.find((o) => o.id === orderId) ?? null;
  const effectiveCourier = courier === "OTHER" ? customCourier.trim().toUpperCase() : courier;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitError(null);
    setRetrying(false);
    const found = validatePush({ tracking_no: trackingNo, courier_code: effectiveCourier });
    if (!orderId) found.order_id = "Choose an order.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const result = await pushShipment({
        order_id: orderId,
        tracking_no: trackingNo.trim(),
        courier_code: effectiveCourier,
      });
      setTrackingNo("");
      if (!result.pushed) {
        setNotice(result.message || "ShipSagar did not accept the shipment.");
      }
      onPushed(result);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      const code = apiErr?.code ?? "";
      const field = FIELD_BY_CODE[code];
      const message = apiErr instanceof Error && apiErr.message ? apiErr.message : "Failed to push shipment";
      if (field) {
        setErrors({ [field]: message });
      } else if (apiErr?.status === 502) {
        setRetrying(true);
        setNotice(message);
        // The shipment was committed before the 502, so the page must show it.
        onRecovered?.();
        void loadOrders();
      } else {
        setSubmitError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderError = (key: string) =>
    errors[key] ? (
      <span
        className="text-xs font-medium text-red-600 flex items-center gap-1 mt-1"
        role="alert"
      >
        <IconAlert size={12} /> {errors[key]}
      </span>
    ) : null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Push Shipment"
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <IconTruck size={20} /> Push Shipment
              <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                ShipSagar
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Register a tracking number with ShipSagar and start live tracking
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

        <div className="p-6 overflow-y-auto flex-1">
          <form
            id="push-shipment-form"
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
                className={
                  retrying
                    ? "bg-sky-50 border border-sky-200 text-sky-900 text-sm rounded-lg px-4 py-3"
                    : "bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3"
                }
              >
                {retrying && (
                  <span className="block font-semibold mb-1">
                    Shipment saved, but ShipSagar could not confirm the registration. A retry is
                    queued and will run automatically.
                  </span>
                )}
                {notice}
              </div>
            )}

            <div>
              <label htmlFor="push-order" className={labelClass}>
                Order
              </label>
              <select
                id="push-order"
                className={inputClass}
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Choose an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_no ?? o.id} — {o.customer_name ?? "No name"} (
                    {o.receiver_city ?? "—"}
                    {o.receiver_pincode ? ` ${o.receiver_pincode}` : ""})
                  </option>
                ))}
              </select>
              {renderError("order_id")}
            </div>

            <div>
              <label htmlFor="push-tracking" className={labelClass}>
                Tracking No
              </label>
              <input
                id="push-tracking"
                className={inputClass}
                placeholder="e.g. EG080960145IN"
                required
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
              {renderError("tracking_no")}
              <p className="text-xs text-slate-500 mt-1">
                Tracking number issued by the India Post worker. This becomes the parcel
                barcode and the AWB.
              </p>
            </div>

            <div>
              <label htmlFor="push-courier" className={labelClass}>
                Courier
              </label>
              <select
                id="push-courier"
                className={inputClass}
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              >
                {COURIER_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              {courier === "OTHER" && (
                <>
                  <label htmlFor="push-courier-custom" className="sr-only">
                    Custom courier code
                  </label>
                  <input
                    id="push-courier-custom"
                    className={`${inputClass} mt-2`}
                    placeholder="ShipSagar courier code"
                    value={customCourier}
                    onChange={(e) => setCustomCourier(e.target.value)}
                  />
                </>
              )}
              {renderError("courier_code")}
              <p className="text-xs text-slate-500 mt-1">
                ShipSagar courier code from the client profile page.
              </p>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col gap-3">
              <p className="text-sm font-bold text-slate-800">Payload preview</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-slate-500">Customer</dt>
                <dd className="text-slate-900">
                  {order?.customer_name || "—"}
                  {order?.receiver_city ? ` · ${order.receiver_city}` : ""}
                </dd>
                <dt className="text-slate-500">Company Name</dt>
                <dd className="text-slate-900">—</dd>
                <dt className="text-slate-500">Country</dt>
                <dd className="text-slate-900">India</dd>
                <dt className="text-slate-500">Shipment Type</dt>
                <dd className="text-slate-900">Road</dd>
              </dl>
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
            form="push-shipment-form"
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
