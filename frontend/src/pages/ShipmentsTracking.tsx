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

export default function TrackingPage() {
  const [ships, setShips] = useState<Ship[]>([]);
  const [out, setOut] = useState<OutRow[]>([]);
  const [q, setQ] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("");
  const [band, setBand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cool, setCool] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [dq, setDq] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({
      page_size: "100",
      ...(dq ? { q: dq } : {}),
      ...(status ? { status } : {}),
      ...(carrier ? { carrier } : {}),
    });
    api<{ items: Ship[] }>(`/api/v1/shipments?${qs}`, {}, token)
      .then((d) => setShips(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load shipments"));
    api<{ items: OutRow[] }>(`/api/v1/shipments/outstanding`, {}, token)
      .then((d) => setOut(d.items ?? []))
      .catch(() => {});
  }, [dq, status, carrier]);

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of out) if (r.order_name) m[r.shipment_id] = r.order_name;
    return m;
  }, [out]);

  const counts = useMemo(() => {
    const c = { critical: 0, warn: 0, ok: 0 };
    for (const s of ships) c[bandTone(s.tracking_status)] += 1;
    return c;
  }, [ships]);

  const carriers = useMemo(
    () => Array.from(new Set(ships.map((s) => s.carrier_code))).sort(),
    [ships]
  );

  const shown = useMemo(() => {
    // Search (q) + status + carrier are filtered server-side via
    // `?q=&status=&carrier=`; only the exception band (a client-side
    // bandTone mapping with no server equivalent) filters here.
    return ships.filter((s) => {
      if (band && bandTone(s.tracking_status) !== band) return false;
      return true;
    });
  }, [ships, band]);

  async function refresh(id: string) {
    const token = localStorage.getItem("token") ?? undefined;
    setSyncing((m) => ({ ...m, [id]: true }));
    setCool((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
    try {
      await api(`/api/v1/shipments/${id}/sync`, { method: "POST" }, token);
      const qs = new URLSearchParams({
        page_size: "100",
        ...(dq ? { q: dq } : {}),
        ...(status ? { status } : {}),
        ...(carrier ? { carrier } : {}),
      });
      const d = await api<{ items: Ship[] }>(`/api/v1/shipments?${qs}`, {}, token);
      setShips(d.items ?? []);
    } catch (e: any) {
      setCool((m) => ({ ...m, [id]: cooldownMessage(e) }));
    } finally {
      setSyncing((m) => ({ ...m, [id]: false }));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Tracking Command Center
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Pipeline
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live courier state, exception bands, and manual refresh with cooldown
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-t-4 border-t-destructive p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Critical</div>
          <div className="mt-1 text-3xl font-extrabold text-destructive">{counts.critical}</div>
        </Card>
        <Card className="border-t-4 border-t-warning p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Warning</div>
          <div className="mt-1 text-3xl font-extrabold text-warning">{counts.warn}</div>
        </Card>
        <Card className="border-t-4 border-t-success p-5 border-border/80 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On track</div>
          <div className="mt-1 text-3xl font-extrabold text-foreground">{counts.ok}</div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4 sm:p-5 border-border/80 shadow-xs">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search AWB, order, or barcode…"
          aria-label="Search shipments"
          className="flex-[2] min-w-[220px]"
        />
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          aria-label="Carrier"
        >
          <option value="">All carriers</option>
          {carriers.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "NDR_REATTEMPT", "DELIVERY_EXCEPTION", "RTO_INITIATED", "RTO_DELIVERED", "RETURNED", "LOST"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="min-h-11 flex-1 min-w-[140px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={band}
          onChange={(e) => setBand(e.target.value)}
          aria-label="Exception band"
        >
          <option value="">All bands</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">On track</option>
        </select>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {shown.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No shipments match — book one from dispatch or clear the filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AWB</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id} className={`transition-colors ${TONE_STYLE[bandTone(s.tracking_status)]}`}>
                    <TableCell>
                      <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                        {s.awb_number}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground font-medium">{names[s.id] ?? "—"}</TableCell>
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
                      {cool[s.id] && <div role="status" className="mt-1 text-xs text-warning font-medium">{cool[s.id]}</div>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refresh(s.id)}
                          disabled={!!syncing[s.id]}
                        >
                          {syncing[s.id] ? "Refreshing…" : "Refresh"}
                        </Button>
                        <Link to={`/shipments/${s.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Open
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
    </div>
  );
}
