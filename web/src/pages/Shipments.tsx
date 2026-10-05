import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  canDrainRetries,
  drainShipsagarRetries,
  getShipsagarHealth,
  listShipments,
  ShipmentListResult,
  ShipmentRow,
  shipmentProvider,
  syncShipment,
} from "../lib/api";
import {
  carrierLabel,
  formatEntryDate,
  isTerminal,
  SHIPMENT_STATUSES,
  statusTone,
  Tone,
} from "../lib/shipments";
import PushShipmentDialog from "../components/PushShipmentDialog";
import { IconAlert, IconTruck } from "../components/icons";

const REFRESH_MS = 25000;

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

const CHIP_ACTIVE = "px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-700 text-white shadow-xs";
const CHIP_IDLE =
  "px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition";

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

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
      className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {status}
    </span>
  );
}

export default function ShipmentsPage() {
  const [data, setData] = useState<ShipmentListResult | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tracking, setTracking] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [status, setStatus] = useState("");
  const [carrier, setCarrier] = useState("");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    failed_webhooks: number;
    pending_jobs: number;
    configured: boolean;
  } | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);
  const [showPush, setShowPush] = useState(false);
  const reqRef = useRef(0);

  const fetchList = useCallback(
    (silent = false) => {
      const req = ++reqRef.current;
      if (!silent) setError(null);
      listShipments({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        q: tracking || undefined,
        order_no: orderNo || undefined,
        status: status || undefined,
        carrier: carrier || undefined,
        page_size: 20,
      })
        .then((res) => {
          if (reqRef.current !== req) return;
          setData(res);
        })
        .catch((err: unknown) => {
          if (reqRef.current !== req) return;
          if (!silent) {
            setError(err instanceof Error ? err.message : "Failed to load shipments");
          }
        });
    },
    [dateFrom, dateTo, tracking, orderNo, status, carrier],
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    getShipsagarHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const refreshHealth = useCallback(() => {
    getShipsagarHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!live || !data) return;
    const tick = async () => {
      const targets = data.items.filter((s) => !isTerminal(s.tracking_status));
      if (targets.length === 0) return;
      await Promise.allSettled(targets.map((s) => syncShipment(s.id)));
      fetchList(true);
    };
    const t = setInterval(() => void tick(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live, data, fetchList]);

  const handleDrain = async () => {
    if (!window.confirm("Drain due ShipSagar retries now?")) return;
    setDraining(true);
    setDrainMsg(null);
    try {
      const out = await drainShipsagarRetries(50);
      const checked = out.checked ?? 0;
      const succeeded = out.succeeded ?? out.drained ?? 0;
      const requeued = out.requeued ?? out.remaining ?? 0;
      const dead = out.dead_lettered ?? out.moved_to_dead_letter ?? 0;
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

  const handleApply = () => fetchList();

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTracking("");
    setOrderNo("");
    setStatus("");
    setCarrier("");
  };

  const items = data?.items ?? [];
  const facets = data?.facets ?? { carriers: [], statuses: [] };
  const total = data?.total ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Shipments</h1>
        <p className="text-sm text-slate-500 mt-1">
          Push tracking numbers to ShipSagar and follow every parcel location live.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label htmlFor="f-date-from" className={labelClass}>Date From</label>
            <input id="f-date-from" aria-label="Date From" type="date"
              className={inputClass} value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-date-to" className={labelClass}>Date To</label>
            <input id="f-date-to" aria-label="Date To" type="date"
              className={inputClass} value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-tracking" className={labelClass}>Tracking No.</label>
            <input id="f-tracking" aria-label="Tracking No." className={inputClass}
              placeholder="Enter Tracking No." value={tracking}
              onChange={(e) => setTracking(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-order" className={labelClass}>Order No.</label>
            <input id="f-order" aria-label="Order No." className={inputClass}
              placeholder="Enter Order No." value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-status" className={labelClass}>Status</label>
            <select id="f-status" aria-label="Status" className={inputClass}
              value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-carrier" className={labelClass}>Courier</label>
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
          <button type="button" onClick={handleApply}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-xs transition">
            APPLY
          </button>
          <button type="button" onClick={clearFilters}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition">
            Clear filters
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            Auto refresh every 25s
          </label>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          Carrier
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={carrier ? CHIP_IDLE : CHIP_ACTIVE}
            onClick={() => setCarrier("")}>
            All Records
          </button>
          {facets.carriers.map((c) => (
            <button key={c.code} type="button"
              className={carrier === c.code ? CHIP_ACTIVE : CHIP_IDLE}
              onClick={() => setCarrier(carrier === c.code ? "" : c.code)}>
              {carrierLabel(c.code)}({c.count})
            </button>
          ))}
        </div>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-4 mb-2">
          Current Status
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={status ? CHIP_IDLE : CHIP_ACTIVE}
            onClick={() => setStatus("")}>
            All Records
          </button>
          {facets.statuses.map((s) => (
            <button key={s.code} type="button"
              className={status === s.code ? CHIP_ACTIVE : CHIP_IDLE}
              onClick={() => setStatus(status === s.code ? "" : s.code)}>
              {s.code}({s.count})
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert"
          className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <IconAlert size={16} /> {error}
          </span>
          <button type="button" onClick={() => fetchList()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-red-300 text-red-700 hover:bg-red-100 transition">
            Retry Connection
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-lg font-semibold text-slate-700">
          Total : {total} Shipment{total === 1 ? "" : "s"}
        </p>
        <button type="button" onClick={() => setShowPush(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition flex items-center gap-2">
          <IconTruck size={16} /> Push Shipment
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3">Order No</th>
              <th className="text-left px-4 py-3">Tracking Number</th>
              <th className="text-left px-4 py-3">Current Status</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Shipment Type</th>
              <th className="text-left px-4 py-3">Country Name</th>
              <th className="text-left px-4 py-3">Company Name</th>
              <th className="text-left px-4 py-3">Entry Date &amp; Time</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No shipments match these filters.
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-900">
                    {s.order_no ?? s.order_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-semibold text-slate-900">{s.awb_number}</span>
                    <span className="text-xs text-slate-500">
                      {carrierLabel(s.carrier_code)} · {providerBadge(s)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.tracking_status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="block text-slate-900">{s.customer_name ?? "—"}</span>
                    <span className="block text-xs text-slate-500">{s.customer_email ?? ""}</span>
                    <span className="block text-xs text-slate-500">{s.customer_mobile ?? ""}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{s.shipment_type ?? "Road"}</td>
                  <td className="px-4 py-3 text-slate-700">{s.country_name ?? "India"}</td>
                  <td className="px-4 py-3 text-slate-700">{s.company_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{formatEntryDate(s.entry_datetime)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600" data-testid="shipsagar-health">
          {health
            ? `ShipSagar health: ${health.failed_webhooks} failed webhooks · ${health.pending_jobs} pending retries`
            : "ShipSagar health: unavailable"}
        </p>
        <div className="flex items-center gap-3">
          {drainMsg && (
            <span role="status" className="text-sm text-slate-600">{drainMsg}</span>
          )}
          {canDrainRetries() && (
            <button type="button" onClick={handleDrain} disabled={draining}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 shadow-xs transition disabled:opacity-60">
              {draining ? "Draining…" : "Retry drain"}
            </button>
          )}
        </div>
      </div>

      <PushShipmentDialog
        open={showPush}
        onClose={() => setShowPush(false)}
        onPushed={() => {
          setShowPush(false);
          fetchList(true);
        }}
      />
    </div>
  );
}