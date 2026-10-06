// web/src/lib/shipments.ts — shipment page helpers (pure, unit-tested).

// An order synced from Shopify with no tracking number yet. Deliberately listed
// AFTER NOT_CREATED: it is the one status that is terminal to the backend
// (shipment_service.TERMINAL — there is no tracking number to poll) but NOT to
// this page, because it is precisely the state that prompts the user for one.
// Do not add it to TERMINAL_STATUSES below; that would hide the rows the Orders
// table exists to surface. shipments-client.test.tsx pins the split.
export const AWAITING_TRACKING = "AWAITING_TRACKING";

export const SHIPMENT_STATUSES = [
  "NOT_CREATED",
  AWAITING_TRACKING,
  "READY_TO_SHIP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RTO",
  "RTO_DELIVERED",
  "RETURNED",
  "LOST",
  "CLOSED",
  "EXCEPTION",
] as const;

// Mirrors backend/app/services/shipment_service.py TERMINAL, which is the set
// the sync and poll-sweep endpoints stop on. The page and the backend used to
// disagree: RTO was terminal here but not there, so a ShipSagar RTO parcel
// stopped refreshing and could never progress to RETURNED, and RTO_DELIVERED /
// CLOSED were terminal there but not here. RTO is forward-progressible
// (RTO -> RETURNED), so it must not be terminal on either side.
export const TERMINAL_STATUSES = [
  "DELIVERED",
  "RETURNED",
  "LOST",
  "RTO_DELIVERED",
  "CLOSED",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const COURIER_OPTIONS = [
  { code: "IP", label: "IP — India Post" },
  { code: "DTDC", label: "DTDC" },
  { code: "FEDEX", label: "FEDEX" },
  { code: "OTHER", label: "Other (type below)…" },
] as const;

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const TONES: Record<string, Tone> = {
  DELIVERED: "success",
  READY_TO_SHIP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "info",
  FAILED_ATTEMPT: "warning",
  EXCEPTION: "warning",
  RTO: "danger",
  RTO_DELIVERED: "danger",
  RETURNED: "danger",
  LOST: "danger",
  CLOSED: "neutral",
  NOT_CREATED: "neutral",
  AWAITING_TRACKING: "info",
};

export function statusTone(status?: string | null): Tone {
  return TONES[(status ?? "").toUpperCase()] ?? "neutral";
}

export function carrierLabel(code?: string | null): string {
  return code?.trim() ? code.trim().toUpperCase() : "—";
}

export function formatEntryDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isTerminal(status?: string | null): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes((status ?? "").toUpperCase());
}

/**
 * Label for one row of the push dialog's order picker.
 *
 * Reads only fields GET /api/v1/orders genuinely returns (see
 * PushOrderOption). It previously read order_no / customer_name /
 * receiver_city / receiver_pincode, none of which the committed serializer
 * sends, so the label fell back to a raw order uuid and then appended the
 * literal "No name" to every row. internal_order_number is the real order
 * number and is what the shipments list already displays as order_no.
 */
export function pushOrderLabel(order: {
  id?: string | null;
  internal_order_number?: string | null;
  shopify_order_name?: string | null;
} | null | undefined): string {
  if (!order) return "—";
  const label = (order.internal_order_number ?? "").trim()
    || (order.shopify_order_name ?? "").trim();
  return label || order.id || "—";
}

export function formatOrderAmount(
  order: { total_amount?: number | null; currency?: string | null } | null | undefined,
): string {
  if (!order || order.total_amount == null) return "—";
  const amount = Number(order.total_amount);
  if (!Number.isFinite(amount)) return "—";
  return `${order.currency ? `${order.currency} ` : ""}${amount.toLocaleString()}`;
}

export function validatePush(form: {
  tracking_no: string;
  courier_code: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.tracking_no.trim()) errors.tracking_no = "Tracking number is required.";
  if (!form.courier_code.trim()) errors.courier_code = "Courier is required.";
  return errors;
}

export const PUSH_STATES = ["none", "awaiting", "pushed", "rejected"] as const;

export type PushState = (typeof PUSH_STATES)[number];

/** The shipment slice of an Order row, as GET /api/v1/orders returns it. */
export type OrderShipment = {
  id?: string | null;
  awb_number?: string | null;
  carrier_code?: string | null;
  tracking_status?: string | null;
  current_location?: string | null;
  last_checkpoint_at?: string | null;
  shipped_at?: string | null;
  push_state?: string | null;
};

/** True when the order has a shipment row that still needs a tracking number. */
export function isAwaiting(shipment: OrderShipment | null | undefined): boolean {
  return (shipment?.push_state ?? "") === "awaiting";
}

const PUSH_LABELS: Record<string, string> = {
  none: "No shipment",
  awaiting: "Awaiting tracking number",
  pushed: "Tracking",
  rejected: "Not accepted by ShipSagar",
};

/**
 * Label for an order row's shipment state. Anything unrecognised reads as "No
 * shipment" rather than blank, so a state added on the backend shows as wrong
 * but never as an empty cell.
 */
export function pushStateLabel(state?: string | null): string {
  return PUSH_LABELS[state ?? ""] ?? PUSH_LABELS.none;
}
