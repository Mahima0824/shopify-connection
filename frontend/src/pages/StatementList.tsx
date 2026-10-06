import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../lib/api";
import { api } from "../lib/api";
import {
  BankMismatchItem,
  BankSummary,
  canManualMatch,
  getBankSummary,
  listBankMismatches,
  manualMatchStatementRow,
} from "../lib/api";
import MetricCard from "../components/MetricCard";
import SeverityBadge from "../components/SeverityBadge";

type Upload = { id: string; statement_type: string; provider: string; status: string; row_count: number };

function inr(v: string | number): string {
  const n = Number(v ?? 0);
  // "U+20B9" (rupee sign) as a unicode escape keeps this file pure ASCII,
  // immune to encoding misinterpretation at any layer (editor/git/server/browser).
  return `\u20B9${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function rowStatus(r: BankMismatchItem): string {
  return (r.status ?? "MISMATCH").toUpperCase();
}

function statusSeverity(s: string): string {
  if (s === "MATCHED") return "LOW";
  if (s === "POTENTIAL_MATCH") return "MEDIUM";
  if (s === "UNMATCHED") return "CRITICAL";
  return "HIGH";
}

function isPotential(r: BankMismatchItem): boolean {
  if (rowStatus(r) === "POTENTIAL_MATCH") return true;
  const lvl = (r.match_level ?? "").toUpperCase();
  return lvl === "L3" || lvl === "L4";
}

export default function StatementsPage() {
  const [items, setItems] = useState<Upload[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [stype, setStype] = useState("COURIER_SETTLEMENT");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Upload[] }>(`/api/v1/statements`, {}, token).then((d) => setItems(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function upload() {
    if (!file) return;
    setError(null); setMsg(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/statements/upload?type=${stype}`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? j.detail ?? "Upload failed");
      setMsg(`Uploaded ${j.data.row_count} rows - open it to dry-run and process.`);
      setFile(null); load();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // --- Reconciliation mismatch board (FE2, additive: upload flow above untouched) ---
  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [mismatches, setMismatches] = useState<BankMismatchItem[]>([]);
  const [reconLoading, setReconLoading] = useState(true);
  const [reconError, setReconError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BankMismatchItem | null>(null);
  const [shipId, setShipId] = useState("");
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchMsg, setMatchMsg] = useState<string | null>(null);
  const reqRef = useRef(0);

  const loadRecon = useCallback(() => {
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    setReconLoading(true);
    setReconError(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    Promise.all([getBankSummary(token), listBankMismatches(token)])
      .then(([s, m]) => {
        if (!isCurrent()) return;
        setSummary(s);
        setMismatches(m.items ?? []);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        setSummary(null);
        setMismatches([]);
        const msg = e?.status === 404
          ? "Reconciliation API not found on the backend. Restart the backend server (and run migrations) so it serves the latest code, then Retry."
          : (e?.message ?? "Failed to load reconciliation");
        setReconError(msg);
      })
      .finally(() => {
        if (isCurrent()) setReconLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRecon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doManualMatch() {
    if (!selected || !shipId.trim()) return;
    setMatchBusy(true);
    setMatchMsg(null);
    setReconError(null);
    try {
      const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
      await manualMatchStatementRow(selected.bank_row_id, shipId.trim(), token);
      setMatchMsg(`Row matched to shipment ${shipId.trim()}.`);
      setShipId("");
      setSelected(null);
      loadRecon();
    } catch (e: any) {
      setReconError(e?.message ?? "Manual match failed");
    } finally {
      setMatchBusy(false);
    }
  }

  const privileged = typeof window !== "undefined" ? canManualMatch() : false;
  const selStatus = selected ? rowStatus(selected) : "";
  const selEligible = selected ? isPotential(selected) : false;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Settlement statements</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Upload courier / bank / gateway statements to match money against orders and shipments
        </p>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <select value={stype} onChange={(e) => setStype(e.target.value)} aria-label="Type" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" style={{ width: "240px" }}>
          <option>COURIER_SETTLEMENT</option><option>BANK_STATEMENT</option>
          <option>PAYMENT_GATEWAY_STATEMENT</option><option>COURIER_SHIPMENT_REPORT</option>
        </select>
        <input type="file" accept=".csv,.xlsx" aria-label="Statement file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={upload} disabled={!file || busy} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full">
          {busy ? "Uploading..." : "Upload"}
        </button>
      </div>
      {msg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{msg}</p>}
      {error && <p role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Uploads</h2>
        {items.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>No statements yet. Upload a courier settlement CSV to match your first money.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((u) => (
              <li key={u.id} style={{ padding: "12px 16px", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "12px" }}>
                <Link to={`/statements/${u.id}`} style={{ fontWeight: 600 }}>
                  {u.provider || u.statement_type} &middot; {u.row_count} rows &middot; {u.status}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div id="reconciliation" style={{ scrollMarginTop: "80px" }}>
        <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", fontWeight: 700 }}>Reconciliation</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Expected settlements vs actual bank credits &mdash; clear the mismatch queue
        </p>
      </div>

      {reconError && (
        <div role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {reconError} <button onClick={loadRecon} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}
      {matchMsg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{matchMsg}</p>}

      {reconLoading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>Loading reconciliation&hellip;</div>
      ) : (
        <>
          {summary && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                <MetricCard title="Expected settlement" value={inr(summary.expected_settlement)} subtitle="from orders + shipments" />
                <MetricCard title="Actual bank credit" value={inr(summary.actual_bank_credit)} subtitle="from bank statements" />
                <MetricCard title="Difference" value={inr(summary.difference)} subtitle={`matched ${summary.matched} \u00B7 pending ${summary.pending} \u00B7 mismatch ${summary.mismatch}`} />
              </div>
            </div>
          )}
          <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: "13px", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
              Mismatch queue &middot; {mismatches.length} rows
            </div>
            {mismatches.length === 0 ? (
              <p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>No mismatches. Every bank credit matches its expected settlement.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Bank reference</th>
                      <th style={{ textAlign: "right" }}>Expected</th>
                      <th style={{ textAlign: "right" }}>Actual</th>
                      <th style={{ textAlign: "right" }}>Difference</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((r) => {
                      const st = rowStatus(r);
                      return (
                        <tr key={r.bank_row_id}>
                          <td style={{ fontWeight: 600 }}>{r.order_name || r.order_id || "-"}</td>
                          <td style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>{r.bank_reference || "-"}</td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>{inr(r.expected_amount)}</td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>{inr(r.actual_amount)}</td>
                          <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>{inr(r.difference)}</td>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                              <SeverityBadge severity={statusSeverity(st)} />
                              <span style={{ fontSize: "12px", fontWeight: 700 }}>{st}</span>
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end" }}>
                              <button onClick={() => { setSelected(r); setShipId(""); setMatchMsg(null); }} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" aria-label={`Details for ${r.bank_reference || r.bank_row_id}`}>
                                Details
                              </button>
                              {privileged && isPotential(r) && (
                                <button onClick={() => { setSelected(r); setShipId(""); setMatchMsg(null); }} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" aria-label={`Manual match ${r.bank_reference || r.bank_row_id}`}>
                                  Manual match
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {selected && (
        <div
          role="dialog"
          aria-label="Mismatch drill-down"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div style={{ width: "100%", maxWidth: "560px", padding: "32px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "22px", marginBottom: "8px" }}>Drill-down</h2>
            <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginBottom: "20px" }}>
              Order &rarr; payment &rarr; settlement &rarr; bank reference &middot; {selStatus}
            </p>
            <dl style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Order</dt>
                <dd style={{ fontWeight: 600 }}>{selected.order_name || selected.order_id || "-"}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Payment</dt>
                <dd style={{ fontWeight: 600 }}>{selected.payment_reference || selected.payment_id || "-"}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Settlement</dt>
                <dd style={{ fontWeight: 600 }}>{selected.gateway_settlement_reference || selected.shipment_id || "-"}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Bank reference</dt>
                <dd style={{ fontWeight: 600 }}>{selected.bank_reference || "-"}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Expected / Actual / Difference</dt>
                <dd className="tabular-nums" style={{ fontWeight: 600 }}>
                  {inr(selected.expected_amount)} / {inr(selected.actual_amount)} / {inr(selected.difference)}
                </dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <dt style={{ color: "var(--muted-foreground)" }}>Match level</dt>
                <dd style={{ fontWeight: 600 }}>{selected.match_level || "-"}</dd>
              </div>
            </dl>
            {privileged && selEligible && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
                <input
                  className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
                  value={shipId}
                  onChange={(e) => setShipId(e.target.value)}
                  placeholder="Shipment ID"
                  aria-label="Shipment ID"
                  style={{ flex: 1 }}
                />
                <button onClick={doManualMatch} disabled={!shipId.trim() || matchBusy} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full">
                  {matchBusy ? "Matching\u2026" : "Manual match"}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => setSelected(null)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ padding: "12px 20px" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
