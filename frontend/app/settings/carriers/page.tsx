"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

const KNOWN = ["DTDC", "TIRUPATI", "INDIA_POST", "MANUAL"];

export default function CarriersPage() {
  const [code, setCode] = useState("DTDC");
  const [msg, setMsg] = useState<string | null>(null);
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
    </main>
  );
}
