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
    try {
      const d = await api<any>(`/api/v1/statements/${params.id}/dry-run`, { method: "POST" }, token);
      setCounts({ dry_run: d });
    } catch (e: any) {
      setError(e?.message ?? "Dry run failed");
    }
  }
  async function process() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      await api(`/api/v1/statements/${params.id}/process`, { method: "POST" }, token);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Process failed");
    }
  }
  async function matchRow(rid: string) {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      await api(`/api/v1/statements/rows/${rid}/match`,
        { method: "POST", body: JSON.stringify({ shipment_id: shipId }) }, token);
      setShipId(""); load();
    } catch (e: any) {
      setError(e?.message ?? "Match failed");
    }
  }
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "32px" }}>Statement results</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Dry-run first, then process and clear the unmatched queue</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={dryRun} className="btn-secondary">Dry run</button>
          <button onClick={process} className="btn-primary">Process</button>
        </div>
      </div>
      {error && <p role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      {counts && (
        <div className="content-card" style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          {Object.entries(counts.dry_run ?? counts).filter(([, v]) => typeof v === "number").map(([k, v]) => (
            <div key={k}><div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: "24px", fontWeight: 800 }}>{v as number}</div></div>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
        {rows.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>No rows in this statement.</p>
        ) : (
          <table className="modern-table" style={{ border: "none" }}>
            <thead><tr><th>Row</th><th>AWB</th><th>Net</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.row_number}</td><td style={{ fontWeight: 600 }}>{r.awb_number ?? "-"}</td><td>₹{Number(r.net_amount || 0).toLocaleString()}</td>
                  <td><span className="badge-pill">{r.reconciliation_status}</span></td>
                  <td style={{ textAlign: "right" }}>{r.reconciliation_status === "UNMATCHED" && (
                    <span style={{ display: "inline-flex", gap: "8px" }}>
                      <input className="input-control" value={shipId} onChange={(e) => setShipId(e.target.value)} placeholder="Shipment ID" aria-label="Shipment ID" style={{ width: "160px" }} />
                      <button onClick={() => matchRow(r.id)} className="btn-secondary">Match</button>
                    </span>)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
