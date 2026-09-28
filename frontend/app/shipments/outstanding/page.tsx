"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { slaTone } from "../../../lib/sla";

type Row = { shipment_id: string; order_name: string | null; carrier_code: string; awb_number: string; tracking_status: string; age_days: number; sla_status: string; sla_days_used: number; sla_deadline: string | null; amount: number; money_status: string };

const TONE_BG: Record<string, string> = { critical: "var(--brand-coral)", warn: "var(--brand-ochre)", ok: "transparent" };

export default function OutstandingPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [sla, setSla] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({ ...(sla ? { sla } : {}) });
    api<{ items: Row[] }>(`/api/v1/shipments/outstanding?${qs}`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load"));
  }, [sla]);
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "32px" }}>Outstanding shipments</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Parcels that need courier follow-up — oldest and breached first
        </p>
      </div>
      <div className="content-card" style={{ padding: "16px 24px" }}>
        <select className="input-control" value={sla} onChange={(e) => setSla(e.target.value)} aria-label="SLA band" style={{ width: "220px" }}>
          <option value="">All bands</option>
          <option>NORMAL</option><option>APPROACHING</option><option>BREACHED</option>
        </select>
      </div>
      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      <div style={{ overflowX: "auto", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
        {items.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            Nothing outstanding. Every parcel is delivered, returned, or resolved.
          </p>
        ) : (
          <table className="modern-table" style={{ border: "none" }}>
            <thead><tr><th>Order</th><th>AWB</th><th>Status</th><th>Age</th><th>SLA</th><th>Amount</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.shipment_id} style={{ borderLeft: `4px solid ${TONE_BG[slaTone(r.sla_status)]}` }}>
                  <td style={{ fontWeight: 600 }}>{r.order_name ?? "-"}</td><td>{r.awb_number}</td><td>{r.tracking_status}</td>
                  <td>{r.age_days}d</td><td><span className="badge-pill">{r.sla_status} ({r.sla_days_used}d)</span></td><td>₹{Number(r.amount || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
