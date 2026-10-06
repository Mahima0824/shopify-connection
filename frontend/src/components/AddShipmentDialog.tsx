import React, { useEffect, useState } from "react";
import {
  CourierOption,
  PushShipmentResult,
  getShipmentCouriers,
  pushShipment,
} from "../lib/api";
import { IconAlert, IconTruck } from "./icons";

export type AddShipmentDialogProps = {
  open: boolean;
  orderId: string | null;
  orderLabel?: string;
  onClose: () => void;
  onPushed: (result: PushShipmentResult) => void;
  /**
   * Called when the shipment was saved but ShipSagar could not be reached.
   *
   * The backend commits the AWB before it contacts ShipSagar, so a 502 leaves a
   * real shipment on the order that the retry queue will register later. Without
   * a refresh the Orders row keeps rendering Add Shipment (push_state is still
   * "awaiting") and retrying from there 400s SHIPMENT_EXISTS. This is the
   * refresh the deleted PushShipmentDialog used to do on the same path.
   */
  onRecovered?: () => void;
};

// Shown until the live catalogue loads, and kept for good if it never does:
// getShipmentCouriers resolves to [] on failure, and a push the user cannot
// make because a dropdown was empty is worse than a two-option guess.
const FALLBACK_COURIERS: CourierOption[] = [
  { courier_code: "IP", courier_name: "India Post" },
  { courier_code: "DTDC", courier_name: "DTDC" },
];

/**
 * True for the push route's queued-retry 502.
 *
 * `api()` puts the structured `status` on the thrown Error; the message text is
 * not matched, so a genuine outage whose wording happens to mention a retry is
 * not mistaken for one. A queued retry means the shipment was committed.
 */
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
  onClose,
  onPushed,
  onRecovered,
}: AddShipmentDialogProps) {
  const [couriers, setCouriers] = useState<CourierOption[]>(FALLBACK_COURIERS);
  const [trackingNo, setTrackingNo] = useState("");
  const [courier, setCourier] = useState("IP");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTrackingNo("");
    setCourier("IP");
    setError(null);
    setNotice(null);
    setSubmitError(null);
    setSubmitting(false);
    void getShipmentCouriers().then((rows) => {
      if (rows.length > 0) setCouriers(rows);
    });
  }, [open]);

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
    // A null orderId would post order_id: "" and earn a guaranteed 404/400 with
    // no idea which side was at fault. The Orders table only opens this dialog
    // for a real row, so reaching here means a caller passed nothing.
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
      // pushed: false is a 200, not a failure: the Shipment row was committed
      // either way and only the provider's registration was refused. So it
      // renders as a non-blocking notice and onPushed still fires, otherwise
      // the Orders table would not refresh and the new row would be invisible.
      if (!result.pushed) {
        setNotice(result.message || "ShipSagar did not accept this shipment.");
      }
      onPushed(result);
    } catch (err: unknown) {
      // A 502 is the transport-failure path: the shipment IS saved and a retry
      // job is queued, so the caller refreshes rather than treating it as a
      // lost attempt. Anything else (a validation code, a duplicate) really did
      // fail and keeps the alert.
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

        <div className="p-6 overflow-y-auto flex-1">
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
                {couriers.map((c) => (
                  <option key={c.courier_code} value={c.courier_code}>
                    {c.courier_name} ({c.courier_code})
                  </option>
                ))}
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