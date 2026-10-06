import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API, api } from "../lib/api";
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

type Upload = { id: string; statement_type: string; provider: string; status: string; row_count: number };

function inr(v: string | number): string {
  const n = Number(v ?? 0);
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
    api<{ items: Upload[] }>(`/api/v1/statements`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }

  useEffect(load, []);

  async function upload() {
    if (!file) return;
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/statements/upload?type=${stype}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? j.detail ?? "Upload failed");
      setMsg(`Uploaded ${j.data.row_count} rows - open it to dry-run and process.`);
      setFile(null);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // --- Reconciliation mismatch board ---
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
        const errMessage =
          e?.status === 404
            ? "Reconciliation API not found on the backend. Restart the backend server (and run migrations) so it serves the latest code, then Retry."
            : (e?.message ?? "Failed to load reconciliation");
        setReconError(errMessage);
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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Settlement Statements
            </h1>
            <Badge variant="secondary" className="text-xs">
              Banking &amp; Settlements
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload courier / bank / gateway statements to match money against orders and shipments
          </p>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-5 border-border/80 shadow-xs">
        <select
          value={stype}
          onChange={(e) => setStype(e.target.value)}
          aria-label="Type"
          className="min-h-11 w-full max-w-[260px] rounded-md border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="COURIER_SETTLEMENT">COURIER_SETTLEMENT</option>
          <option value="BANK_STATEMENT">BANK_STATEMENT</option>
          <option value="PAYMENT_GATEWAY_STATEMENT">PAYMENT_GATEWAY_STATEMENT</option>
          <option value="COURIER_SHIPMENT_REPORT">COURIER_SHIPMENT_REPORT</option>
        </select>
        <Input
          type="file"
          accept=".csv,.xlsx"
          aria-label="Statement file"
          className="w-auto flex-1 min-w-[200px]"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button onClick={upload} disabled={!file || busy}>
          {busy ? "Uploading..." : "Upload"}
        </Button>
      </Card>

      {msg && (
        <p role="status" className="text-sm font-semibold text-success">
          {msg}
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="p-5 border-border/80 shadow-xs">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Uploads
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No statements yet. Upload a courier settlement CSV to match your first money.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm"
              >
                <Link
                  to={`/statements/${u.id}`}
                  className="font-semibold text-foreground hover:underline"
                >
                  {u.provider || u.statement_type} &middot; {u.row_count} rows &middot; {u.status}
                </Link>
                <Badge variant="secondary">{u.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div id="reconciliation" className="scroll-mt-20 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4 pt-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Reconciliation
            </h2>
            <Badge variant="secondary" className="text-xs">
              Mismatch Queue
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Expected settlements vs actual bank credits &mdash; clear the mismatch queue
          </p>
        </div>
      </div>

      {reconError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{reconError}</span>
          <Button variant="outline" size="sm" onClick={loadRecon}>
            Retry
          </Button>
        </div>
      )}

      {matchMsg && (
        <p role="status" className="text-sm font-semibold text-success">
          {matchMsg}
        </p>
      )}

      {reconLoading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Loading reconciliation&hellip;
        </div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                title="Expected settlement"
                value={inr(summary.expected_settlement)}
                subtitle="from orders + shipments"
              />
              <MetricCard
                title="Actual bank credit"
                value={inr(summary.actual_bank_credit)}
                subtitle="from bank statements"
              />
              <MetricCard
                title="Difference"
                value={inr(summary.difference)}
                subtitle={`matched ${summary.matched} \u00B7 pending ${summary.pending} \u00B7 mismatch ${summary.mismatch}`}
              />
            </div>
          )}

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mismatch queue &middot; {mismatches.length} rows
            </div>
            {mismatches.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                No mismatches. Every bank credit matches its expected settlement.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Bank reference</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mismatches.map((r) => {
                      const st = rowStatus(r);
                      return (
                        <TableRow key={r.bank_row_id}>
                          <TableCell className="font-semibold text-foreground">
                            {r.order_name || r.order_id || "—"}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                              {r.bank_reference || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-foreground">
                            {inr(r.expected_amount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-foreground">
                            {inr(r.actual_amount)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-foreground">
                            {inr(r.difference)}
                          </TableCell>
                          <TableCell>
                            <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-muted/50 border border-border/70">
                              <SeverityBadge severity={statusSeverity(st)} />
                              <span className="text-xs font-bold text-foreground">{st}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelected(r);
                                  setShipId("");
                                  setMatchMsg(null);
                                }}
                                aria-label={`Details for ${r.bank_reference || r.bank_row_id}`}
                              >
                                Details
                              </Button>
                              {privileged && isPotential(r) && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelected(r);
                                    setShipId("");
                                    setMatchMsg(null);
                                  }}
                                  aria-label={`Manual match ${r.bank_reference || r.bank_row_id}`}
                                >
                                  Manual match
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {selected && (
        <div
          role="dialog"
          aria-label="Mismatch drill-down"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4"
        >
          <Card className="w-full max-w-lg p-6">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Drill-down</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Order &rarr; payment &rarr; settlement &rarr; bank reference &middot; {selStatus}
            </p>
            <div className="my-5 flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order</span>
                <span className="font-semibold text-foreground">
                  {selected.order_name || selected.order_id || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment</span>
                <span className="font-semibold text-foreground">
                  {selected.payment_reference || selected.payment_id || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Settlement</span>
                <span className="font-semibold text-foreground">
                  {selected.gateway_settlement_reference || selected.shipment_id || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bank reference</span>
                <span className="font-semibold text-foreground font-mono">
                  {selected.bank_reference || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected / Actual / Diff</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {inr(selected.expected_amount)} / {inr(selected.actual_amount)} / {inr(selected.difference)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Match level</span>
                <span className="font-semibold text-foreground">{selected.match_level || "-"}</span>
              </div>
            </div>

            {privileged && selEligible && (
              <div className="mb-4 flex gap-2">
                <Input
                  value={shipId}
                  onChange={(e) => setShipId(e.target.value)}
                  placeholder="Shipment ID"
                  aria-label="Shipment ID"
                  className="flex-1"
                />
                <Button onClick={doManualMatch} disabled={!shipId.trim() || matchBusy}>
                  {matchBusy ? "Matching\u2026" : "Manual match"}
                </Button>
              </div>
            )}

            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
