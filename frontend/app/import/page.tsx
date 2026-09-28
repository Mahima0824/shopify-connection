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
    <main>
      <h1>Import Shopify orders CSV</h1>
      <p>Shopify admin → Orders → Export → upload the .csv here. No store connection needed.</p>
      <input type="file" accept=".csv" aria-label="CSV file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={upload} disabled={!file || busy}>{busy ? "Importing…" : "Upload & import"}</button>
      {error && <p role="alert">{error}</p>}
      {summary && (<><ImportResult summary={summary} /><Link href="/orders">View orders</Link></>)}
    </main>
  );
}
