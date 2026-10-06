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
};

type OutRow = {
  shipment_id: string;
  order_name: string | null;
  carrier_code: string;
  awb_number: string;
  tracking_status: string;
  sla_status: string;
};

const TONE_STYLE: Record<string, React.CSSProperties> = {
  critical: { borderLeft: "4px solid var(--error)" },
  warn: { borderLeft: "4px solid var(--warning)" },
  ok: {},
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Tracking command center</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Live courier state, exception bands, and manual refresh with cooldown
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[769px]:grid-cols-2" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        {([
          ["Critical", counts.critical, "var(--error)"],
          ["Warning", counts.warn, "var(--warning)"],
          ["On track", counts.ok, "var(--success)"],
        ] as const).map(([label, n, color]) => (
          <div key={label} className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ borderTop: `4px solid ${color}` }}>
            <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</div>
            <div style={{ fontSize: "32px", fontWeight: 800 }}>{n}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: "16px 24px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search AWB, order, or barcode…"
          aria-label="Search shipments"
          style={{ flex: 2, minWidth: "220px" }}
        />
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All carriers</option>
          {carriers.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "NDR_REATTEMPT", "DELIVERY_EXCEPTION", "RTO_INITIATED", "RTO_DELIVERED", "RETURNED", "LOST"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Exception band" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All bands</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">On track</option>
        </select>
      </div>

      {error && <p role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}

      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        {shown.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>
            No shipments match — book one from dispatch or clear the filters.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted" style={{ border: "none" }}>
            <thead><tr><th>AWB</th><th>Order</th><th>Carrier</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} style={TONE_STYLE[bandTone(s.tracking_status)]}>
                  <td style={{ fontWeight: 600 }}>{s.awb_number}</td>
                  <td>{names[s.id] ?? "-"}</td>
                  <td>{s.carrier_code}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-foreground">{s.tracking_status}</span>
                    {cool[s.id] && <div role="status" style={{ fontSize: "12px", color: "var(--warning)", marginTop: "4px" }}>{cool[s.id]}</div>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => refresh(s.id)} disabled={!!syncing[s.id]} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginRight: "8px" }}>
                      {syncing[s.id] ? "Refreshing…" : "Refresh"}
                    </button>
                    <Link to={`/shipments/${s.id}`} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
