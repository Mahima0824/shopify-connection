"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { slaTone } from "../page";

type Row = { shipment_id: string; order_name: string | null; carrier_code: string; awb_number: string; tracking_status: string; age_days: number; sla_status: string; sla_days_used: number; sla_deadline: string | null; amount: number; money_status: string };

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
    <main>
      <h1>Outstanding shipments</h1>
      <select value={sla} onChange={(e) => setSla(e.target.value)} aria-label="SLA band">
        <option value="">All bands</option>
        <option>NORMAL</option><option>APPROACHING</option><option>BREACHED</option>
      </select>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead><tr><th>Order</th><th>AWB</th><th>Status</th><th>Age</th><th>SLA</th><th>Amount</th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.shipment_id} data-tone={slaTone(r.sla_status)}>
              <td>{r.order_name ?? "-"}</td><td>{r.awb_number}</td><td>{r.tracking_status}</td>
              <td>{r.age_days}d</td><td>{r.sla_status} ({r.sla_days_used}d)</td><td>{r.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
