import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { bandTone, cooldownMessage } from "../lib/tracking";

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

const TONE_STYLE: Record<string, React.CSSProperties> = {
  critical: { borderLeft: "4px solid var(--destructive)" },
  warn: { borderLeft: "4px solid var(--warning)" },
  ok: {},
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Order Tracking Center</h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
            Real-time multi-carrier shipment status, India Post &amp; DTDC tracking events, and exception monitoring
          </p>
        </div>
        <button onClick={runSweep} disabled={sweeping} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">
          {sweeping ? "Running Sweep…" : "Run Global Tracking Sweep"}
        </button>
      </div>

      {sweepResult && (
        <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-muted text-foreground" style={{ padding: "10px 16px", borderRadius: "8px", background: "var(--card)" }}>
          {sweepResult}
        </div>
      )}

      {/* KPI Band */}
      <div className="grid grid-cols-1 gap-4 min-[769px]:grid-cols-2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ borderTop: "4px solid var(--accent, #3b82f6)" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Total Tracked</div>
          <div style={{ fontSize: "32px", fontWeight: 800 }}>{counts.total}</div>
        </div>
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ borderTop: "4px solid var(--destructive)" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Critical / NDR</div>
          <div style={{ fontSize: "32px", fontWeight: 800 }}>{counts.critical}</div>
        </div>
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ borderTop: "4px solid var(--warning)" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Delayed / Warning</div>
          <div style={{ fontSize: "32px", fontWeight: 800 }}>{counts.warn}</div>
        </div>
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ borderTop: "4px solid var(--success)" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted-foreground)" }}>On Track</div>
          <div style={{ fontSize: "32px", fontWeight: 800 }}>{counts.ok}</div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: "16px 24px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by Order #, Courier AWB, or Barcode…"
          aria-label="Search order tracking"
          style={{ flex: 2, minWidth: "240px" }}
        />
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier Filter" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All Carriers</option>
          <option value="INDIA_POST">India Post</option>
          <option value="DTDC">DTDC</option>
          <option value="TIRUPATI">Tirupati</option>
          <option value="MANUAL">Manual</option>
          {carriers.map((c) => (
            !["INDIA_POST", "DTDC", "TIRUPATI", "MANUAL"].includes(c) && <option key={c}>{c}</option>
          ))}
        </select>
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status Filter" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All Statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "NDR_REATTEMPT", "DELIVERY_EXCEPTION", "RTO_INITIATED", "RTO_DELIVERED", "RETURNED", "LOST"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Band Filter" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All Bands</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">On Track</option>
        </select>
      </div>

      {error && <p role="alert" className="bg-[var(--destructive/10)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}

      {/* Main Table */}
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        {shown.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>
            No order tracking records found. Try searching for another Order # or AWB.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted" style={{ border: "none" }}>
            <thead>
              <tr>
                <th>Order</th>
                <th>AWB / Consignment</th>
                <th>Carrier</th>
                <th>Status</th>
                <th>Current Location</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} style={TONE_STYLE[bandTone(s.tracking_status)]}>
                  <td style={{ fontWeight: 600 }}>{names[s.id] || "Order"}</td>
                  <td style={{ fontWeight: 600, fontFamily: "monospace" }}>{s.awb_number}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-muted text-foreground">{s.carrier_code}</span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-muted text-foreground">{s.tracking_status}</span>
                    {cool[s.id] && <div role="status" style={{ fontSize: "12px", color: "var(--warning)", marginTop: "4px" }}>{cool[s.id]}</div>}
                  </td>
                  <td style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>
                    {s.current_location || s.last_checkpoint_message || "-"}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => refreshShipment(s.id)} disabled={!!syncing[s.id]} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginRight: "8px" }}>
                      {syncing[s.id] ? "Syncing…" : "Sync"}
                    </button>
                    <button onClick={() => openTimeline(s)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginRight: "8px" }}>
                      Timeline
                    </button>
                    <Link to={`/shipments/${s.id}`} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">
                      Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Timeline Modal */}
      {selectedShipment && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
          onClick={() => setSelectedShipment(null)}
        >
          <div
            className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5"
            style={{ maxWidth: "600px", width: "100%", maxHeight: "80vh", overflowY: "auto", background: "var(--card)", padding: "24px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h3 style={{ fontSize: "18px", fontWeight: 700 }}>
                  Tracking Timeline: {selectedShipment.awb_number}
                </h3>
                <p style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
                  Carrier: {selectedShipment.carrier_code} | Status: {selectedShipment.tracking_status}
                </p>
              </div>
              <button onClick={() => setSelectedShipment(null)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Close</button>
            </div>

            {loadingEvents ? (
              <p style={{ color: "var(--muted-foreground)", padding: "20px 0" }}>Loading event history…</p>
            ) : events.length === 0 ? (
              <p style={{ color: "var(--muted-foreground)", padding: "20px 0" }}>No checkpoints recorded yet for this consignment.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", borderLeft: "2px solid var(--border)", paddingLeft: "16px", marginTop: "12px" }}>
                {events.map((ev, i) => (
                  <div key={ev.id || i} style={{ position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: "-23px",
                        top: "4px",
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        background: "var(--accent, #3b82f6)",
                      }}
                    />
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>{ev.normalized_status}</div>
                    <div style={{ fontSize: "13px", marginTop: "2px" }}>{ev.message}</div>
                    <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "4px" }}>
                      {ev.location ? `📍 ${ev.location} • ` : ""}{ev.event_time ? new Date(ev.event_time).toLocaleString() : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
