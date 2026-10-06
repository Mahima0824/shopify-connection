import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

export default function StatementDetailPage() {
  const { id } = useParams();
  const [counts, setCounts] = useState<any | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [shipId, setShipId] = useState("");
  const [error, setError] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/statements/${id!}/results`, {}, token)
      .then((d) => { setCounts(d.counts); setRows(d.rows ?? []); })
      .catch((e) => setError(e?.message));
  }
  useEffect(load, [id]);
  async function dryRun() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const d = await api<any>(`/api/v1/statements/${id!}/dry-run`, { method: "POST" }, token);
      setCounts({ dry_run: d });
    } catch (e: any) {
      setError(e?.message ?? "Dry run failed");
    }
  }
  async function process() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      await api(`/api/v1/statements/${id!}/process`, { method: "POST" }, token);
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Statement results</h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>Dry-run first, then process and clear the unmatched queue</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={dryRun} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Dry run</button>
          <button onClick={process} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full">Process</button>
        </div>
      </div>
      {error && <p role="alert" className="bg-[var(--destructive/10)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      {counts && (
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          {Object.entries(counts.dry_run ?? counts).filter(([, v]) => typeof v === "number").map(([k, v]) => (
            <div key={k}><div style={{ fontSize: "12px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: "24px", fontWeight: 800 }}>{v as number}</div></div>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        {rows.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>No rows in this statement.</p>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted" style={{ border: "none" }}>
            <thead><tr><th>Row</th><th>AWB</th><th>Net</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{r.row_number}</td><td style={{ fontWeight: 600 }}>{r.awb_number ?? "-"}</td><td className="tabular-nums">₹{Number(r.net_amount || 0).toLocaleString()}</td>
                  <td><span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-muted text-foreground">{r.reconciliation_status}</span></td>
                  <td style={{ textAlign: "right" }}>{r.reconciliation_status === "UNMATCHED" && (
                    <span style={{ display: "inline-flex", gap: "8px" }}>
                      <input className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={shipId} onChange={(e) => setShipId(e.target.value)} placeholder="Shipment ID" aria-label="Shipment ID" style={{ width: "160px" }} />
                      <button onClick={() => matchRow(r.id)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Match</button>
                    </span>)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
