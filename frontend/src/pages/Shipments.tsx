import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  canDrainRetries,
  drainShipsagarRetries,
  getShipsagarHealth,
  listShipments,
  shipmentProvider,
  syncShipment,
} from "../lib/api";
import type { ShipmentListResult, ShipmentRow } from "../lib/api";
import {
  carrierLabel,
  formatEntryDate,
  isTerminal,
  SHIPMENT_STATUSES,
  statusTone,
} from "../lib/shipments";
import type { Tone } from "../lib/shipments";
import PushShipmentDialog from "../components/PushShipmentDialog";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "../components/primitives";
import { IconAlert, IconTruck } from "../components/icons";

const REFRESH_MS = 25000;
const PAGE_SIZE = 20;

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/15 text-foreground border border-success/30",
  info: "bg-primary/15 text-foreground border border-primary/30",
  warning: "bg-warning/15 text-foreground border border-warning/30",
  danger: "bg-destructive/15 text-destructive border border-destructive/30",
  neutral: "bg-muted text-muted-foreground border border-border",
};

const CHIP_ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground shadow-xs cursor-pointer";
const CHIP_IDLE =
  "px-3 py-1.5 rounded-full text-xs font-medium bg-card text-foreground border border-border hover:bg-muted transition cursor-pointer";

const inputClass =
  "w-full min-h-11 px-3.5 py-2.5 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5";
const pagerClass =
  "px-3 py-1.5 rounded-full text-xs font-semibold text-foreground bg-card border border-border hover:bg-muted transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed";

function providerBadge(s: ShipmentRow): string {
  const p = shipmentProvider(s);
  if (p === "SHIPSAGAR") return "ShipSagar";
  if (p === "MANUAL") return "MANUAL";
  return "direct";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {status}
    </span>
  );
}

export default function ShipmentsPage() {
  const [searchParams] = useSearchParams();
  // Spec section 6.1: the dialog defaults to the order the user navigated from.
  const deepLinkedOrderId = useMemo(
    () => searchParams.get("order_id")?.trim() || null,
    [searchParams],
  );
  const [data, setData] = useState<ShipmentListResult | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [carrier, setCarrier] = useState("");
  const [draft, setDraft] = useState({ q: "", orderNo: "" });
  const [applied, setApplied] = useState({ q: "", orderNo: "" });
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    failed_webhooks: number;
    pending_jobs: number;
    rejected_pushes?: number;
    configured: boolean;
  } | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);
  const [showPush, setShowPush] = useState(false);
  const reqRef = useRef(0);
  const cyclingRef = useRef(false);

  const fetchList = useCallback(
    (silent = false) => {
      const req = ++reqRef.current;
      if (!silent) setError(null);
      listShipments({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: status || undefined,
        carrier: carrier || undefined,
        q: applied.q || undefined,
        order_no: applied.orderNo || undefined,
        page,
        page_size: PAGE_SIZE,
      })
        .then((res) => {
          if (req === reqRef.current) {
            setData(res);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (req === reqRef.current) {
            const msg = err instanceof Error ? err.message : "Failed to load shipments";
            setError(msg);
          }
        });
    },
    [dateFrom, dateTo, status, carrier, applied, page],
  );

  const refreshHealth = useCallback(() => {
    getShipsagarHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Spec section 6.2: Auto-refresh interval (25s) polls non-terminal rows and
  // silently refreshes. Overlaps are prevented by cyclingRef guard.
  useEffect(() => {
    if (!live) return;
    const interval = window.setInterval(async () => {
      if (cyclingRef.current) return;
      cyclingRef.current = true;
      try {
        const rows = data?.items ?? [];
        const nonTerm = rows.filter((r) => !isTerminal(r.tracking_status));
        for (const r of nonTerm) {
          try {
            await syncShipment(r.id);
          } catch {
            // cooldown/errors absorbed silently on cycle
          }
        }
        fetchList(true);
      } finally {
        cyclingRef.current = false;
      }
    }, REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [live, data, fetchList]);

  const handleDrain = async () => {
    if (!window.confirm("Drain due ShipSagar retries now?")) return;
    setDraining(true);
    setDrainMsg(null);
    try {
      const out = await drainShipsagarRetries(50);
      const succeeded = out.succeeded ?? out.drained ?? 0;
      const requeued = out.requeued ?? out.remaining ?? 0;
      const dead = out.dead_lettered ?? out.moved_to_dead_letter ?? 0;
      const checked = out.checked ?? succeeded + requeued + dead;
      setDrainMsg(
        `Retry drain complete: ${succeeded} drained, ${requeued} requeued, ${dead} dead-lettered (${checked} checked)`,
      );
      refreshHealth();
      fetchList(true);
    } catch (err: unknown) {
      setDrainMsg(err instanceof Error ? err.message : "Retry drain failed");
    } finally {
      setDraining(false);
    }
  };

  const applyDraft = () => {
    setApplied({ ...draft });
    setPage(1);
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const facets = data?.facets ?? { carriers: [], statuses: [] };

  const pickCarrier = (code: string) => {
    setCarrier((c) => (c === code ? "" : code));
    setPage(1);
  };

  const pickStatus = (code: string) => {
    setStatus((s) => (s === code ? "" : code));
    setPage(1);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatus("");
    setCarrier("");
    setDraft({ q: "", orderNo: "" });
    setApplied({ q: "", orderNo: "" });
    setPage(1);
  };

  const filtersDirty = [
    dateFrom, dateTo, status, carrier,
    applied.q, applied.orderNo, draft.q, draft.orderNo,
  ].some(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6 max-[480px]:px-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Shipments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Push tracking numbers to ShipSagar and follow every parcel location live.
          </p>
        </div>
        <Link to="/shipments/outstanding" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Outstanding board
        </Link>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <Label htmlFor="f-date-from" className={labelClass}>Date From</Label>
            <Input id="f-date-from" aria-label="Date From" type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-date-to" className={labelClass}>Date To</Label>
            <Input id="f-date-to" aria-label="Date To" type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-tracking" className={labelClass}>Tracking No.</Label>
            <Input id="f-tracking" aria-label="Tracking No."
              placeholder="Enter Tracking No." value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") applyDraft(); }} />
          </div>
          <div>
            <Label htmlFor="f-order" className={labelClass}>Order No.</Label>
            <Input id="f-order" aria-label="Order No."
              placeholder="Enter Order No." value={draft.orderNo}
              onChange={(e) => setDraft((d) => ({ ...d, orderNo: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") applyDraft(); }} />
          </div>
          <div>
            <Label htmlFor="f-status" className={labelClass}>Status</Label>
            <select id="f-status" aria-label="Status" className={inputClass}
              value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="f-carrier" className={labelClass}>Courier</Label>
            <select id="f-carrier" aria-label="Courier" className={inputClass}
              value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              <option value="">All Carriers</option>
              {facets.carriers.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button type="button" onClick={applyDraft}>
            APPLY
          </Button>
          <Button type="button" variant="outline" onClick={clearFilters} disabled={!filtersDirty}>
            Clear filters
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground ml-auto cursor-pointer">
            <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} />
            Auto refresh every 25s
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Carrier
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={carrier ? "outline" : "default"}
            onClick={() => { setCarrier(""); setPage(1); }}
          >
            All Records
          </Button>
          {facets.carriers.map((c) => (
            <Button
              key={c.code}
              type="button"
              size="sm"
              variant={carrier === c.code ? "default" : "outline"}
              onClick={() => pickCarrier(c.code)}
            >
              {carrierLabel(c.code)}({c.count})
            </Button>
          ))}
        </div>
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-4 mb-2">
          Current Status
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={status ? "outline" : "default"}
            onClick={() => { setStatus(""); setPage(1); }}
          >
            All Records
          </Button>
          {facets.statuses.map((s) => (
            <Button
              key={s.code}
              type="button"
              size="sm"
              variant={status === s.code ? "default" : "outline"}
              onClick={() => pickStatus(s.code)}
            >
              {s.code}({s.count})
            </Button>
          ))}
        </div>
      </Card>

      {error && (
        <div role="alert"
          className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <IconAlert size={16} /> {error}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => fetchList()} className="text-xs">
            Retry Connection
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-lg font-semibold text-foreground">
          Total : {total} Shipment{total === 1 ? "" : "s"}
        </p>
        <Button type="button" onClick={() => setShowPush(true)}>
          <IconTruck size={16} /> Push Shipment
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order No</TableHead>
                <TableHead>Tracking Number</TableHead>
                <TableHead>Current Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Shipment Type</TableHead>
                <TableHead>Country Name</TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Entry Date &amp; Time</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <p>No shipments match these filters.</p>
                    <Link
                      to="/scan/dispatch"
                      className={`inline-block mt-4 ${buttonVariants({ size: "default" })}`}
                    >
                      Dispatch a parcel
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-foreground">
                      {s.order_no ?? s.order_id}
                    </TableCell>
                    <TableCell>
                      <span className="block font-semibold text-foreground">{s.awb_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {carrierLabel(s.carrier_code)} · {providerBadge(s)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={s.tracking_status} />
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium text-foreground">{s.customer_name ?? "—"}</span>
                      <span className="block text-xs text-muted-foreground">{s.customer_email ?? ""}</span>
                      <span className="block text-xs text-muted-foreground">{s.customer_mobile ?? ""}</span>
                    </TableCell>
                    <TableCell className="text-foreground">{s.shipment_type ?? "Road"}</TableCell>
                    <TableCell className="text-foreground">{s.country_name ?? "India"}</TableCell>
                    <TableCell className="text-foreground">{s.company_name ?? "—"}</TableCell>
                    <TableCell className="text-foreground">{formatEntryDate(s.entry_datetime)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/shipments/${s.id}`}
                        aria-label={`Open ${s.awb_number}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 bg-muted/20">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages} &middot; {items.length} entries
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <p className="text-sm text-muted-foreground" data-testid="shipsagar-health">
          {health
            ? `ShipSagar health: ${health.failed_webhooks} failed webhooks · ${health.pending_jobs} pending retries`
            : "ShipSagar health: unavailable"}
        </p>
        {health && (health.rejected_pushes ?? 0) > 0 && (
          <span
            role="status"
            data-testid="shipsagar-rejected"
            className="text-sm font-medium text-warning"
          >
            {health.rejected_pushes} unresolved ShipSagar push refusals
          </span>
        )}
        <div className="flex items-center gap-3">
          {drainMsg && (
            <span role="status" className="text-sm text-muted-foreground">{drainMsg}</span>
          )}
          {canDrainRetries() && (
            <Button type="button" onClick={handleDrain} disabled={draining} variant="secondary">
              {draining ? "Draining…" : "Retry drain"}
            </Button>
          )}
        </div>
      </Card>

      <PushShipmentDialog
        open={showPush}
        defaultOrderId={deepLinkedOrderId}
        onClose={() => setShowPush(false)}
        onPushed={() => {
          setShowPush(false);
          refreshHealth();
          fetchList(true);
        }}
        onRecovered={() => {
          // A 502 still commits the Parcel and the Shipment, so the parcel is on
          // the server and must appear on the page without a manual reload.
          refreshHealth();
          fetchList(true);
        }}
      />
    </div>
  );
}
