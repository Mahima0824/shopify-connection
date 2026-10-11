import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { bandTone, cooldownMessage } from "../lib/tracking";
import {
  Badge,
  Button,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "../components/primitives";
import { IconRefresh } from "../components/icons";
import SelectField from "../components/SelectField";

type Ship = {
  id: string;
  order_id: string;
  parcel_id: string;
  carrier_code: string;
  awb_number: string;
  tracking_status: string;
  current_location?: string | null;
  last_checkpoint_message?: string | null;
  last_checkpoint_at?: string | null;
  tracking_url?: string | null;
};

type OutRow = {
  shipment_id: string;
  order_name: string | null;
  carrier_code: string;
  awb_number: string;
  tracking_status: string;
  sla_status: string;
};

const TONE_STYLE: Record<string, string> = {
  critical: "border-l-4 border-l-destructive",
  warn: "border-l-4 border-l-warning",
  ok: "",
};

export default function GeneralTrackingPage() {
  const [ships, setShips] = useState<Ship[]>([]);
  const [out, setOut] = useState<OutRow[]>([]);
  const [q, setQ] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("");
  const [band, setBand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [cool, setCool] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [dq, setDq] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadShipments = React.useCallback((pageNum = 1, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    const token = localStorage.getItem("token") ?? undefined;
    const pageSize = 10;
    const qs = new URLSearchParams({
      page: String(pageNum),
      page_size: String(pageSize),
      ...(dq ? { q: dq } : {}),
      ...(status ? { status } : {}),
      ...(carrier ? { carrier } : {}),
    });

    api<{ items: Ship[]; total?: number }>(`/api/v1/shipments?${qs}`, {}, token)
      .then((d) => {
        const items = d.items ?? [];
        if (append) {
          setShips((prev) => [...prev, ...items]);
        } else {
          setShips(items);
        }
        setHasMore(items.length === pageSize);
        setError(null);

        // Auto-fetch location in background for newly loaded items that have AWBs but missing locations
        items.forEach((s) => {
          if (s.awb_number && !s.awb_number.startsWith("AWAITING") && !s.current_location) {
            autoFetchLocation(s.id, token);
          }
        });
      })
      .catch((e) => setError(e?.message ?? "Failed to load tracking data"))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });

    if (pageNum === 1) {
      api<{ items: OutRow[] }>(`/api/v1/shipments/outstanding`, {}, token)
        .then((d) => setOut(d.items ?? []))
        .catch(() => {});
    }
  }, [dq, status, carrier]);

  // Auto-sync shipment location in background if empty
  const autoFetchLocation = (id: string, token?: string) => {
    api<{ data?: { status?: string; events?: any[] } }>(`/api/v1/shipments/${id}/history`, {}, token)
      .then((res) => {
        const events = res.data?.events ?? [];
        const latestLoc = events.find((e: any) => e.action_location)?.action_location;
        if (latestLoc) {
          setShips((prev) =>
            prev.map((s) => (s.id === id ? { ...s, current_location: latestLoc } : s))
          );
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    setPage(1);
    loadShipments(1, false);
  }, [loadShipments]);

  const loadNextPage = () => {
    if (!hasMore || loadingMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadShipments(nextPage, true);
  };

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of out) if (r.order_name) m[r.shipment_id] = r.order_name;
    return m;
  }, [out]);

  const counts = useMemo(() => {
    const c = { critical: 0, warn: 0, ok: 0, total: ships.length };
    for (const s of ships) c[bandTone(s.tracking_status)] += 1;
    return c;
  }, [ships]);

  const carriers = useMemo(
    () => Array.from(new Set(ships.map((s) => s.carrier_code))).sort(),
    [ships]
  );

  const shown = useMemo(() => {
    return ships.filter((s) => {
      if (band && bandTone(s.tracking_status) !== band) return false;
      return true;
    });
  }, [ships, band]);

  async function refreshShipment(id: string) {
    const token = localStorage.getItem("token") ?? undefined;
    setSyncing((m) => ({ ...m, [id]: true }));
    setCool((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
    try {
      await api(`/api/v1/shipments/${id}/sync`, { method: "POST" }, token);
      // Re-fetch history to update location immediately
      const historyRes = await api<{ data?: { events?: any[] } }>(`/api/v1/shipments/${id}/history`, {}, token);
      const events = historyRes.data?.events ?? [];
      const latestLoc = events.find((e: any) => e.action_location)?.action_location;
      setShips((prev) =>
        prev.map((s) => (s.id === id ? { ...s, current_location: latestLoc || s.current_location } : s))
      );
    } catch (e: any) {
      setCool((m) => ({ ...m, [id]: cooldownMessage(e) }));
    } finally {
      setSyncing((m) => ({ ...m, [id]: false }));
    }
  }

  async function runSweep() {
    const token = localStorage.getItem("token") ?? undefined;
    setSweeping(true);
    setSweepResult(null);
    try {
      const res = await api<{ checked: number; synced: number; errors: number }>(
        `/api/v1/shipments/poll-sweep?limit=50`,
        { method: "POST" },
        token
      );
      setSweepResult(`Sweep complete: ${res.synced} updated, ${res.errors} errors out of ${res.checked} checked.`);
      loadShipments(1, false);
    } catch (e: any) {
      setSweepResult(`Sweep failed: ${e?.message || "Admin role required"}`);
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div className="page-shell flex flex-col gap-6 bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-medium tracking-tight text-2xl sm:text-3xl text-foreground">
              Order Tracking Center
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Telemetry
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time multi-carrier shipment status, India Post &amp; ShipSagar tracking events, and exception monitoring
          </p>
        </div>
        <Button onClick={runSweep} disabled={sweeping} variant="outline" className="gap-1.5 font-semibold text-xs">
          <IconRefresh size={13} className={sweeping ? "animate-spin" : ""} />
          <span>{sweeping ? "Running Sweep…" : "Run Global Tracking Sweep"}</span>
        </Button>
      </div>

      {sweepResult && (
        <Badge variant="secondary" className="px-4 py-2 text-sm font-medium self-start">
          {sweepResult}
        </Badge>
      )}

      {/* KPI Band */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-t-4 border-t-primary p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Tracked</div>
          <div className="mt-1 text-3xl font-extrabold text-foreground">{counts.total}</div>
        </Card>
        <Card className="border-t-4 border-t-destructive p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Critical / NDR</div>
          <div className="mt-1 text-3xl font-extrabold text-destructive">{counts.critical}</div>
        </Card>
        <Card className="border-t-4 border-t-warning p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delayed / Warning</div>
          <div className="mt-1 text-3xl font-extrabold text-warning">{counts.warn}</div>
        </Card>
        <Card className="border-t-4 border-t-success p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On Track</div>
          <div className="mt-1 text-3xl font-extrabold text-foreground">{counts.ok}</div>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <Card className="flex flex-wrap items-center gap-3 p-4 sm:p-5 border-border/80 shadow-xs">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by Order #, Courier AWB, or Barcode…"
          aria-label="Search order tracking"
          className="flex-[2] min-w-[240px]"
        />
        <SelectField
          tall
          ariaLabel="Carrier Filter"
          value={carrier}
          allLabel="All Carriers"
          onChange={(v) => {
            setCarrier(v);
            setPage(1);
          }}
          options={[
            { value: "SHIPSAGAR", label: "ShipSagar" },
            { value: "INDIA_POST", label: "India Post" },
            { value: "MANUAL", label: "Manual" },
            ...carriers
              .filter((c) => !["SHIPSAGAR", "INDIA_POST", "MANUAL"].includes(c))
              .map((c) => ({ value: c, label: c })),
          ]}
        />
        <SelectField
          tall
          ariaLabel="Status Filter"
          value={status}
          allLabel="All Statuses"
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            "BOOKED",
            "IN_TRANSIT",
            "AT_HUB",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
            "NDR_REATTEMPT",
            "DELIVERY_EXCEPTION",
            "RTO_INITIATED",
            "RTO_DELIVERED",
            "RETURNED",
            "LOST",
          ].map((s) => ({ value: s, label: s }))}
        />
        <SelectField
          tall
          ariaLabel="Band Filter"
          value={band}
          allLabel="All Bands"
          onChange={setBand}
          options={[
            { value: "critical", label: "Critical" },
            { value: "warn", label: "Warning" },
            { value: "ok", label: "On Track" },
          ]}
        />
      </Card>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Main Table */}
      <Card className="overflow-hidden p-0">
        {loading && ships.length === 0 ? (
          /* Skeleton Loader */
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>AWB / Consignment</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Location</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, idx) => (
                  <TableRow key={idx} className="animate-pulse">
                    <TableCell><div className="h-4 w-16 bg-muted/80 rounded" /></TableCell>
                    <TableCell><div className="h-4 w-28 bg-muted/80 rounded" /></TableCell>
                    <TableCell><div className="h-4 w-16 bg-muted/80 rounded" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-muted/80 rounded" /></TableCell>
                    <TableCell><div className="h-4 w-32 bg-muted/80 rounded" /></TableCell>
                    <TableCell><div className="h-7 w-24 bg-muted/80 rounded ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : shown.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No order tracking records found. Try searching for another Order # or AWB.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>AWB / Consignment</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Location</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow
                    key={s.id}
                    className={`transition-colors ${TONE_STYLE[bandTone(s.tracking_status)]}`}
                  >
                    <TableCell className="font-semibold text-foreground">
                      {names[s.id] || "Order"}
                    </TableCell>
                    <TableCell>
                      {/* A missing AWB previously rendered the styled span with
                          its border and padding but no text, which read as an
                          empty input box. Fall back to a muted dash. */}
                      {s.awb_number ? (
                        <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                          {s.awb_number}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px] font-semibold">{s.carrier_code}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          bandTone(s.tracking_status) === "critical"
                            ? "destructive"
                            : bandTone(s.tracking_status) === "warn"
                            ? "warning"
                            : "secondary"
                        }
                        className="text-xs font-semibold shadow-xs"
                      >
                        {s.tracking_status}
                      </Badge>
                      {cool[s.id] && (
                        <div role="status" className="mt-1 text-xs text-warning font-medium">
                          {cool[s.id]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground max-w-[200px] truncate">
                      {s.current_location || s.last_checkpoint_message || "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refreshShipment(s.id)}
                          disabled={!!syncing[s.id]}
                          className="h-8 text-xs font-semibold"
                        >
                          {syncing[s.id] ? "Syncing…" : "Sync"}
                        </Button>
                        <Link
                          to={`/shipments/${s.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Details
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Pagination / Load More */}
      {hasMore && !loading && (
        <div className="flex justify-center my-2">
          <Button
            variant="outline"
            onClick={loadNextPage}
            disabled={loadingMore}
            className="font-semibold text-xs h-9 px-6 shadow-xs"
          >
            {loadingMore ? "Loading more orders…" : "Load More Orders"}
          </Button>
        </div>
      )}
    </div>
  );
}
