import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

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
    <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>Carrier connections</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Live API adapters activate when you save real account credentials. Until then, use MANUAL checkpoints.</p>
      </div>
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Carrier" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" style={{ width: "240px" }}>
          {KNOWN.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={connect} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">Connect</button>
      </div>
      {msg && <p role="status" className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ fontSize: "14px" }}>{msg}</p>}
      <div>
        <h2 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "20px", fontWeight: 700 }}>Carrier health</h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Connection state and last sync outcome per provider (credentials never shown).</p>
      </div>
      {healthError && <p role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px" }}>{healthError}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
        {health.map((h) => (
          <div key={h.code} className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ borderTop: `4px solid ${h.configured ? "var(--success)" : "var(--hairline)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{h.code}</strong>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-[var(--ink)] ${h.configured ? "bg-[var(--success-bg)] text-[var(--ink)]" : "bg-[var(--neutral-bg)] text-[var(--muted)]"}`}>
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
