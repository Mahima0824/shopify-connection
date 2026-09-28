"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

type Ship = { id: string; order_id: string; order_name?: string | null; carrier_code: string; awb_number: string; tracking_status: string; location?: string | null };

export function slaTone(status: string): "ok" | "warn" | "critical" {
  if (status === "BREACHED") return "critical";
  if (status === "APPROACHING") return "warn";
  return "ok";
}

export default function ShipmentsPage() {
  const [items, setItems] = useState<Ship[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({ ...(status ? { status } : {}) });
    api<{ items: Ship[] }>(`/api/v1/shipments?${qs}`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load"));
  }, [status]);
  const shown = q ? items.filter((s) => s.awb_number.includes(q) || (s.order_name ?? "").includes(q)) : items;
  return (
    <main>
      <h1>Shipments</h1>
      <div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB or order" aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "RTO_INITIATED", "RETURNED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <Link href="/shipments/outstanding">Outstanding</Link>
      </div>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead><tr><th>AWB</th><th>Carrier</th><th>Status</th><th>Location</th><th></th></tr></thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id}><td>{s.awb_number}</td><td>{s.carrier_code}</td><td>{s.tracking_status}</td>
              <td>{s.location ?? "-"}</td><td><Link href={`/shipments/${s.id}`}>Open</Link></td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
