import React, { useCallback, useEffect, useState } from "react";
import {
  listOrdersForPush,
  pushShipment,
  PushOrderOption,
  PushShipmentResult,
} from "../lib/api";
import { COURIER_OPTIONS, validatePush } from "../lib/shipments";
import { IconAlert, IconTruck } from "./icons";
import { Badge, Button } from "./primitives";

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
  "w-full min-h-11 px-3.5 py-2.5 bg-background border border-input rounded-md text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5";

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
        className="text-xs font-medium text-destructive flex items-center gap-1 mt-1"
        role="alert"
      >
        <IconAlert size={12} /> {errors[key]}
      </span>
    ) : null;

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Push Shipment"
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-card text-card-foreground rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border">
        <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <IconTruck size={20} /> Push Shipment
              <Badge variant="secondary" className="bg-accent text-accent-foreground font-semibold">
                ShipSagar
              </Badge>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Register a tracking number with ShipSagar and start live tracking
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full w-8 h-8 flex items-center justify-center transition"
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
                className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg px-4 py-3"
              >
                {submitError}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className={
                  retrying
                    ? "bg-primary/10 border border-primary/20 text-foreground text-sm rounded-lg px-4 py-3"
                    : "bg-warning/10 border border-warning/20 text-foreground text-sm rounded-lg px-4 py-3"
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
                    {o.internal_order_number ?? o.order_no ?? o.shopify_order_name ?? o.id} — {o.customer_name ?? "No name"} (
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
              <p className="text-xs text-muted-foreground mt-1">
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
              <p className="text-xs text-muted-foreground mt-1">
                ShipSagar courier code from the client profile page.
              </p>
            </div>

            <div className="border border-border rounded-xl p-4 bg-muted/30 flex flex-col gap-3">
              <p className="text-sm font-bold text-foreground">Payload preview</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-foreground">
                  {order?.customer_name || "—"}
                  {order?.receiver_city ? ` · ${order.receiver_city}` : ""}
                </dd>
                <dt className="text-muted-foreground">Company Name</dt>
                <dd className="text-foreground">—</dd>
                <dt className="text-muted-foreground">Country</dt>
                <dd className="text-foreground">India</dd>
                <dt className="text-muted-foreground">Shipment Type</dt>
                <dd className="text-foreground">Road</dd>
              </dl>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-border bg-muted/40 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="push-shipment-form"
            disabled={submitting}
          >
            {submitting ? "Pushing…" : "Push shipment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
