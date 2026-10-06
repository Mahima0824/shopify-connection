import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getShipmentHistory, ShipmentHistory as History } from "../lib/api";
import { statusTone, Tone } from "../lib/shipments";
import ShipsagarRetryDrain from "../components/ShipsagarRetryDrain";
import { Button, buttonVariants, Card, Badge } from "../components/primitives";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

const DOT_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground",
};

function isCooldown(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null;
  return e?.code === "REFRESH_COOLDOWN" || e?.status === 429;
}

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
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6 bg-background">
      {/* Header Card */}
      <Card className="p-6 sm:p-7 shadow-xs">
        <Link to="/orders" className="text-xs font-semibold text-primary hover:underline">
          &larr; Back to Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-3">
          <div>
            <h1 className="text-2xl font-bold font-heading text-foreground tracking-tight">Tracking History</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {data ? (
                <>
                  <span className="font-mono font-semibold text-foreground">{data.awb}</span>
                  <span> · {data.courier_code}</span>
                </>
              ) : (
                <span>Loading…</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className={`px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}>
                {data.status}
              </span>
            )}
            {data?.tracking_url && (
              <a
                href={data.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-primary border-primary/30 hover:bg-primary/5")}
              >
                Track on courier site
              </a>
            )}
            <Button
              type="button"
              onClick={() => load()}
              size="sm"
            >
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Events Timeline Card */}
      <Card className="p-6 sm:p-7 shadow-xs">
        {!id ? (
          <p className="text-sm text-muted-foreground">
            No shipment was selected. Open tracking history from an order row.
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading tracking history…</p>
        ) : (data?.events ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No scans yet for this tracking number.</p>
        ) : (
          <ol className="flex flex-col gap-5 relative before:absolute before:top-2 before:bottom-2 before:left-[4px] before:w-0.5 before:bg-border">
            {data!.events.map((e, i) => {
              const t = statusTone(e.normalized_status);
              return (
                <li key={`${e.action_date}-${e.action_time}-${i}`} className="flex gap-4 relative z-10">
                  <span className={`mt-1.5 size-2.5 rounded-full shrink-0 ring-4 ring-card ${DOT_CLASS[t]}`} aria-hidden="true" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{e.action_description}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.action_date, e.action_time].filter(Boolean).join(" · ")}
                    </span>
                    {e.action_location && (
                      <span className="text-xs text-muted-foreground/80 font-medium">{e.action_location}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <ShipsagarRetryDrain />
    </div>
  );
}
