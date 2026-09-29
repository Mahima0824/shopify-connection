"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import EmptyState from "../../components/EmptyState";

type Ship = { id: string; order_id: string; order_name?: string | null; carrier_code: string; awb_number: string; tracking_status: string; location?: string | null };

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
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Shipments</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            Every parcel linked to a courier AWB with live tracking state
          </p>
        </div>
        <Link href="/shipments/outstanding" className="btn-secondary" style={{ textDecoration: "none" }}>
          Outstanding board
        </Link>
      </div>
      <div className="content-card" style={{ padding: "16px 24px", display: "flex", gap: "16px", alignItems: "center" }}>
        <input className="input-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB or order…" aria-label="Search" style={{ flex: 1 }} />
        <select className="input-control" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: "200px" }}>
          <option value="">All statuses</option>
          {["BOOKED", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "RTO_INITIATED", "RETURNED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
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
            <thead><tr><th>AWB</th><th>Carrier</th><th>Status</th><th>Location</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.awb_number}</td><td>{s.carrier_code}</td>
                  <td><span className="badge-pill">{s.tracking_status}</span></td>
                  <td>{s.location ?? "-"}</td>
                  <td style={{ textAlign: "right" }}><Link href={`/shipments/${s.id}`} className="btn-secondary">Open</Link></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
