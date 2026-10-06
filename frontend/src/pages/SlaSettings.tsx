import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

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
    <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>SLA rules</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Breach thresholds per carrier and event type drive the outstanding board.</p>
      </div>
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {rules.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>No SLA rules yet. Add the first RTO rule below.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>{rules.map((r) => <li key={r.id} className="tabular-nums" style={{ fontSize: "14px" }}>{r.carrier_code} · {r.event_type} · {r.allowed_days}d / warn {r.warning_days}d</li>)}</ul>
        )}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input value={allowed} onChange={(e) => setAllowed(e.target.value)} aria-label="Allowed days" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" style={{ flex: 1 }} />
          <input value={warning} onChange={(e) => setWarning(e.target.value)} aria-label="Warning days" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" style={{ flex: 1 }} />
          <button onClick={add} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">Add RTO rule</button>
        </div>
      </div>
    </main>
  );
}
