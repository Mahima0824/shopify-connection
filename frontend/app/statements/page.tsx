"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { API } from "../../lib/api";
import { api } from "../../lib/api";

type Upload = { id: string; statement_type: string; provider: string; status: string; row_count: number };

export default function StatementsPage() {
  const [items, setItems] = useState<Upload[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [stype, setStype] = useState("COURIER_SETTLEMENT");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Upload[] }>(`/api/v1/statements`, {}, token).then((d) => setItems(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function upload() {
    if (!file) return;
    setError(null); setMsg(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/statements/upload?type=${stype}`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? j.detail ?? "Upload failed");
      setMsg(`Uploaded ${j.data.row_count} rows — open it to dry-run and process.`);
      setFile(null); load();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Settlement statements</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Upload courier / bank / gateway statements to match money against orders and shipments
        </p>
      </div>
      <div className="content-card" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={stype} onChange={(e) => setStype(e.target.value)} aria-label="Type" className="input-control" style={{ width: "240px" }}>
          <option>COURIER_SETTLEMENT</option><option>BANK_STATEMENT</option>
          <option>PAYMENT_GATEWAY_STATEMENT</option><option>COURIER_SHIPMENT_REPORT</option>
        </select>
        <input type="file" accept=".csv,.xlsx" aria-label="Statement file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={upload} disabled={!file || busy} className="btn-primary">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {msg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{msg}</p>}
      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      <div className="content-card">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>Uploads</h2>
        {items.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>No statements yet. Upload a courier settlement CSV to match your first money.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((u) => (
              <li key={u.id} style={{ padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
                <Link href={`/statements/${u.id}`} style={{ fontWeight: 600 }}>
                  {u.provider || u.statement_type} · {u.row_count} rows · {u.status}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
