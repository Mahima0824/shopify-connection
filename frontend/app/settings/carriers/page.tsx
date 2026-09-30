"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

const KNOWN = ["DTDC", "TIRUPATI", "INDIA_POST", "MANUAL"];

type Health = {
  code: string;
  name: string;
  capabilities: string[];
  configured: boolean;
  last_success: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export default function CarriersPage() {
  const [code, setCode] = useState("DTDC");
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Health[] }>(`/api/v1/carriers/health`, {}, token)
      .then((d) => setHealth(d.items ?? []))
      .catch((e) => setHealthError(e?.message ?? "Failed to load carrier health"));
  }, []);
  async function connect() {
    const token = localStorage.getItem("token") ?? undefined;
    setMsg(null);
    try {
      await api(`/api/v1/carriers/${code}/connect`, { method: "POST", body: JSON.stringify({}) }, token);
      setMsg(`${code} connected (keys encrypted, never displayed).`);
    } catch (e: any) {
      setMsg(e?.message ?? "Connect failed");
    }
  }
  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Carrier connections</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Live API adapters activate when you save real account credentials. Until then, use MANUAL checkpoints.</p>
      </div>
      <div className="content-card" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Carrier" className="input-control" style={{ width: "240px" }}>
          {KNOWN.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={connect} className="btn-primary">Connect</button>
      </div>
      {msg && <p role="status" className="content-card" style={{ fontSize: "14px" }}>{msg}</p>}
      <div>
        <h2 className="display" style={{ fontSize: "20px", fontWeight: 700 }}>Carrier health</h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Connection state and last sync outcome per provider (credentials never shown).</p>
      </div>
      {healthError && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{healthError}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
        {health.map((h) => (
          <div key={h.code} className="content-card" style={{ borderTop: `4px solid ${h.configured ? "var(--success)" : "var(--hairline)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{h.code}</strong>
              <span className={`badge ${h.configured ? "badge-success" : "badge-neutral"}`}>
                {h.configured ? "Connected" : "Not connected"}
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "4px" }}>{h.name}</div>
            <div style={{ fontSize: "13px", marginTop: "8px" }}>
              Capabilities: {(h.capabilities ?? []).join(", ") || "—"}
            </div>
            <div style={{ fontSize: "13px", marginTop: "4px" }}>
              Last success: {h.last_success ?? "never"}
            </div>
            {h.last_error && (
              <div role="status" style={{ fontSize: "13px", marginTop: "4px", color: "var(--error)" }}>
                Last error: {h.last_error}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
