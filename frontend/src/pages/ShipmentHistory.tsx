import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getShipmentHistory, ShipmentHistory as History } from "../lib/api";
import { statusTone, Tone } from "../lib/shipments";
import ShipsagarRetryDrain from "../components/ShipsagarRetryDrain";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

/**
 * True for the backend's 429 REFRESH_COOLDOWN. `api()` puts the structured
 * `code` and `status` on the thrown Error; the message alone is not used so a
 * real outage whose text happens to mention cooldown is not swallowed.
 */
function isCooldown(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null;
  return e?.code === "REFRESH_COOLDOWN" || e?.status === 429;
}

const DOT_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
};

export default function ShipmentHistoryPage() {
  const { id } = useParams();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    getShipmentHistory(id)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        // A 429 REFRESH_COOLDOWN is the backend rate-limiting a poll, not a
        // failure the operator did anything about. Surfacing it every 60s would
        // train people to ignore the banner, so a silent poll swallows it and
        // leaves the already-rendered timeline alone. An explicit Refresh still
        // reports it, because then the user is waiting on an answer.
        if (silent && isCooldown(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load tracking history");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [load]);

  const tone = statusTone(data?.status);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <Link to="/orders" className="text-xs font-semibold text-emerald-700 hover:underline">
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tracking History</h1>
            <p className="text-sm text-slate-500 mt-1">
              {data ? (
                <>
                  <span>{data.awb}</span>
                  <span> · {data.courier_code}</span>
                </>
              ) : (
                <span>Loading…</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}>
                {data.status}
              </span>
            )}
            {/* The carrier's own page is the only place that shows the scans
                ShipSagar has not delivered yet: this timeline is built from the
                events already pulled, so it can lag a live parcel by a poll. */}
            {data?.tracking_url && (
              <a
                href={data.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg text-sm font-semibold text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 transition"
              >
                Track on courier site
              </a>
            )}
            <button type="button" onClick={() => load()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        {!id ? (
          <p className="text-sm text-slate-500">
            No shipment was selected. Open tracking history from an order row.
          </p>
        ) : loading ? (
          <p className="text-sm text-slate-500">Loading tracking history…</p>
        ) : (data?.events ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No scans yet for this tracking number.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {data!.events.map((e, i) => {
              const t = statusTone(e.normalized_status);
              return (
                <li key={`${e.action_date}-${e.action_time}-${i}`} className="flex gap-3">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT_CLASS[t]}`} aria-hidden="true" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-slate-900">{e.action_description}</span>
                    <span className="text-xs text-slate-500">
                      {[e.action_date, e.action_time].filter(Boolean).join(" · ")}
                    </span>
                    {e.action_location && (
                      <span className="text-xs text-slate-500">{e.action_location}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <ShipsagarRetryDrain />
    </div>
  );
}
