
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { cooldownMessage } from "../lib/tracking";

export default function ShipmentDetailPage() {
  const { id } = useParams();
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
    api<any>(`/api/v1/shipments/${id!}`, {}, token).then(setShip).catch((e) => setError(e?.message));
    api<{ items: any[] }>(`/api/v1/shipments/${id!}/events`, {}, token)
      .then((d) => setEvents(d.items ?? [])).catch(() => {});
  }
  useEffect(load, [id]);
  async function checkpoint() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/shipments/${id!}/events`,
      { method: "POST", body: JSON.stringify({ carrier_status_raw: raw, message: msg || undefined }) }, token);
    setRaw(""); setMsg(""); load();
  }
  async function correct() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/shipments/${id!}/correct-awb`,
      { method: "POST", body: JSON.stringify({ awb_number: awb, reason }) }, token);
    setAwb(""); setReason(""); load();
  }
  async function refresh() {
    const token = localStorage.getItem("token") ?? undefined;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const out = await api<{ synced: boolean; reason?: string }>(
        `/api/v1/shipments/${id!}/sync`, { method: "POST" }, token);
      setSyncMsg(out.synced ? "Refreshed from carrier." : `Refresh skipped (${out.reason ?? "no update"}).`);
      load();
    } catch (e: any) {
      setSyncMsg(cooldownMessage(e));
    } finally {
      setSyncing(false);
    }
  }
  if (error) return <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4"><p role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p></div>;
  if (!ship) return <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4"><p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>Loading shipment…</p></div>;
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>{ship.carrier_code} · {ship.awb_number}</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-foreground">{ship.tracking_status}</span>
          <span style={{ marginLeft: "12px" }}>{ship.current_location ?? "No location yet"}</span>
        </p>
        <div style={{ marginTop: "12px", display: "flex", gap: "12px", alignItems: "center" }}>
          <button onClick={refresh} disabled={syncing} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">
            {syncing ? "Refreshing…" : "Refresh from carrier"}
          </button>
          {syncMsg && <span role="status" style={{ fontSize: "13px" }}>{syncMsg}</span>}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Record checkpoint</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Carrier status text (e.g. Arrived at hub)" aria-label="Status text" style={{ flex: 1 }} />
          <input className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" aria-label="Message" style={{ flex: 1 }} />
          <button onClick={checkpoint} disabled={!raw.trim()} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full">Add checkpoint</button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Correct AWB (admin, audited)</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="New AWB" aria-label="New AWB" style={{ flex: 1 }} />
          <input className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" style={{ flex: 1 }} />
          <button onClick={correct} disabled={!awb.trim() || !reason.trim()} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Correct</button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Tracking events</h2>
        {events.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>No checkpoints yet — record the first one above.</p>
        ) : (
          <ol style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {events.map((e) => <li key={e.id} style={{ fontSize: "14px" }}><strong>{e.normalized_status}</strong> — {e.message ?? e.carrier_status_raw}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}
