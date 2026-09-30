"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "../../../components/EmptyState";
import MetricCard from "../../../components/MetricCard";
import { LEDGER_TXN_TYPES, LedgerEntry, LedgerSummary, getLedgerSummary, listLedger } from "../../../lib/api";

const PAGE_SIZE = 20;

function isoStart(date: string): string {
  return date ? `${date}T00:00:00` : "";
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function inr(v: string | number): string {
  const n = Number(v ?? 0);
  return `₹${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

export default function LedgerPage() {
  const range = useMemo(defaultRange, []);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [type, setType] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setPage(0);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    const listParams = {
      ...(from ? { from: isoStart(from) } : {}),
      ...(to ? { to: isoStart(to) } : {}),
      ...(type ? { type } : {}),
      ...(orderSearch.trim() ? { order_id: orderSearch.trim() } : {}),
    };
    const listP = listLedger(listParams, token).then((d) => setItems(d.items ?? []));
    const summaryP =
      from && to
        ? getLedgerSummary({ from: isoStart(from), to: isoStart(to) }, token).then(setSummary)
        : Promise.resolve(setSummary(null));
    Promise.all([listP, summaryP])
      .catch((e) => setError(e?.message ?? "Failed to load ledger"))
      .finally(() => setLoading(false));
  }, [from, to, type, orderSearch]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const estimated = summary?.profit ? summary.profit.label !== "OPERATING PROFIT" : false;
  const hasSummary = Boolean(summary?.revenue && summary?.profit);

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Ledger</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Immutable financial events — read-only. Corrections happen via reversal entries.
        </p>
      </div>

      <div className="content-card" style={{ display: "flex", gap: "12px", alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="input-control" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="input-control" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Transaction type" className="input-control" style={{ minWidth: "200px" }}>
            <option value="">All types</option>
            {LEDGER_TXN_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
          Order
          <input
            type="search"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Order ID"
            aria-label="Order search"
            className="input-control"
            style={{ minWidth: "200px" }}
          />
        </label>
        <button onClick={load} className="btn-primary" style={{ minHeight: 44 }}>Apply</button>
      </div>

      {error && (
        <div role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {error} <button onClick={load} className="btn-secondary" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}

      {hasSummary && summary && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <MetricCard title="Net sales" value={inr(summary.revenue.net_exclusive)} subtitle="excl. GST" />
            <MetricCard title="Gross profit" value={inr(summary.profit.gross_profit)} subtitle={`COGS ${inr(summary.profit.cogs)}`} />
            <MetricCard
              title={estimated ? "Operating profit (ESTIMATED)" : "Operating profit"}
              value={inr(summary.profit.operating_profit)}
              subtitle={`Margin ${summary.profit.margin_pct}% · ${summary.transaction_count} txns`}
            />
          </div>
          {summary.profit.warning && (
            <p role="note" style={{ color: "var(--warning)", fontSize: "13px", fontWeight: 600, marginTop: "12px" }}>
              {summary.profit.warning}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading ledger…</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No ledger entries"
          body="No transactions match these filters. Widen the date range or clear the type filter."
          primary={{ label: "View statements", href: "/statements" }}
          secondary={{ label: "Monthly report", href: "/reports/monthly" }}
        />
      ) : (
        <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Order</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th style={{ textAlign: "right" }}>Tax</th>
                  <th style={{ textAlign: "right" }}>Net</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {t.transaction_date_ist ?? t.transaction_date ?? "-"}
                    </td>
                    <td><span className="badge-pill">{t.transaction_type}</span></td>
                    <td style={{ fontSize: "13px" }}>{t.order_id ?? "-"}</td>
                    <td className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{inr(t.amount)}</td>
                    <td className="tnum" style={{ textAlign: "right" }}>{inr(t.tax_amount)}</td>
                    <td className="tnum" style={{ textAlign: "right" }}>{inr(t.net_amount)}</td>
                    <td style={{ fontSize: "13px", color: "var(--muted)" }}>{t.reference_number ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--hairline)" }}>
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              Page {safePage + 1} of {totalPages} · {items.length} entries
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="btn-secondary" aria-label="Previous page">
                Prev
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} className="btn-secondary" aria-label="Next page">
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
