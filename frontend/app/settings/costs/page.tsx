"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function CostsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: any[] }>(`/api/v1/reports/costs`, {}, token).then((d) => setItems(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function save() {
    const token = localStorage.getItem("token") ?? undefined;
    const payload = {
      items: items.map((i) => ({ key: i.key, amount: Number(i.amount), source: "MANUAL", effective_from: new Date().toISOString() })),
    };
    await api(`/api/v1/reports/costs`, { method: "PUT", body: JSON.stringify(payload) }, token);
    setMsg("Saved — new values apply from now; past months frozen.");
    load();
  }
  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Cost configuration</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Manual cost inputs feed monthly profitability — past months stay frozen.</p>
      </div>
      <div className="content-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {items.map((i, ix) => (
          <div key={i.key}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>{i.key} ({i.source})
              <input type="number" value={i.amount} aria-label={i.key} className="input-control"
                onChange={(e) => setItems((s) => s.map((x, jx) => (jx === ix ? { ...x, amount: e.target.value } : x)))} />
            </label>
          </div>
        ))}
        <div>
          <button onClick={save} className="btn-primary">Save costs</button>
        </div>
        {msg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{msg}</p>}
      </div>
    </main>
  );
}
