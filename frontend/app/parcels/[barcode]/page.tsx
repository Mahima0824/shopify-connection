"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, API } from "../../../lib/api";
import { IconAlert } from "../../../components/icons";
import ParcelBarcode from "../../../components/barcode/ParcelBarcode";

type ParcelData = {
  parcel: { id: string; parcel_code: string; barcode_value: string; status: string };
  order: { id: string; shopify_order_name: string; total_amount: number; financial_status: string; operational_status: string } | null;
  customer: { name: string | null; email: string | null; phone: string | null } | null;
  item_count: number;
};

export default function ParcelPage({ params }: { params: { barcode: string } }) {
  const [data, setData] = useState<ParcelData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function openLabel() {
    if (!data) return;
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${data.parcel.id}/label`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("Label failed to load");
    const blob = await r.blob();
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  }
  async function downloadPng() {
    if (!data) return;
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${data.parcel.id}/barcode.png`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("Barcode download failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.parcel.barcode_value}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<ParcelData>(`/api/v1/parcels/${params.barcode}`, {}, token)
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, [params.barcode]);

  if (err) return <main className="container" style={{ display: "flex", flexDirection: "column", gap: "16px", background: "var(--canvas)" }}><p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}><IconAlert size={16} /> {err}</p></main>;
  if (!data) return <main className="container" style={{ background: "var(--canvas)" }}><p style={{ color: "var(--muted)" }}>Loading…</p></main>;
  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      
      <Link href="/orders" style={{ color: "var(--muted)", fontSize: "14px" }}>← Back to Orders Directory</Link>
      <div className="content-card">
        <h1 className="display" style={{ fontSize: "28px", marginBottom: "8px" }}>Parcel {data.parcel.barcode_value}</h1>
        <p style={{ color: "var(--body)", fontSize: "14px" }}>Status: <span className="badge badge-neutral">{data.parcel.status}</span></p>
        {data.order && (
          <p style={{ color: "var(--body)", fontSize: "14px", marginTop: "8px" }}>Order: {data.order.shopify_order_name} — ₹{data.order.total_amount}</p>
        )}
        {data.customer && <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "8px" }}>Customer: {data.customer.name ?? data.customer.email}</p>}
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "8px" }}>Items: {data.item_count}</p>
        <div style={{ background: "#fff", padding: "16px", marginTop: "16px", maxWidth: "380px" }}>
          <ParcelBarcode value={data.parcel.barcode_value} />
        </div>
        <button onClick={openLabel} className="btn-secondary" style={{ marginTop: "16px" }}>
          Print label
        </button>
        <button onClick={downloadPng} className="btn-secondary" style={{ marginTop: "16px", marginLeft: "12px" }}>
          Download barcode PNG
        </button>
        <p style={{ color: "var(--muted)", fontSize: "13px", marginTop: "12px" }}>
          Scan this barcode with any USB scanner straight into the dispatch or return pages — no app or pairing needed.
        </p>
      </div>
    </main>
  );
}
