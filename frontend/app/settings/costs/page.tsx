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
    <main>
      <h1>Cost configuration</h1>
      {items.map((i, ix) => (
        <div key={i.key}>
          <label>{i.key} ({i.source})
            <input type="number" value={i.amount} aria-label={i.key}
              onChange={(e) => setItems((s) => s.map((x, jx) => (jx === ix ? { ...x, amount: e.target.value } : x)))} />
          </label>
        </div>
      ))}
      <button onClick={save}>Save costs</button>
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
