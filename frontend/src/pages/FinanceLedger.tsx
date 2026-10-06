import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../components/EmptyState";
import MetricCard from "../components/MetricCard";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/primitives";
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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Financial Ledger
            </h1>
            <Badge variant="secondary" className="text-xs">
              Audit Trail
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Immutable financial events &mdash; read-only. Corrections happen via reversal entries.
          </p>
        </div>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-5 border-border/80 shadow-xs">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-from" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            From
          </Label>
          <Input
            id="ledger-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="w-auto"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-to" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            To
          </Label>
          <Input
            id="ledger-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="w-auto"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-type" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Type
          </Label>
          <select
            id="ledger-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Transaction type"
            className="min-h-11 min-w-[200px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">All types</option>
            {LEDGER_TXN_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <Label htmlFor="ledger-order" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Order
          </Label>
          <Input
            id="ledger-order"
            type="search"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Order ID"
            aria-label="Order search"
          />
        </div>
        <Button onClick={load}>Apply</Button>
      </Card>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {hasSummary && summary && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard title="Net sales" value={inr(summary.revenue.net_exclusive)} subtitle="excl. GST" />
            <MetricCard title="Gross profit" value={inr(summary.profit.gross_profit)} subtitle={`COGS ${inr(summary.profit.cogs)}`} />
            <MetricCard
              title={estimated ? "Operating profit (ESTIMATED)" : "Operating profit"}
              value={inr(summary.profit.operating_profit)}
              subtitle={`Margin ${summary.profit.margin_pct}% \u00B7 ${summary.transaction_count} txns`}
            />
          </div>
          {summary.profit.warning && (
            <p role="note" className="text-xs font-semibold text-warning">
              {summary.profit.warning}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading ledger&hellip;</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No ledger entries"
          body="No transactions match these filters. Widen the date range or clear the type filter."
          primary={{ label: "View statements", href: "/statements" }}
          secondary={{ label: "Monthly report", href: "/reports/monthly" }}
        />
      ) : (
        <Card className="overflow-hidden p-0 border-border/80 shadow-xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {t.transaction_date_ist ?? t.transaction_date ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-semibold">{t.transaction_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.order_id ? (
                        <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                          {t.order_id}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">
                      {inr(t.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {inr(t.tax_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground font-semibold">
                      {inr(t.net_amount)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {t.reference_number ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Page {safePage + 1} of {totalPages} &middot; {items.length} entries
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Previous page"
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
