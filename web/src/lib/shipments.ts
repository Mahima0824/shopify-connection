// web/src/lib/shipments.ts — shipment page helpers (pure, unit-tested).

export const SHIPMENT_STATUSES = [
  "NOT_CREATED",
  "READY_TO_SHIP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RTO",
  "RETURNED",
  "LOST",
  "EXCEPTION",
] as const;

export const TERMINAL_STATUSES = ["DELIVERED", "RETURNED", "RTO", "LOST"] as const;

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
  RETURNED: "danger",
  LOST: "danger",
  NOT_CREATED: "neutral",
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

export function isPushable(
  order: { shipment_id?: string | null } | null | undefined,
): boolean {
  if (!order) return false;
  return !order.shipment_id;
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
