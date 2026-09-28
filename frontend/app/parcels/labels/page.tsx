"use client";
import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import LabelPreview from "../../../components/barcode/LabelPreview";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

export default function LabelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reprinted, setReprinted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api<{ items: ParcelRow[] }>(`/api/v1/parcels`, {}, localStorage.getItem("token") ?? undefined)
      .then((d) => setItems(d.items))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const filtered = items.filter((p) => {
    if (!query) return true;
    const q = query.trim().toUpperCase();
    return p.barcode_value.toUpperCase().includes(q) || p.parcel_code.toUpperCase().includes(q) || (p.order_name ?? "").toUpperCase().includes(q);
  });

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function reprint(p: ParcelRow) {
    try {
      await api(`/api/v1/parcels/${p.id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      setReprinted((r) => ({ ...r, [p.id]: true }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  const chosen = filtered.filter((p) => selected[p.id]);

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <style>{`@media print { .no-print { display: none !important; } .label { break-inside: avoid; page-break-inside: avoid; } }`}</style>
      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h1 className="display" style={{ fontSize: "28px" }}>Labels manager</h1>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search barcode, parcel, order" aria-label="Search parcels" />
      {err && <p role="alert">{err}</p>}
      <button className="btn-secondary" onClick={() => window.print()} disabled={chosen.length === 0}>
        Print Selected ({chosen.length})
      </button>
      <table>
        <thead>
          <tr><th>Select</th><th>Parcel</th><th>Barcode</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td><input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)} aria-label={`Select ${p.barcode_value}`} /></td>
              <td>{p.parcel_code}</td>
              <td>{p.barcode_value}</td>
              <td>{p.status}</td>
              <td><button onClick={() => reprint(p)}>Reprint</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="print-container">
        {chosen.map((p) => (
          <LabelPreview key={p.id} businessName="Recon Parcel" orderName={p.order_name ?? p.order_id} parcelCode={p.barcode_value} reprint={!!reprinted[p.id]} />
        ))}
      </div>
    </main>
  );
}
