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

type TrackingEvent = {
  id: string;
  normalized_status: string;
  message: string;
  location?: string | null;
  event_time?: string | null;
  source?: string;
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
  const [cool, setCool] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [dq, setDq] = useState(q);

  // Selected shipment timeline modal
  const [selectedShipment, setSelectedShipment] = useState<Ship | null>(null);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadShipments = React.useCallback(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({
      page_size: "100",
      ...(dq ? { q: dq } : {}),
      ...(status ? { status } : {}),
      ...(carrier ? { carrier } : {}),
    });
    api<{ items: Ship[] }>(`/api/v1/shipments?${qs}`, {}, token)
      .then((d) => setShips(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load tracking data"));
    api<{ items: OutRow[] }>(`/api/v1/shipments/outstanding`, {}, token)
      .then((d) => setOut(d.items ?? []))
      .catch(() => {});
  }, [dq, status, carrier]);

  useEffect(() => {
    loadShipments();
  }, [loadShipments]);

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
      loadShipments();
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
      loadShipments();
    } catch (e: any) {
      setSweepResult(`Sweep failed: ${e?.message || "Admin role required"}`);
    } finally {
      setSweeping(false);
    }
  }

  async function openTimeline(s: Ship) {
    setSelectedShipment(s);
    setLoadingEvents(true);
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const res = await api<{ items: TrackingEvent[] }>(
        `/api/v1/shipments/${s.id}/events`,
        {},
        token
      );
      setEvents(res.items ?? []);
    } catch (e) {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Order Tracking Center
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Telemetry
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time multi-carrier shipment status, India Post &amp; DTDC tracking events, and exception monitoring
          </p>
        </div>
        <Button onClick={runSweep} disabled={sweeping} variant="outline">
          {sweeping ? "Running Sweep…" : "Run Global Tracking Sweep"}
        </Button>
      </div>

      {sweepResult && (
        <Badge variant="secondary" className="px-4 py-2 text-sm font-medium self-start">
          {sweepResult}
        </Badge>
      )}

      {/* KPI Band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          aria-label="Carrier Filter"
        >
          <option value="">All Carriers</option>
          <option value="INDIA_POST">India Post</option>
          <option value="DTDC">DTDC</option>
          <option value="TIRUPATI">Tirupati</option>
          <option value="MANUAL">Manual</option>
          {carriers.map((c) => (
            !["INDIA_POST", "DTDC", "TIRUPATI", "MANUAL"].includes(c) && <option key={c}>{c}</option>
          ))}
        </select>
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status Filter"
        >
          <option value="">All Statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "NDR_REATTEMPT", "DELIVERY_EXCEPTION", "RTO_INITIATED", "RTO_DELIVERED", "RETURNED", "LOST"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={band}
          onChange={(e) => setBand(e.target.value)}
          aria-label="Band Filter"
        >
          <option value="">All Bands</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">On Track</option>
        </select>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Main Table */}
      <Card className="overflow-hidden p-0">
        {shown.length === 0 ? (
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
                    <TableCell className="font-mono font-semibold text-foreground">
                      {s.awb_number}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.carrier_code}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.tracking_status}</Badge>
                      {cool[s.id] && (
                        <div role="status" className="mt-1 text-xs text-warning">
                          {cool[s.id]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.current_location || s.last_checkpoint_message || "-"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refreshShipment(s.id)}
                          disabled={!!syncing[s.id]}
                        >
                          {syncing[s.id] ? "Syncing…" : "Sync"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openTimeline(s)}
                        >
                          Timeline
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

      {/* Timeline Modal */}
      {selectedShipment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4"
          onClick={() => setSelectedShipment(null)}
        >
          <Card
            className="w-full max-w-xl max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  Tracking Timeline: {selectedShipment.awb_number}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Carrier: {selectedShipment.carrier_code} | Status: {selectedShipment.tracking_status}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedShipment(null)}>
                Close
              </Button>
            </div>

            {loadingEvents ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading event history…</p>
            ) : events.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No checkpoints recorded yet for this consignment.</p>
            ) : (
              <div className="relative border-l-2 border-border pl-4 flex flex-col gap-4 mt-2">
                {events.map((ev, i) => (
                  <div key={ev.id || i} className="relative">
                    <div className="absolute -left-[23px] top-1 size-3 rounded-full bg-primary" />
                    <div className="text-sm font-semibold text-foreground">{ev.normalized_status}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{ev.message}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {ev.location ? `📍 ${ev.location} • ` : ""}{ev.event_time ? new Date(ev.event_time).toLocaleString() : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
