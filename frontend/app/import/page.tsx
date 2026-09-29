"use client";
import React, { useState } from "react";
import Link from "next/link";
import { API } from "../../lib/api";
import ImportResult, { ImportSummary } from "../../components/ImportResult";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true); setError(null); setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/imports/shopify-csv`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? "Import failed");
      setSummary(j.data);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Import Shopify orders CSV</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Shopify admin → Orders → Export → upload the .csv here. No store connection needed.</p>
      </div>
      <div className="content-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <input type="file" accept=".csv" aria-label="CSV file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div>
          <button onClick={upload} disabled={!file || busy} className="btn-primary">{busy ? "Importing…" : "Upload & import"}</button>
        </div>
        {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
        {summary && (<><ImportResult summary={summary} /><Link href="/orders">View orders</Link></>)}
      </div>
    </main>
  );
}
