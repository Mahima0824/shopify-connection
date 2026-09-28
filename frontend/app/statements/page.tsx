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
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Upload[] }>(`/api/v1/statements`, {}, token).then((d) => setItems(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function upload() {
    if (!file) return;
    setError(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/statements/upload?type=${stype}`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? j.detail ?? "Upload failed");
      setMsg(`Uploaded ${j.data.row_count} rows`);
      setFile(null); load();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    }
  }
  return (
    <main>
      <h1>Statements</h1>
      <select value={stype} onChange={(e) => setStype(e.target.value)} aria-label="Type">
        <option>COURIER_SETTLEMENT</option><option>BANK_STATEMENT</option>
        <option>PAYMENT_GATEWAY_STATEMENT</option><option>COURIER_SHIPMENT_REPORT</option>
      </select>
      <input type="file" accept=".csv,.xlsx" aria-label="Statement file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={upload} disabled={!file}>Upload</button>
      {msg && <p role="status">{msg}</p>}
      {error && <p role="alert">{error}</p>}
      <ul>{items.map((u) => <li key={u.id}><Link href={`/statements/${u.id}`}>{u.provider || u.statement_type} · {u.row_count} rows · {u.status}</Link></li>)}</ul>
    </main>
  );
}
