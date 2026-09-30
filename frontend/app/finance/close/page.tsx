"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../../../components/EmptyState";
import MetricCard from "../../../components/MetricCard";
import SeverityBadge from "../../../components/SeverityBadge";
import {
  CloseIssues,
  canCloseMonth,
  canReopenMonth,
  closeMonth,
  getPeriodDetail,
  reopenMonth,
} from "../../../lib/api";

function defaultMonth(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function parseMonth(month: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) return null;
  return { year, month: mon };
}

type GateRow = { key: string; label: string; count: number };

function gateRows(issues: CloseIssues | null): GateRow[] {
  const c: Record<string, number> = issues?.counts ?? {};
  const num = (k: string) => Number(c[k] ?? 0);
  return [
    { key: "unreconciled", label: "Unreconciled payments / bank rows", count: num("unreconciled_payments") + num("unreconciled_bank") },
    { key: "unexported_transactions", label: "Unexported transactions", count: num("unexported_transactions") },
    { key: "invalid_gst", label: "Invalid GST rows", count: num("invalid_gst") },
    { key: "missing_cogs", label: "Orders missing COGS", count: num("missing_cogs") },
    { key: "pending_refunds", label: "Pending refunds", count: num("pending_refunds") },
  ];
}

function gateSeverity(count: number): string {
  return count > 0 ? "HIGH" : "LOW";
}

export default function MonthClosePage() {
  const initial = useMemo(defaultMonth, []);
  const [month, setMonth] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [issues, setIssues] = useState<CloseIssues | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<CloseIssues | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback((monthStr: string) => {
    const parsed = parseMonth(monthStr);
    if (!parsed) {
      setError("Month must be YYYY-MM");
      setStatus(null);
      setIssues(null);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    setLoading(true);
    setChecking(true);
    setError(null);
    setNotice(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    getPeriodDetail(parsed.year, parsed.month, token)
      .then((d) => {
        if (!isCurrent()) return;
        setStatus(String(d.status ?? "OPEN").toUpperCase());
        setIssues(d.issues ?? null);
        setBlockers(null);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        setStatus(null);
        setIssues(null);
        setError(e?.message ?? "Failed to load period status");
      })
      .finally(() => {
        if (isCurrent()) {
          setLoading(false);
          setChecking(false);
        }
      });
  }, []);

  useEffect(() => {
    load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMonthChange = (v: string) => {
    setMonth(v);
    load(v);
  };

  const gates = gateRows(issues);
  const total = Number(issues?.total ?? gates.reduce((a, g) => a + g.count, 0));
  const checkErrors = Number(issues?.counts?.check_errors ?? 0);
  const isClosed = (status ?? "").toUpperCase() === "CLOSED";
  const privileged = canCloseMonth();
  const adminOnly = canReopenMonth();
  const blocked = total > 0;

  const handleClose = useCallback(async () => {
    const parsed = parseMonth(month);
    if (!parsed) {
      setError("Month must be YYYY-MM");
      return;
    }
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Close ${month}? No new postings will be allowed - only ADJUSTMENT corrections.`,
      );
      if (!ok) return;
    }
    setClosing(true);
    setError(null);
    setNotice(null);
    setBlockers(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    try {
      const out = await closeMonth(parsed.year, parsed.month, token);
      setStatus(String(out.status ?? "CLOSED").toUpperCase());
      if ((out as { already_closed?: boolean }).already_closed) {
        setNotice(`Period ${month} was already closed - no changes made.`);
      } else {
        setNotice(`Period ${month} closed successfully.`);
      }
      load(month);
    } catch (e: any) {
      if (e?.code === "CLOSE_BLOCKED" && e?.issues) {
        setBlockers(e.issues as CloseIssues);
        setIssues(e.issues as CloseIssues);
        setError(`Close blocked - ${e.issues.total ?? "?"} open issues remain. Fix the gates below and retry.`);
      } else {
        setError(e?.message ?? "Failed to close month");
      }
    } finally {
      setClosing(false);
    }
  }, [month, load]);

  const handleReopen = useCallback(async () => {
    const parsed = parseMonth(month);
    if (!parsed) {
      setError("Month must be YYYY-MM");
      return;
    }
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Reopen ${month}? New postings will be allowed again.`);
      if (!ok) return;
    }
    setReopening(true);
    setError(null);
    setNotice(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    try {
      const out = await reopenMonth(parsed.year, parsed.month, token);
      setStatus(String(out.status ?? "OPEN").toUpperCase());
      setNotice(`Period ${month} reopened.`);
      load(month);
    } catch (e: any) {
      setError(e?.message ?? "Failed to reopen month");
    } finally {
      setReopening(false);
    }
  }, [month, load]);

  const blockerEntries: { gate: string; refs: string[] }[] = blockers?.checks
    ? Object.entries(blockers.checks)
        .filter(([, v]) => Array.isArray(v) && v.length > 0)
        .map(([k, v]) => ({ gate: k, refs: (v as string[]).slice(0, 5) }))
    : [];

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Month close</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Five close gates must read zero before a month can be closed &mdash; closed months accept adjustments only.
        </p>
      </div>

      <div className="content-card" style={{ display: "flex", gap: "12px", alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => handleMonthChange(e.target.value)}
            aria-label="Close month"
            className="input-control"
          />
        </label>
        {status && (
          <span className={isClosed ? "badge badge-neutral" : "badge badge-success"} aria-label={`Period status ${status}`}>
            {status}
          </span>
        )}
        <button onClick={() => load(month)} disabled={checking} className="btn-secondary" style={{ minHeight: 44 }}>
          {checking ? "Running checks..." : "Run checks"}
        </button>
        {privileged && !isClosed && (
          <button
            onClick={handleClose}
            disabled={closing || blocked || !issues}
            className="btn-primary"
            style={{ minHeight: 44 }}
            title={blocked ? "Close blocked - fix the open gates first" : "Close this month"}
          >
            {closing ? "Closing..." : "Close month"}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px" }}>
          {error} <button onClick={() => load(month)} className="btn-secondary" style={{ marginLeft: "12px" }}>Retry</button>
        </div>
      )}
      {notice && (
        <p role="status" style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>{notice}</p>
      )}

      {isClosed && (
        <div className="content-card" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <SeverityBadge severity="MEDIUM" />
          <p style={{ margin: 0, fontSize: "14px", color: "var(--ink)" }}>
            Period {month} is CLOSED - only ADJUSTMENT corrections may post here.
          </p>
          {adminOnly ? (
            <button onClick={handleReopen} disabled={reopening} className="btn-secondary" style={{ minHeight: 44 }}>
              {reopening ? "Reopening..." : "Reopen month"}
            </button>
          ) : (
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              Reopening requires an ADMIN role.
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading period&hellip;</div>
      ) : issues ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
              Close gates
            </span>
            <span className={blocked ? "badge badge-danger" : "badge badge-success"}>
              {blocked ? `BLOCKED (${total})` : "CLEAR"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" }}>
            {gates.map((g) => (
              <MetricCard key={g.key} title={g.label} value={`${g.count}`} subtitle={g.count > 0 ? "must be zero" : "clear"} />
            ))}
          </div>
          <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Gate</th>
                    <th style={{ textAlign: "right" }}>Open count</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {gates.map((g) => (
                    <tr key={g.key}>
                      <td style={{ fontWeight: 600 }}>{g.label}</td>
                      <td className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{g.count}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <SeverityBadge severity={gateSeverity(g.count)} />
                          <span style={{ fontSize: "12px", fontWeight: 700 }}>
                            {g.count > 0 ? "BLOCKER" : "CLEAR"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {checkErrors > 0 && (
                    <tr>
                      <td style={{ fontWeight: 600 }}>Check errors (fail-closed)</td>
                      <td className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{checkErrors}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <SeverityBadge severity="HIGH" />
                          <span style={{ fontSize: "12px", fontWeight: 700 }}>BLOCKER</span>
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {blockerEntries.length > 0 && (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0 0", padding: 0 }}>
              {blockerEntries.map((b) => (
                <li key={b.gate} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: "10px", fontSize: "13px" }}>
                  <SeverityBadge severity="HIGH" />
                  <span><strong>{b.gate}</strong>: {b.refs.join(", ")}{blockers && (blockers.checks[b.gate] ?? []).length > 5 ? " ..." : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        !error && (
          <EmptyState
            title="No period data"
            body="Pick a month and run checks to see the five close gates."
            primary={{ label: "View ledger", href: "/finance/ledger" }}
            secondary={{ label: "Monthly report", href: "/reports/monthly" }}
          />
        )
      )}
    </div>
  );
}
