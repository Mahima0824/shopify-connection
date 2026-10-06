import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { cooldownMessage } from "../lib/tracking";
import { Badge, Button, Card, Input } from "../components/primitives";

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

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
        <p role="alert" className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!ship) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
        <p className="p-10 text-center text-muted-foreground">Loading shipment…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{ship.carrier_code} · {ship.awb_number}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="secondary">{ship.tracking_status}</Badge>
          <span>{ship.current_location ?? "No location yet"}</span>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={refresh} disabled={syncing} variant="outline">
            {syncing ? "Refreshing…" : "Refresh from carrier"}
          </Button>
          {syncMsg && <span role="status" className="text-xs text-muted-foreground">{syncMsg}</span>}
        </div>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Record checkpoint</h2>
        <div className="flex flex-wrap gap-3">
          <Input className="flex-1 min-w-[240px]" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Carrier status text (e.g. Arrived at hub)" aria-label="Status text" />
          <Input className="flex-1 min-w-[240px]" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" aria-label="Message" />
          <Button onClick={checkpoint} disabled={!raw.trim()}>Add checkpoint</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Correct AWB (admin, audited)</h2>
        <div className="flex flex-wrap gap-3">
          <Input className="flex-1 min-w-[240px]" value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="New AWB" aria-label="New AWB" />
          <Input className="flex-1 min-w-[240px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" />
          <Button onClick={correct} disabled={!awb.trim() || !reason.trim()} variant="outline">Correct</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tracking events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checkpoints yet — record the first one above.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id} className="text-sm text-foreground">
                <strong className="font-semibold">{e.normalized_status}</strong> — {e.message ?? e.carrier_status_raw}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
