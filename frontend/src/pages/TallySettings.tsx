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

function batchSeverity(status: string): string {
  const s = (status || "").toUpperCase();
  if (s === "FAILED") return "CRITICAL";
  if (s === "PARTIALLY_IMPORTED") return "HIGH";
  if (s === "GENERATED") return "MEDIUM";
  return "LOW";
}

export default function TallySettingsPage() {
  const [mapping, setMapping] = useState<any>({
    voucher_sales: "Sales",
    voucher_sales_return: "Sales Return",
    voucher_credit_note: "Credit Note",
    ledger_razorpay: "Razorpay Settlement",
    ledger_cod: "COD Receivable",
    ledger_sales: "Sales Account",
    ledger_cgst: "Output CGST",
    ledger_sgst: "Output SGST",
    ledger_igst: "Output IGST",
  });
  const [status, setStatus] = useState("");
  const [batches, setBatches] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  // --- FE3: validation gate + workbook export + batch lifecycle (additive) ---
  const range = useRef(defaultRange()).current;
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [validation, setValidation] = useState<TallyValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const valReq = useRef(0);
  const batchReq = useRef(0);

  const loadBatches = useCallback(() => {
    const req = ++batchReq.current;
    const isCurrent = () => batchReq.current === req;
    setBatchesLoading(true);
    setBatchesError(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    listTallyExports({}, token)
      .then((d) => {
        if (!isCurrent()) return;
        setBatches(Array.isArray((d as any)?.items) ? (d as any).items : []);
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
    api<any>("/api/v1/tally/mapping")
      .then((res) => { if (res) setMapping(res); })
      .catch(() => {});

    loadBatches();
  }, [loadBatches]);

  const handleValidate = useCallback(() => {
    const req = ++valReq.current;
    const isCurrent = () => valReq.current === req;
    setValidating(true);
    setValidateError(null);
    setExportError(null);
    const token = typeof window !== "undefined" ? (localStorage.getItem("token") ?? undefined) : undefined;
    validateTallyExport(
      { ...(from ? { from: isoStart(from) } : {}), ...(to ? { to: isoEnd(to) } : {}) },
      token,
    )
      .then((d) => {
        if (isCurrent()) setValidation(d);
      })
      .catch((e) => {
        if (!isCurrent()) return;
        setValidation(null);
        setValidateError(e?.message ?? "Validation failed");
      })
      .finally(() => {
        if (isCurrent()) setValidating(false);
      });
  }, [from, to]);

  const handleWorkbookExport = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const q = buildTallyRangeQuery({
        ...(from ? { from: isoStart(from) } : {}),
        ...(to ? { to: isoEnd(to) } : {}),
      });
      const res = await fetch(`${API}/api/v1/tally/export-workbook${q}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const cd = res.headers.get("content-disposition") || "";
        const filename = cd.includes("filename=")
          ? cd.split("filename=")[1].replace(/"/g, "")
          : "tally_export.xlsx";
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
        // keep default message when the body is not JSON
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
        headers: { Authorization: `Bearer ${token}` }
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

        // Refresh batches (guard: legacy endpoint returns an array, exports returns {items}).
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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1000px", background: "var(--background)" }}>

     

      {/* Header */}
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Tally ERP / Prime Integration</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Configure company accounting vouchers, payment gateways, and tax ledgers for idempotent Tally export
        </p>
      </div>

      {/* Status Notification */}
      {status && (
        <div role="status" style={{ padding: "14px 20px", background: "var(--success-bg)", border: "1px solid var(--border)", color: "var(--foreground)", borderRadius: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
          <IconSpark size={16} /> {status}
        </div>
      )}

      {/* Validation gate + workbook export (FE3, additive: mapping form below untouched) */}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", margin: 0 }}>Validate &amp; Export</h2>
          <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
            Validate a period first &mdash; errors block export, warnings do not
          </p>
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--muted-foreground)", minWidth: "180px", flex: "0 1 200px" }}>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" style={{ width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--muted-foreground)", minWidth: "180px", flex: "0 1 200px" }}>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" style={{ width: "100%" }} />
          </label>
          <button onClick={handleValidate} disabled={validating} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ minHeight: 44 }}>
            {validating ? "Validating..." : "Validate"}
          </button>
          <button
            onClick={handleWorkbookExport}
            disabled={exporting || validating || blocked}
            className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full"
            style={{ minHeight: 44 }}
            title={blocked ? "Export blocked - fix validation errors first" : "Download validated workbook (.xlsx)"}
          >
            {exporting ? "Generating workbook..." : "Generate workbook (.xlsx)"}
          </button>
        </div>

        {validateError && (
          <div role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>
            {validateError} <button onClick={handleValidate} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
          </div>
        )}
        {exportError && (
          <div role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>
            {exportError}
          </div>
        )}
        {exportMsg && (
          <p role="status" style={{ color: "var(--success)", fontWeight: 600, margin: 0 }}>{exportMsg}</p>
        )}

        {validation && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <span style={{ fontSize: "13px", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                Validation
              </span>
              <span className={validation.can_export ? "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--success-bg)] text-foreground" : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--error-bg)] text-foreground"}>
                {validation.can_export ? "PASSED" : "BLOCKED"}
              </span>
              {!validation.can_export && (
                <span style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
                  Export is disabled until the errors below are fixed
                </span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" }}>
              <MetricCard title="Valid" value={`${validation.valid} valid`} subtitle={`${validation.transactions} transactions`} />
              <MetricCard title="Errors" value={`${validation.error_count} errors`} subtitle={validation.already_exported ? `${validation.already_exported} already exported` : "blocking must be zero"} />
              <MetricCard title="Warnings" value={`${validation.warning_count} warnings`} subtitle={`${validation.fresh} fresh to export`} />
            </div>
            {validation.errors.length > 0 && (
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", margin: 0, padding: 0 }}>
                {validation.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "10px", fontSize: "13px" }}>
                    <SeverityBadge severity="HIGH" />
                    <span><strong>{e.code}</strong>: {e.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {validation.warnings.length > 0 && (
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", margin: "8px 0 0", padding: 0 }}>
                {validation.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "10px", fontSize: "13px" }}>
                    <SeverityBadge severity="MEDIUM" />
                    <span><strong>{w.code}</strong>: {w.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Mapping Configuration Card */}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">

        <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", marginBottom: "16px" }}>Voucher Types Configuration</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Sales Voucher Name</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.voucher_sales || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Sales Return Voucher Name</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.voucher_sales_return || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales_return: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Credit Note Voucher Name</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.voucher_credit_note || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_credit_note: e.target.value })}
            />
          </div>
        </div>

        <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", marginBottom: "16px" }}>Ledger Mappings</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Sales Account Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_sales || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_sales: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Razorpay Settlement Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_razorpay || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_razorpay: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>COD Receivable Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_cod || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_cod: e.target.value })}
            />
          </div>
        </div>

        <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", marginBottom: "16px" }}>Tax Ledgers (GST)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Output CGST Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_cgst || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_cgst: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Output SGST Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_sgst || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_sgst: e.target.value })}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>Output IGST Ledger</label>
            <input
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={mapping.ledger_igst || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_igst: e.target.value })}
            />
          </div>
        </div>

        {/* Save & Export Action Buttons */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
          <button onClick={handleSave} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ padding: "12px 24px" }}>
            <span style={{ display: "inline-flex", marginRight: "8px" }}><IconBox size={16} /></span>
            Save Ledger Mappings
          </button>
          <button onClick={handleTallyExport} disabled={exporting} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" style={{ padding: "12px 28px" }}>
            <span style={{ display: "inline-flex", marginRight: "8px" }}><IconReceipt size={16} /></span>
            {exporting ? "Generating Batch..." : "Generate & Download Tally Export Batch"}
          </button>
        </div>

      </div>

      {/* Export Batches History */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "18px", margin: 0 }}>Export Batch History</h2>
          <button onClick={loadBatches} disabled={batchesLoading} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ minHeight: 36 }}>
            {batchesLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {batchesError && (
          <div role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", margin: "16px 24px 0", borderRadius: "12px" }}>
            {batchesError} <button onClick={loadBatches} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginLeft: "12px" }}>Retry</button>
          </div>
        )}

        {batchesLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--muted-foreground)" }}>Loading batches&hellip;</div>
        ) : batches.length === 0 ? (
          <div style={{ padding: "24px" }}>
            <EmptyState
              title="No export batches yet"
              body="Validate a period above, then generate your first Tally workbook."
              primary={{ label: "View ledger", href: "/finance/ledger" }}
            />
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Created</th>
                  <th style={{ textAlign: "right" }}>Count</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const sev = batchSeverity(b.status);
                  const count = b.transaction_count ?? b.record_count;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--foreground)" }}>{b.file_name || `${b.batch_reference}.xlsx`}</div>
                        <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{b.batch_reference}</div>
                      </td>
                      <td style={{ color: "var(--muted-foreground)", fontSize: "13px", whiteSpace: "nowrap" }}>
                        {b.created_at ? new Date(b.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{count}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <SeverityBadge severity={sev} />
                          <span style={{ fontSize: "12px", fontWeight: 700 }}>{b.status}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {String(b.status || "").toUpperCase() === "IMPORTED" ? (
                          <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>Done</span>
                        ) : (
                          <button
                            onClick={() => handleMarkImported(b.id)}
                            disabled={markingId === b.id}
                            className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full"
                            aria-label={`Mark imported ${b.id}`}
                          >
                            {markingId === b.id ? "Marking..." : "Mark imported"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
