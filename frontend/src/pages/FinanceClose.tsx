import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../components/EmptyState";
import MetricCard from "../components/MetricCard";
import SeverityBadge from "../components/SeverityBadge";
import {
  Badge,
  Button,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/primitives";
import {
  CloseIssues,
  canCloseMonth,
  canReopenMonth,
  closeMonth,
  getPeriodDetail,
  reopenMonth,
} from "../lib/api";

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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Month close</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Five close gates must read zero before a month can be closed &mdash; closed months accept adjustments only.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="close-month" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Month
          </label>
          <Input
            id="close-month"
            type="month"
            value={month}
            onChange={(e) => handleMonthChange(e.target.value)}
            aria-label="Close month"
            className="w-auto"
          />
        </div>
        {status && (
          <Badge
            variant={isClosed ? "secondary" : "default"}
            className="mb-1"
            aria-label={`Period status ${status}`}
          >
            {status}
          </Badge>
        )}
        <Button
          variant="outline"
          onClick={() => load(month)}
          disabled={checking}
        >
          {checking ? "Running checks..." : "Run checks"}
        </Button>
        {privileged && !isClosed && (
          <Button
            onClick={handleClose}
            disabled={closing || blocked || !issues}
            title={blocked ? "Close blocked - fix the open gates first" : "Close this month"}
          >
            {closing ? "Closing..." : "Close month"}
          </Button>
        )}
      </Card>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => load(month)}>
            Retry
          </Button>
        </div>
      )}

      {notice && (
        <p role="status" className="text-sm font-semibold text-success">
          {notice}
        </p>
      )}

      {isClosed && (
        <Card className="flex flex-wrap items-center gap-3 p-5 border-l-4 border-l-warning">
          <SeverityBadge severity="MEDIUM" />
          <p className="flex-1 text-sm text-foreground">
            Period {month} is CLOSED - only ADJUSTMENT corrections may post here.
          </p>
          {adminOnly ? (
            <Button variant="outline" onClick={handleReopen} disabled={reopening}>
              {reopening ? "Reopening..." : "Reopen month"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Reopening requires an ADMIN role.
            </span>
          )}
        </Card>
      )}

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading period&hellip;</div>
      ) : issues ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Close gates
            </span>
            <Badge variant={blocked ? "destructive" : "default"}>
              {blocked ? `BLOCKED (${total})` : "CLEAR"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {gates.map((g) => (
              <MetricCard
                key={g.key}
                title={g.label}
                value={`${g.count}`}
                subtitle={g.count > 0 ? "must be zero" : "clear"}
              />
            ))}
          </div>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gate</TableHead>
                    <TableHead className="text-right">Open count</TableHead>
                    <TableHead>Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gates.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-semibold text-foreground">{g.label}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-foreground">
                        {g.count}
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <SeverityBadge severity={gateSeverity(g.count)} />
                          <span className="text-xs font-bold text-foreground">
                            {g.count > 0 ? "BLOCKER" : "CLEAR"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {checkErrors > 0 && (
                    <TableRow>
                      <TableCell className="font-semibold text-foreground">
                        Check errors (fail-closed)
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-foreground">
                        {checkErrors}
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <SeverityBadge severity="HIGH" />
                          <span className="text-xs font-bold text-foreground">BLOCKER</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {blockerEntries.length > 0 && (
            <div className="flex flex-col gap-2">
              {blockerEntries.map((b) => (
                <div
                  key={b.gate}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-xs"
                >
                  <SeverityBadge severity="HIGH" />
                  <span className="text-foreground">
                    <strong className="font-semibold">{b.gate}</strong>: {b.refs.join(", ")}
                    {blockers && (blockers.checks[b.gate] ?? []).length > 5 ? " ..." : ""}
                  </span>
                </div>
              ))}
            </div>
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
