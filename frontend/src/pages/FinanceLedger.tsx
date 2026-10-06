import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../components/EmptyState";
import MetricCard from "../components/MetricCard";
import { LEDGER_TXN_TYPES, LedgerEntry, LedgerSummary, getLedgerSummary, listLedger } from "../lib/api";

const PAGE_SIZE = 20;

function isoStart(date: string): string {
  return date ? `${date}T00:00:00` : "";
}

function isoEnd(date: string): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00:00`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function inr(v: string | number): string {
  const n = Number(v ?? 0);
  // "U+20B9" (rupee sign) as a unicode escape keeps this file pure ASCII,
  // immune to encoding misinterpretation at any layer (editor/git/server/browser).
  return `\u20B9${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
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
  const reqRef = useRef(0);

  const load = useCallback(() => {
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    setLoading(true);
    setError(null);
    setPage(0);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    const listParams = {
      ...(from ? { from: isoStart(from) } : {}),
      ...(to ? { to: isoEnd(to) } : {}),
      ...(type ? { type } : {}),
      ...(orderSearch.trim() ? { order_id: orderSearch.trim() } : {}),
    };
    const listP = listLedger(listParams, token).then((d) => {
      if (isCurrent()) setItems(d.items ?? []);
    });
    const summaryP =
      from && to
        ? getLedgerSummary({ from: isoStart(from), to: isoEnd(to) }, token).then((s) => {
            if (isCurrent()) setSummary(s);
          })
        : Promise.resolve().then(() => {
            if (isCurrent()) setSummary(null);
          });
    Promise.all([listP, summaryP])
      .catch((e) => {
        // Never leave prior rows/summary visible alongside an error.
        if (!isCurrent()) return;
        setItems([]);
        setSummary(null);
        setError(e?.message ?? "Failed to load ledger");
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Ledger</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Immutable financial events &mdash; read-only. Corrections happen via reversal entries.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", gap: "12px", alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted-foreground)" }}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted-foreground)" }}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted-foreground)" }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Transaction type" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" style={{ minWidth: "200px" }}>
            <option value="">All types</option>
            {LEDGER_TXN_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted-foreground)" }}>
          Order
          <input
            type="search"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Order ID"
            aria-label="Order search"
            className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
            style={{ minWidth: "200px" }}
          />
        </label>
        <button onClick={load} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" style={{ minHeight: 44 }}>Apply</button>
      </div>

      {error && (
        <div role="alert" className="bg-[var(--destructive/10)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {error} <button onClick={load} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
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
              subtitle={`Margin ${summary.profit.margin_pct}% \u00B7 ${summary.transaction_count} txns`}
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
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>Loading ledger&hellip;</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No ledger entries"
          body="No transactions match these filters. Widen the date range or clear the type filter."
          primary={{ label: "View statements", href: "/statements" }}
          secondary={{ label: "Monthly report", href: "/reports/monthly" }}
        />
      ) : (
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted">
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
                    <td style={{ fontSize: "13px", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                      {t.transaction_date_ist ?? t.transaction_date ?? "-"}
                    </td>
                    <td><span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-muted text-foreground">{t.transaction_type}</span></td>
                    <td style={{ fontSize: "13px" }}>{t.order_id ?? "-"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>{inr(t.amount)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{inr(t.tax_amount)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{inr(t.net_amount)}</td>
                    <td style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>{t.reference_number ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
              Page {safePage + 1} of {totalPages} &middot; {items.length} entries
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" aria-label="Previous page">
                Prev
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" aria-label="Next page">
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
