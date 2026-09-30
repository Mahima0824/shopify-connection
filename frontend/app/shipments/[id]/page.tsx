"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { cooldownMessage } from "../../../lib/tracking";

export default function ShipmentDetailPage({ params }: { params: { id: string } }) {
  const [ship, setShip] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [awb, setAwb] = useState("");
  const [reason, setReason] = useState("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/shipments/${params.id}`, {}, token).then(setShip).catch((e) => setError(e?.message));
    api<{ items: any[] }>(`/api/v1/shipments/${params.id}/events`, {}, token)
      .then((d) => setEvents(d.items ?? [])).catch(() => {});
  }
  useEffect(load, [params.id]);
  async function checkpoint() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/shipments/${params.id}/events`,
      { method: "POST", body: JSON.stringify({ carrier_status_raw: raw, message: msg || undefined }) }, token);
    setRaw(""); setMsg(""); load();
  }
  async function correct() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/shipments/${params.id}/correct-awb`,
      { method: "POST", body: JSON.stringify({ awb_number: awb, reason }) }, token);
    setAwb(""); setReason(""); load();
  }
  async function refresh() {
    const token = localStorage.getItem("token") ?? undefined;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const out = await api<{ synced: boolean; reason?: string }>(
        `/api/v1/shipments/${params.id}/sync`, { method: "POST" }, token);
      setSyncMsg(out.synced ? "Refreshed from carrier." : `Refresh skipped (${out.reason ?? "no update"}).`);
      load();
    } catch (e: any) {
      setSyncMsg(cooldownMessage(e));
    } finally {
      setSyncing(false);
    }
  }
  if (error) return <div className="container"><p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p></div>;
  if (!ship) return <div className="container"><p style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading shipment…</p></div>;
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>{ship.carrier_code} · {ship.awb_number}</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          <span className="badge-pill">{ship.tracking_status}</span>
          <span style={{ marginLeft: "12px" }}>{ship.current_location ?? "No location yet"}</span>
        </p>
        <div style={{ marginTop: "12px", display: "flex", gap: "12px", alignItems: "center" }}>
          <button onClick={refresh} disabled={syncing} className="btn-secondary">
            {syncing ? "Refreshing…" : "Refresh from carrier"}
          </button>
          {syncMsg && <span role="status" style={{ fontSize: "13px" }}>{syncMsg}</span>}
        </div>
      </div>
      <div className="content-card">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>Record checkpoint</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input className="input-control" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Carrier status text (e.g. Arrived at hub)" aria-label="Status text" style={{ flex: 1 }} />
          <input className="input-control" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" aria-label="Message" style={{ flex: 1 }} />
          <button onClick={checkpoint} disabled={!raw.trim()} className="btn-primary">Add checkpoint</button>
        </div>
      </div>
      <div className="content-card">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>Correct AWB (admin, audited)</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input className="input-control" value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="New AWB" aria-label="New AWB" style={{ flex: 1 }} />
          <input className="input-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" style={{ flex: 1 }} />
          <button onClick={correct} disabled={!awb.trim() || !reason.trim()} className="btn-secondary">Correct</button>
        </div>
      </div>
      <div className="content-card">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>Tracking events</h2>
        {events.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>No checkpoints yet — record the first one above.</p>
        ) : (
          <ol style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {events.map((e) => <li key={e.id} style={{ fontSize: "14px" }}><strong>{e.normalized_status}</strong> — {e.message ?? e.carrier_status_raw}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}
