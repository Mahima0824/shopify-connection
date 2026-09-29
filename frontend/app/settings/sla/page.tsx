"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function SlaPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [allowed, setAllowed] = useState("45");
  const [warning, setWarning] = useState("7");
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: any[] }>(`/api/v1/sla/rules`, {}, token).then((d) => setRules(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function add() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/sla/rules`, {
      method: "POST",
      body: JSON.stringify({ carrier_code: "*", event_type: "RTO", allowed_days: Number(allowed), warning_days: Number(warning) }),
    }, token);
    load();
  }
  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>SLA rules</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Breach thresholds per carrier and event type drive the outstanding board.</p>
      </div>
      <div className="content-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {rules.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>No SLA rules yet. Add the first RTO rule below.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>{rules.map((r) => <li key={r.id} className="tnum" style={{ fontSize: "14px" }}>{r.carrier_code} · {r.event_type} · {r.allowed_days}d / warn {r.warning_days}d</li>)}</ul>
        )}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input value={allowed} onChange={(e) => setAllowed(e.target.value)} aria-label="Allowed days" className="input-control" style={{ flex: 1 }} />
          <input value={warning} onChange={(e) => setWarning(e.target.value)} aria-label="Warning days" className="input-control" style={{ flex: 1 }} />
          <button onClick={add} className="btn-primary">Add RTO rule</button>
        </div>
      </div>
    </main>
  );
}
