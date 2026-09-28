"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

export default function ParcelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function load(s: string) {
    try {
      setErr(null);
      const q = s ? `?status=${encodeURIComponent(s)}` : "";
      const d = await api<{ items: ParcelRow[] }>(`/api/v1/parcels${q}`, {}, localStorage.getItem("token") ?? undefined);
      setItems(d.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => { load(""); }, []);

  async function reprint(id: string) {
    try {
      await api(`/api/v1/parcels/${id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      alert("Reprint logged");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h1 className="display" style={{ fontSize: "28px" }}>Parcels</h1>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Filter by status (blank = all)" aria-label="Status filter" />
        <button className="btn-secondary" onClick={() => load(status)}>Apply</button>
        <Link href="/parcels/labels">Labels manager</Link>
      </div>
      {err && <p role="alert">{err}</p>}
      <table>
        <thead>
          <tr><th>Parcel</th><th>Order</th><th>Barcode</th><th>Status</th><th>Courier</th><th>AWB</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.parcel_code}</td>
              <td>{p.order_name ?? p.order_id}</td>
              <td>{p.barcode_value}</td>
              <td>{p.status}</td>
              <td>{p.courier ?? "—"}</td>
              <td>{p.awb ?? "—"}</td>
              <td>{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
              <td style={{ display: "flex", gap: "8px" }}>
                <Link href={`/parcels/${p.barcode_value}`}>View</Link>
                <a href={`/parcels/${p.barcode_value}`}>Print</a>
                <button onClick={() => reprint(p.id)}>Reprint</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
