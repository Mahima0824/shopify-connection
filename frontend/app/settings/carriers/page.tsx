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
    <main>
      <h1>Carrier connections</h1>
      <p>Live API adapters activate when you save real account credentials. Until then, use MANUAL checkpoints.</p>
      <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Carrier">
        {KNOWN.map((c) => <option key={c}>{c}</option>)}
      </select>
      <button onClick={connect}>Connect</button>
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
