"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function StatementDetailPage({ params }: { params: { id: string } }) {
  const [counts, setCounts] = useState<any | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [shipId, setShipId] = useState("");
  const [error, setError] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/statements/${params.id}/results`, {}, token)
      .then((d) => { setCounts(d.counts); setRows(d.rows ?? []); })
      .catch((e) => setError(e?.message));
  }
  useEffect(load, [params.id]);
  async function dryRun() {
    const token = localStorage.getItem("token") ?? undefined;
    const d = await api<any>(`/api/v1/statements/${params.id}/dry-run`, { method: "POST" }, token);
    setCounts({ dry_run: d });
  }
  async function process() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/statements/${params.id}/process`, { method: "POST" }, token);
    load();
  }
  async function matchRow(rid: string) {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/statements/rows/${rid}/match`,
      { method: "POST", body: JSON.stringify({ shipment_id: shipId }) }, token);
    setShipId(""); load();
  }
  if (error) return <p role="alert">{error}</p>;
  return (
    <main>
      <h1>Statement results</h1>
      <button onClick={dryRun}>Dry run</button>
      <button onClick={process}>Process</button>
      {counts && <pre>{JSON.stringify(counts, null, 2)}</pre>}
      <table>
        <thead><tr><th>Row</th><th>AWB</th><th>Net</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.row_number}</td><td>{r.awb_number ?? "-"}</td><td>{r.net_amount}</td>
              <td>{r.reconciliation_status}</td>
              <td>{r.reconciliation_status === "UNMATCHED" && (
                <span><input value={shipId} onChange={(e) => setShipId(e.target.value)} placeholder="Shipment ID" aria-label="Shipment ID" />
                <button onClick={() => matchRow(r.id)}>Match</button></span>)}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
