import React, { useCallback, useEffect, useRef, useState } from "react";
import { API, api } from "../lib/api";
import {
  TallyValidation,
  buildTallyRangeQuery,
  listTallyExports,
  markTallyImported,
  validateTallyExport,
} from "../lib/api";
import MetricCard from "../components/MetricCard";
import SeverityBadge from "../components/SeverityBadge";
import EmptyState from "../components/EmptyState";
import { IconBox, IconReceipt, IconSpark } from "../components/icons";
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

type ExportBatchRow = {
  id: string;
  batch_reference: string;
  period_start?: string;
  period_end?: string;
  record_count?: number;
  transaction_count?: number;
  status: string;
  file_name?: string;
  created_at: string;
};

function batchSeverity(status: string): string {
  const s = (status ?? "").toUpperCase();
  if (s === "IMPORTED") return "LOW";
  if (s === "EXPORTED") return "MEDIUM";
  return "HIGH";
}

export default function TallySettingsPage() {
  const [mapping, setMapping] = useState<any>({
    voucher_sales: "Sales",
    voucher_sales_return: "Sales Return",
    voucher_credit_note: "Credit Note",
    ledger_sales: "Sales Account",
    ledger_razorpay: "Razorpay Settlement",
    ledger_cod: "Cash On Delivery Receivable",
    ledger_cgst: "Output CGST",
    ledger_sgst: "Output SGST",
    ledger_igst: "Output IGST",
  });
  const [status, setStatus] = useState<string | null>(null);

  // Range and validation state
  const range = defaultRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<TallyValidation | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);

  // Export action state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // Batches history state
  const [batches, setBatches] = useState<ExportBatchRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    api<any>("/api/v1/tally/mapping")
      .then((data) => {
        if (data && Object.keys(data).length > 0) {
          setMapping(data);
        }
      })
      .catch(() => {});
  }, []);

  const loadBatches = useCallback(() => {
    const req = ++reqRef.current;
    const isCurrent = () => reqRef.current === req;
    setBatchesLoading(true);
    setBatchesError(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    listTallyExports({}, token)
      .then((d) => {
        if (!isCurrent()) return;
        setBatches((d.items ?? []) as ExportBatchRow[]);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        setBatches([]);
        setBatchesError(e?.message ?? "Failed to load export batches");
      })
      .finally(() => {
        if (isCurrent()) setBatchesLoading(false);
      });
  }, []);

  useEffect(() => {
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidate = useCallback(() => {
    setValidating(true);
    setValidateError(null);
    setExportError(null);
    setExportMsg(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    validateTallyExport(
      {
        from: isoStart(from),
        to: isoEnd(to),
      },
      token,
    )
      .then((v) => {
        setValidation(v);
      })
      .catch((e) => {
        setValidation(null);
        setValidateError(e?.message ?? "Validation failed");
      })
      .finally(() => {
        setValidating(false);
      });
  }, [from, to]);

  const handleWorkbookExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    setExportMsg(null);
    try {
      const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? "") : "";
      const qs = buildTallyRangeQuery({ from: isoStart(from), to: isoEnd(to) });
      const res = await fetch(`${API}/api/v1/tally/export-workbook?${qs}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const cd = res.headers.get("content-disposition") || "";
        const match = /filename="?([^";]+)"?/.exec(cd);
        const filename = match ? match[1] : `tally_workbook_${from}_${to}.xlsx`;
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
        setExportMsg(`Workbook ${filename} downloaded - mark it imported after posting to Tally.`);
        loadBatches();
        return;
      }
      let code = "";
      let message = "Failed to export workbook";
      try {
        const errJson = await res.json();
        code = errJson?.error?.code ?? errJson?.code ?? "";
        message = errJson?.error?.message ?? errJson?.detail ?? message;
      } catch {
        // keep default
      }
      if (res.status === 409 || code === "DUPLICATE_EXPORT" || code === "ALREADY_EXPORTED") {
        setExportError(
          `Already exported for this period - nothing new to download. ${message} Adjust the date range or mark the original batch imported.`,
        );
      } else if (res.status === 422 || code === "VALIDATION_FAILED") {
        setExportError(`Export blocked by validation - run Validate and fix the listed errors. ${message}`);
        handleValidate();
      } else if (res.status === 404 || code === "NOTHING_TO_EXPORT") {
        setExportError(`Nothing to export in this period - widen the date range. ${message}`);
      } else {
        setExportError(`Export error: ${message}`);
      }
    } catch (e: any) {
      setExportError(`Error: ${e?.message ?? "Failed to export workbook"}`);
    } finally {
      setExporting(false);
    }
  }, [from, to, loadBatches, handleValidate]);

  const handleMarkImported = useCallback(async (id: string) => {
    setMarkingId(id);
    setBatchesError(null);
    try {
      const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
      await markTallyImported(id, { imported: true }, token);
      loadBatches();
    } catch (e: any) {
      setBatchesError(e?.message ?? "Failed to mark batch imported");
    } finally {
      setMarkingId(null);
    }
  }, [loadBatches]);

  const blocked = validation !== null && !validation.can_export;

  const handleSave = async () => {
    try {
      await api("/api/v1/tally/mapping", { method: "PUT", body: JSON.stringify(mapping) });
      setStatus("Mappings saved successfully!");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleTallyExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/v1/tally/export`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const cd = res.headers.get("content-disposition") || "";
        const filename = cd.includes("filename=") ? cd.split("filename=")[1].replace(/"/g, "") : "tally_export.csv";
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setStatus("Tally export batch generated and downloaded!");

        api<any>("/api/v1/tally/batches").then((r) => {
          const rows = Array.isArray(r) ? r : (r as any)?.items;
          if (Array.isArray(rows)) setBatches(rows);
          else loadBatches();
        });
      } else {
        const errJson = await res.json();
        setStatus(`Export error: ${errJson.detail || "Failed to export"}`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tally ERP / Prime Integration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure company accounting vouchers, payment gateways, and tax ledgers for idempotent Tally export
        </p>
      </div>

      {status && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm font-semibold text-foreground">
          <IconSpark size={16} /> {status}
        </div>
      )}

      {/* Validation gate + workbook export */}
      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Validate &amp; Export</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Validate a period first &mdash; errors block export, warnings do not
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
            <Label htmlFor="tally-from" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <Input
              id="tally-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
            <Label htmlFor="tally-to" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              To
            </Label>
            <Input
              id="tally-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
          </div>
          <Button variant="outline" onClick={handleValidate} disabled={validating}>
            {validating ? "Validating..." : "Validate"}
          </Button>
          <Button
            onClick={handleWorkbookExport}
            disabled={exporting || validating || blocked}
            title={blocked ? "Export blocked - fix validation errors first" : "Download validated workbook (.xlsx)"}
          >
            {exporting ? "Generating workbook..." : "Generate workbook (.xlsx)"}
          </Button>
        </div>

        {validateError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{validateError}</span>
            <Button variant="outline" size="sm" onClick={handleValidate}>
              Retry
            </Button>
          </div>
        )}

        {exportError && (
          <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {exportError}
          </div>
        )}

        {exportMsg && (
          <p role="status" className="text-sm font-semibold text-success">
            {exportMsg}
          </p>
        )}

        {validation && (
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Validation
              </span>
              <Badge variant={validation.can_export ? "default" : "destructive"}>
                {validation.can_export ? "PASSED" : "BLOCKED"}
              </Badge>
              {!validation.can_export && (
                <span className="text-xs text-muted-foreground">
                  Export is disabled until the errors below are fixed
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MetricCard title="Valid" value={`${validation.valid} valid`} subtitle={`${validation.transactions} transactions`} />
              <MetricCard title="Errors" value={`${validation.error_count} errors`} subtitle={validation.already_exported ? `${validation.already_exported} already exported` : "blocking must be zero"} />
              <MetricCard title="Warnings" value={`${validation.warning_count} warnings`} subtitle={`${validation.fresh} fresh to export`} />
            </div>

            {validation.errors.length > 0 && (
              <div className="flex flex-col gap-2">
                {validation.errors.map((e, i) => (
                  <div key={`${e.code}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    <SeverityBadge severity="HIGH" />
                    <span><strong className="font-semibold text-foreground">{e.code}</strong>: {e.message}</span>
                  </div>
                ))}
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="flex flex-col gap-2">
                {validation.warnings.map((w, i) => (
                  <div key={`${w.code}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    <SeverityBadge severity="MEDIUM" />
                    <span><strong className="font-semibold text-foreground">{w.code}</strong>: {w.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Mapping Configuration Card */}
      <Card className="flex flex-col gap-6 p-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">Voucher Types Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sales Voucher Name</Label>
              <Input
                value={mapping.voucher_sales || ""}
                onChange={(e) => setMapping({ ...mapping, voucher_sales: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sales Return Voucher Name</Label>
              <Input
                value={mapping.voucher_sales_return || ""}
                onChange={(e) => setMapping({ ...mapping, voucher_sales_return: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Credit Note Voucher Name</Label>
              <Input
                value={mapping.voucher_credit_note || ""}
                onChange={(e) => setMapping({ ...mapping, voucher_credit_note: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">Ledger Mappings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sales Account Ledger</Label>
              <Input
                value={mapping.ledger_sales || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_sales: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Razorpay Settlement Ledger</Label>
              <Input
                value={mapping.ledger_razorpay || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_razorpay: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">COD Receivable Ledger</Label>
              <Input
                value={mapping.ledger_cod || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_cod: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">Tax Ledgers (GST)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output CGST Ledger</Label>
              <Input
                value={mapping.ledger_cgst || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_cgst: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output SGST Ledger</Label>
              <Input
                value={mapping.ledger_sgst || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_sgst: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output IGST Ledger</Label>
              <Input
                value={mapping.ledger_igst || ""}
                onChange={(e) => setMapping({ ...mapping, ledger_igst: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-4 border-t border-border">
          <Button variant="outline" onClick={handleSave} className="gap-2">
            <IconBox size={16} />
            Save Ledger Mappings
          </Button>
          <Button onClick={handleTallyExport} disabled={exporting} className="gap-2">
            <IconReceipt size={16} />
            {exporting ? "Generating Batch..." : "Generate & Download Tally Export Batch"}
          </Button>
        </div>
      </Card>

      {/* Export Batches History */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Export Batch History</h2>
          <Button variant="outline" size="sm" onClick={loadBatches} disabled={batchesLoading}>
            {batchesLoading ? "Loading..." : "Refresh"}
          </Button>
        </div>

        {batchesError && (
          <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{batchesError}</span>
            <Button variant="outline" size="sm" onClick={loadBatches}>
              Retry
            </Button>
          </div>
        )}

        {batchesLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading batches&hellip;</div>
        ) : batches.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No export batches yet"
              body="Validate a period above, then generate your first Tally workbook."
              primary={{ label: "View ledger", href: "/finance/ledger" }}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const sev = batchSeverity(b.status);
                  const count = b.transaction_count ?? b.record_count;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-semibold text-foreground">
                          {b.file_name || `${b.batch_reference}.xlsx`}
                        </div>
                        <div className="text-xs text-muted-foreground">{b.batch_reference}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {b.created_at ? new Date(b.created_at).toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-foreground">
                        {count}
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <SeverityBadge severity={sev} />
                          <span className="text-xs font-bold text-foreground">{b.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {String(b.status || "").toUpperCase() === "IMPORTED" ? (
                          <span className="text-xs text-muted-foreground">Done</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMarkImported(b.id)}
                            disabled={markingId === b.id}
                            aria-label={`Mark imported ${b.id}`}
                          >
                            {markingId === b.id ? "Marking..." : "Mark imported"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
