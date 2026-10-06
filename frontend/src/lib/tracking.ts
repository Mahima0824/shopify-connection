export function bandTone(status: string): "ok" | "warn" | "critical" {
  if (["NDR", "LOST", "DAMAGED", "RTO_DELAY"].includes(status)) return "critical";
  if (["WAREHOUSE_DELAY", "TRACKING_STALE", "DELIVERY_EXCEPTION", "RTO_INITIATED"].includes(status)) return "warn";
  return "ok";
}

// api() in lib/api.ts throws plain Errors shaped from
// data.detail || data.error.message, so the structured `retry_after`
// from 429 REFRESH_COOLDOWN bodies arrives embedded in the message text
// ("Refresh cooldown: retry after Ns"). Parse it back out.
export function cooldownSeconds(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/retry after (\d+)s/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function cooldownMessage(err: unknown, fallback = "Refresh failed"): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const secs = cooldownSeconds(err);
  if (secs !== null) return `Refresh cooldown — retry after ${secs}s.`;
  return msg || fallback;
}
