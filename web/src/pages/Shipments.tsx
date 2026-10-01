
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import {
  ShipsagarHealth,
  canDrainRetries,
  drainShipsagarRetries,
  getShipsagarHealth,
  shipmentProvider,
} from "../lib/api";

type Ship = { id: string; order_id: string; order_name?: string | null; carrier_code: string; shipsagar_tracking_id?: string | null; awb_number: string; tracking_status: string; location?: string | null };

function providerLabel(s: { carrier_code?: string | null; shipsagar_tracking_id?: string | null }): string {
  const p = shipmentProvider(s);
  if (p === "SHIPSAGAR") return "ShipSagar";
  if (p === "MANUAL") return "MANUAL";
  return "direct";
}

export default function ShipmentsPage() {
  const [items, setItems] = useState<Ship[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ShipsagarHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);
  const reqRef = useRef(0);
  useEffect(() => {
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({ ...(status ? { status } : {}) });
    api<{ items: Ship[] }>(`/api/v1/shipments?${qs}`, {}, token)
      .then((d) => { if (isCurrent()) setItems(d.items ?? []); })
      .catch((e) => { if (!isCurrent()) return; setItems([]); setError(e?.message ?? "Failed to load"); });
  }, [status]);
  useEffect(() => {
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    getShipsagarHealth(token)
      .then((h) => { setHealth(h); setHealthError(null); })
      .catch((e) => { setHealth(null); setHealthError(e?.message ?? "Failed to load health"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function retryDrain() {
    if (!canDrainRetries()) return;
    if (typeof window !== "undefined" && !window.confirm("Drain due ShipSagar retries now?")) return;
    setDraining(true);
    setDrainMsg(null);
    setHealthError(null);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      const out = await drainShipsagarRetries(50, token);
      const drained = out.succeeded ?? out.drained ?? 0;
      const requeued = out.requeued ?? out.remaining ?? 0;
      const dead = out.dead_lettered ?? out.moved_to_dead_letter ?? 0;
      const checked = out.checked ?? drained + requeued + dead;
      setDrainMsg(`Retry drain complete: ${drained} drained, ${requeued} requeued, ${dead} dead-lettered (${checked} checked).`);
      const h = await getShipsagarHealth(token);
      setHealth(h);
    } catch (e: any) {
      setHealthError(e?.message ?? "Retry drain failed");
    } finally {
      setDraining(false);
    }
  }
  const shown = q ? items.filter((s) => s.awb_number.includes(q) || (s.order_name ?? "").includes(q)) : items;
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Shipments</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            Every parcel linked to a courier AWB with live tracking state
          </p>
        </div>
        <Link to="/shipments/outstanding" className="btn-secondary" style={{ textDecoration: "none" }}>
          Outstanding board
        </Link>
      </div>
      <div className="content-card" style={{ padding: "16px 24px", display: "flex", gap: "16px", alignItems: "center" }}>
        <input className="input-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB or order..." aria-label="Search" style={{ flex: 1 }} />
        <select className="input-control" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: "200px" }}>
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "RTO_INITIATED", "RETURNED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      <div className="content-card" style={{ padding: "12px 24px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        {health ? (
          <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
            ShipSagar health: {health.failed_webhooks ?? 0} failed webhooks &middot; {health.pending_jobs ?? 0} pending retries
            {(health.status ? ` (${health.status})` : "")}
          </p>
        ) : healthError ? (
          <p role="alert" style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>Health unavailable: {healthError}</p>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>Loading ShipSagar health&hellip;</p>
        )}
        <span style={{ flex: 1 }} />
        {drainMsg && <span style={{ fontSize: "12px", color: "var(--muted)" }}>{drainMsg}</span>}
        {canDrainRetries() && (
          <button onClick={retryDrain} disabled={draining} className="btn-secondary" aria-label="Retry drain">
            {draining ? "Draining..." : "Retry drain"}
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
        {shown.length === 0 ? (
          <div style={{ padding: "24px" }}>
            <EmptyState
              title="No shipments yet"
              body="Dispatch a parcel with a courier + AWB and it appears here."
              primary={{ label: "Dispatch a parcel", href: "/scan/dispatch" }}
              secondary={{ label: "Outstanding board", href: "/shipments/outstanding" }}
            />
          </div>
        ) : (
          <table className="modern-table" style={{ border: "none" }}>
            <thead><tr><th>AWB</th><th>Carrier</th><th>Provider</th><th>Status</th><th>Location</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.awb_number}</td><td>{s.carrier_code}</td>
                  <td><span className="badge-pill">{providerLabel(s)}</span></td>
                  <td><span className="badge-pill">{s.tracking_status}</span></td>
                  <td>{s.location ?? "-"}</td>
                  <td style={{ textAlign: "right" }}><Link to={`/shipments/${s.id}`} className="btn-secondary">Open</Link></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
