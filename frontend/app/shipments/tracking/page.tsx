"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { bandTone, cooldownMessage } from "../../../lib/tracking";

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
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Tracking command center</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Live courier state, exception bands, and manual refresh with cooldown
        </p>
      </div>

      <div className="cols-2" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        {([
          ["Critical", counts.critical, "var(--error)"],
          ["Warning", counts.warn, "var(--warning)"],
          ["On track", counts.ok, "var(--success)"],
        ] as const).map(([label, n, color]) => (
          <div key={label} className="content-card" style={{ borderTop: `4px solid ${color}` }}>
            <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: "32px", fontWeight: 800 }}>{n}</div>
          </div>
        ))}
      </div>

      <div className="content-card" style={{ padding: "16px 24px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input-control"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search AWB, order, or barcode…"
          aria-label="Search shipments"
          style={{ flex: 2, minWidth: "220px" }}
        />
        <select className="input-control" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All carriers</option>
          {carriers.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input-control" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "NDR_REATTEMPT", "DELIVERY_EXCEPTION", "RTO_INITIATED", "RTO_DELIVERED", "RETURNED", "LOST"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input-control" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Exception band" style={{ flex: 1, minWidth: "140px" }}>
          <option value="">All bands</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">On track</option>
        </select>
      </div>

      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}

      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
        {shown.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            No shipments match — book one from dispatch or clear the filters.
          </p>
        ) : (
          <table className="modern-table" style={{ border: "none" }}>
            <thead><tr><th>AWB</th><th>Order</th><th>Carrier</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} style={TONE_STYLE[bandTone(s.tracking_status)]}>
                  <td style={{ fontWeight: 600 }}>{s.awb_number}</td>
                  <td>{names[s.id] ?? "-"}</td>
                  <td>{s.carrier_code}</td>
                  <td>
                    <span className="badge-pill">{s.tracking_status}</span>
                    {cool[s.id] && <div role="status" style={{ fontSize: "12px", color: "var(--warning)", marginTop: "4px" }}>{cool[s.id]}</div>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => refresh(s.id)} disabled={!!syncing[s.id]} className="btn-secondary" style={{ marginRight: "8px" }}>
                      {syncing[s.id] ? "Refreshing…" : "Refresh"}
                    </button>
                    <Link href={`/shipments/${s.id}`} className="btn-secondary">Open</Link>
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
