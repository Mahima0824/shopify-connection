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
    <main>
      <h1>SLA rules</h1>
      <ul>{rules.map((r) => <li key={r.id}>{r.carrier_code} · {r.event_type} · {r.allowed_days}d / warn {r.warning_days}d</li>)}</ul>
      <input value={allowed} onChange={(e) => setAllowed(e.target.value)} aria-label="Allowed days" />
      <input value={warning} onChange={(e) => setWarning(e.target.value)} aria-label="Warning days" />
      <button onClick={add}>Add RTO rule</button>
    </main>
  );
}
