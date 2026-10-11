import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getShipmentHistory, ShipmentHistory as History } from "../lib/api";
import { statusTone, Tone } from "../lib/shipments";
import { Button, buttonVariants, Card, Badge } from "../components/primitives";
import {
  IconTruck,
  IconMapPin,
  IconClock,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconAlert,
  IconBox,
} from "../components/icons";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

const DOT_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500 ring-emerald-500/20",
  info: "bg-sky-500 ring-sky-500/20",
  warning: "bg-amber-500 ring-amber-500/20",
  danger: "bg-red-500 ring-red-500/20",
  neutral: "bg-muted-foreground ring-muted/30",
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
  const [copied, setCopied] = useState(false);

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

  const handleCopyAWB = () => {
    if (!data?.awb) return;
    navigator.clipboard.writeText(data.awb);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tone = statusTone(data?.status);
  const latestEvent = data?.events?.[0];

  return (
    <div className="page-shell py-6 flex flex-col gap-6 bg-background min-h-screen">
      {/* Top Breadcrumb */}
      <div>
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors bg-primary/5 hover:bg-primary/10 border border-primary/15 px-3 py-1.5 rounded-full"
        >
          <span>&larr;</span>
          <span>Back to Orders</span>
        </Link>
      </div>

      {/* Main Header Hero Card */}
      <Card className="p-6 sm:p-8 shadow-md border-border/80 bg-card rounded-2xl relative overflow-hidden">
        {/* Subtle Ambient Background Glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-primary/5 blur-3xl" aria-hidden="true" />

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground border border-border">
                <IconTruck size={12} />
                {data?.courier_code || "Carrier"}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-medium font-heading text-foreground tracking-tight">
              Tracking History
            </h1>

            <div className="text-xs sm:text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              {data ? (
                <>
                  <span className="font-mono font-semibold text-foreground">{data.awb}</span>
                  <button
                    type="button"
                    onClick={handleCopyAWB}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors bg-muted/60 hover:bg-muted border border-border/80 px-2 py-0.5 rounded-md cursor-pointer"
                    title="Copy AWB Number"
                  >
                    {copied ? <IconCheck size={12} className="text-emerald-500" /> : <IconCopy size={12} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                  <span>· {data.courier_code}</span>
                </>
              ) : (
                <span>Loading…</span>
              )}
            </div>
          </div>

          {/* Action Buttons & Status Badge */}
          <div className="flex flex-wrap items-center gap-3">
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
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "gap-1.5 text-primary border-primary/30 hover:bg-primary/5 font-semibold text-xs h-9 shadow-xs"
                )}
              >
                <span>Track on courier site</span>
                <IconExternalLink size={13} />
              </a>
            )}
            <Button
              type="button"
              onClick={() => load()}
              size="sm"
              className="gap-1.5 h-9 font-semibold text-xs shadow-xs"
            >
              <IconRefresh size={13} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI Metrics Strip */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-4 border-border/70 bg-card rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Courier Partner</span>
            <span className="text-sm font-bold font-heading text-foreground mt-1 truncate">{data.courier_code || "Standard"}</span>
          </Card>

          <Card className="p-4 border-border/70 bg-card rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tracking Reference</span>
            <span className="text-xs font-mono font-semibold text-foreground mt-1 truncate">#{data.awb}</span>
          </Card>

          <Card className="p-4 border-border/70 bg-card rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Checkpoints</span>
            <span className="text-sm font-bold font-heading text-foreground mt-1">
              {data.events?.length ?? 0} Scans
            </span>
          </Card>

          <Card className="p-4 border-border/70 bg-card rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tracking Mode</span>
            <span className="text-sm font-bold font-heading text-foreground mt-1 capitalize">{tone}</span>
          </Card>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm font-medium rounded-xl px-4 py-3 flex items-center gap-2.5">
          <IconAlert size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Events Timeline Card */}
      <Card className="p-6 sm:p-8 shadow-md border-border/80 bg-card rounded-2xl flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-border/70 pb-4">
          <h2 className="text-lg font-medium font-heading text-foreground flex items-center gap-2">
            <IconBox size={18} className="text-primary" />
            <span>Checkpoint Timeline</span>
          </h2>
          {data?.events && data.events.length > 0 && (
            <Badge variant="secondary" className="text-xs font-semibold">
              {data.events.length} Events
            </Badge>
          )}
        </div>

        {!id ? (
          <div className="py-8 text-center flex flex-col items-center gap-2">
            <IconBox size={32} className="text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">
              No shipment was selected. Open tracking history from an order row.
            </p>
          </div>
        ) : loading && !data ? (
          <div className="py-8 text-center flex flex-col items-center gap-3">
            <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Loading tracking history…</p>
          </div>
        ) : (data?.events ?? []).length === 0 ? (
          <div className="py-8 text-center flex flex-col items-center gap-2">
            <IconBox size={32} className="text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">No scans yet for this tracking number.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-5 relative border-l-2 border-border/80 ml-3 sm:ml-4 pl-5 sm:pl-6 my-2">
            {data!.events.map((e, i) => {
              const t = statusTone(e.normalized_status);
              const isLatest = i === 0;

              return (
                <li
                  key={`${e.action_date}-${e.action_time}-${i}`}
                  className="flex flex-col gap-1 relative group"
                >
                  {/* Timeline Dot Node */}
                  <span
                    className={`absolute -left-[27px] sm:-left-[31px] top-2.5 size-3.5 rounded-full shrink-0 ring-4 ring-card ${DOT_CLASS[t]}`}
                    aria-hidden="true"
                  />

                  {/* Card for Event Content */}
                  <div
                    className={cn(
                      "flex flex-col gap-2 rounded-xl p-4 transition-all",
                      isLatest
                        ? "bg-primary/5 border border-primary/20 shadow-2xs"
                        : "bg-muted/30 border border-border/50 hover:bg-muted/60"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm sm:text-base font-semibold text-foreground font-heading">
                        {e.action_description}
                      </span>
                      {isLatest && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-primary text-primary-foreground shadow-2xs">
                          Latest Status
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {[e.action_date, e.action_time].some(Boolean) && (
                        <span className="inline-flex items-center gap-1 font-mono font-medium">
                          <IconClock size={13} className="text-muted-foreground/70" />
                          {[e.action_date, e.action_time].filter(Boolean).join(" · ")}
                        </span>
                      )}

                      {e.action_location && (
                        <span className="inline-flex items-center gap-1 font-medium bg-background px-2 py-0.5 rounded-md border border-border/70 text-foreground">
                          <IconMapPin size={12} className="text-primary" />
                          {e.action_location}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

