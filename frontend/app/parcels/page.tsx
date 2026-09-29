"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { API, api } from "../../lib/api";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

const STATUSES = ["", "CREATED", "PACKED", "DISPATCHED", "RETURN_RECEIVED", "RTO"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function ParcelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function load(s: string) {
    try {
      setErr(null);
      const q = s ? `?status=${encodeURIComponent(s)}` : "";
      const d = await api<{ items: ParcelRow[] }>(`/api/v1/parcels${q}`, {}, localStorage.getItem("token") ?? undefined);
      setItems(d.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => { load(""); }, []);

  async function openLabel(id: string) {
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${id}/label`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      setErr("Label failed to load — please log in again.");
      return;
    }
    window.open(URL.createObjectURL(await r.blob()), "_blank", "noopener");
  }

  async function reprint(id: string, code: string) {
    try {
      await api(`/api/v1/parcels/${id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      setNotice(`Reprint logged for ${code} — same barcode, audited.`);
    } catch (e) {
      setNotice(null);
      setErr(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "32px" }}>Parcels</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            Every order's physical identity — one barcode per parcel, stable for life
          </p>
        </div>
        <Link href="/parcels/labels" className="btn-primary" style={{ textDecoration: "none" }}>
          Labels manager
        </Link>
      </div>
      <div className="content-card" style={{ padding: "16px 24px", display: "flex", gap: "16px", alignItems: "center" }}>
        <select className="input-control" value={status} onChange={(e) => { setStatus(e.target.value); load(e.target.value); }} aria-label="Status filter" style={{ width: "220px" }}>
          <option value="">All statuses</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: "13px", color: "var(--muted)" }}>{items.length} parcel{items.length === 1 ? "" : "s"}</span>
      </div>
      {err && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{err}</p>}
      {notice && <p role="status" style={{ color: "var(--brand-teal)", fontWeight: 600 }}>{notice}</p>}
      <div style={{ overflowX: "auto", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
        {items.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            No parcels yet. Sync orders or import a CSV — parcels are created automatically.
          </p>
        ) : (
          <table className="modern-table" style={{ border: "none" }}>
            <thead>
              <tr><th>Parcel</th><th>Order</th><th>Barcode</th><th>Status</th><th>Courier</th><th>AWB</th><th>Created</th><th style={{ textAlign: "right" }}>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.parcel_code}</td>
                  <td>{p.order_name ?? p.order_id}</td>
                  <td>{p.barcode_value}</td>
                  <td><span className="badge-pill">{p.status}</span></td>
                  <td>{p.courier ?? "—"}</td>
                  <td>{p.awb ?? "—"}</td>
                  <td style={{ fontSize: "13px", color: "var(--muted)" }}>{fmtDate(p.created_at)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/parcels/${p.barcode_value}`} className="btn-secondary">View</Link>{" "}
                    <button onClick={() => openLabel(p.id)} className="btn-secondary">Print</button>{" "}
                    <button onClick={() => reprint(p.id, p.parcel_code)} className="btn-secondary">Reprint</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
