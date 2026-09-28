"use client";

import React, { useEffect, useState } from "react";
import { API } from "../../../lib/api";
import { api } from "../../../lib/api";

export default function MonthlyPage() {
  const [month, setMonth] = useState("2026-09");
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/reports/monthly?month=${month}`, {}, token)
      .then(setData).catch((e) => setError(e?.message));
  }, [month]);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") ?? "" : "";
  async function download() {
    const r = await fetch(`${API}/api/v1/reports/monthly/export?month=${month}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("Export failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monthly_report_${month}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return (
    <main>
      <h1>Monthly report</h1>
      <input type="month" value={month} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMonth(e.target.value)} aria-label="Month" />
      <button onClick={download}>Download Excel</button>
      <h2>Orders</h2><pre>{JSON.stringify(data.orders, null, 2)}</pre>
      <h2>Money</h2><pre>{JSON.stringify(data.money, null, 2)}</pre>
      <h2>Profitability ({data.profitability.label})</h2><pre>{JSON.stringify(data.profitability, null, 2)}</pre>
      <h2>Exceptions</h2><pre>{JSON.stringify(data.exceptions, null, 2)}</pre>
    </main>
  );
}
