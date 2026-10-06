import React, { useCallback, useEffect, useState } from "react";
import {
  canDrainRetries,
  drainShipsagarRetries,
  getShipsagarHealth,
  type RetryDrainResult,
  type ShipsagarHealth,
} from "../lib/api";
import { IconAlert } from "./icons";

/**
 * Admin-only ShipSagar recovery control.
 *
 * POST /api/v1/shipsagar/retry-drain had no frontend caller after the
 * standalone Shipments page went, so a queued registration could only be
 * flushed by calling the endpoint by hand. The push path schedules that job
 * precisely so a transient ShipSagar outage is recoverable
 * (shipments.py:338-343), so this keeps the recovery path usable.
 *
 * The health line is shown to every role because the counters are the only
 * signal that registrations are backing up; the drain button is ADMIN-only
 * because the endpoint itself is.
 */
export default function ShipsagarRetryDrain() {
  const [health, setHealth] = useState<ShipsagarHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [drainSummary, setDrainSummary] = useState<string | null>(null);
  const [drainError, setDrainError] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);

  const mayDrain = canDrainRetries();

  const loadHealth = useCallback(() => {
    getShipsagarHealth()
      .then((h) => {
        setHealth(h);
        setHealthError(null);
      })
      .catch((err: unknown) => {
        setHealthError(
          err instanceof Error ? err.message : "Failed to load ShipSagar health",
        );
      });
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const drain = () => {
    if (!window.confirm("Drain the ShipSagar retry queue now?")) return;
    setDraining(true);
    setDrainError(null);
    drainShipsagarRetries()
      .then((r: RetryDrainResult) => {
        // The backend omits `checked` on some paths, so derive it from the
        // three outcomes rather than printing "undefined checked".
        const succeeded = r.succeeded ?? 0;
        const requeued = r.requeued ?? 0;
        const dead = r.dead_lettered ?? 0;
        const checked = r.checked ?? succeeded + requeued + dead;
        setDrainSummary(
          `Retry drain complete: ${succeeded} drained, ${requeued} requeued, ` +
          `${dead} dead-lettered (${checked} checked)`,
        );
        loadHealth();
      })
      .catch((err: unknown) => {
        setDrainError(
          err instanceof Error ? err.message : "Retry drain failed",
        );
      })
      .finally(() => setDraining(false));
  };

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col gap-2"
      data-testid="shipsagar-retry-drain"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">
          {health
            ? `ShipSagar health: ${health.failed_webhooks} failed webhooks · ` +
              `${health.pending_jobs} pending retries`
            : healthError
              ? "ShipSagar health unavailable."
              : "Loading ShipSagar health…"}
        </p>
        {mayDrain && (
          <button
            type="button"
            onClick={drain}
            disabled={draining}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 transition disabled:opacity-60"
          >
            {draining ? "Draining…" : "Retry drain"}
          </button>
        )}
      </div>
      {healthError && (
        <p className="text-xs text-slate-500 flex items-center gap-1">
          <IconAlert size={12} /> {healthError}
        </p>
      )}
      {drainSummary && (
        <p role="status" className="text-xs font-medium text-emerald-800">
          {drainSummary}
        </p>
      )}
      {drainError && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {drainError}
        </p>
      )}
    </div>
  );
}
