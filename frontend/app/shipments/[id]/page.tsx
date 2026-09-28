"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function ShipmentDetailPage({ params }: { params: { id: string } }) {
  const [ship, setShip] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [awb, setAwb] = useState("");
  const [reason, setReason] = useState("");
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
  if (error) return <p role="alert">{error}</p>;
  if (!ship) return <p>Loading…</p>;
  return (
    <main>
      <h1>{ship.carrier_code} · {ship.awb_number}</h1>
      <p>Status: {ship.tracking_status} · Location: {ship.current_location ?? "-"}</p>
      <h2>Record checkpoint</h2>
      <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Carrier status text" aria-label="Status text" />
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" aria-label="Message" />
      <button onClick={checkpoint}>Add checkpoint</button>
      <h2>Correct AWB (admin, audited)</h2>
      <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="New AWB" aria-label="New AWB" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" />
      <button onClick={correct} disabled={!awb.trim() || !reason.trim()}>Correct</button>
      <h2>Events</h2>
      <ol>{events.map((e) => <li key={e.id}>{e.normalized_status} — {e.message ?? e.carrier_status_raw}</li>)}</ol>
    </main>
  );
}
