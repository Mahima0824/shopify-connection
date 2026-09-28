"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

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

  useEffect(() => {
    api<any>("/api/v1/tally/mapping")
      .then((res) => { if (res) setMapping(res); })
      .catch(() => {});

    api<any[]>("/api/v1/tally/batches")
      .then((res) => { if (res) setBatches(res); })
      .catch(() => {});
  }, []);

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
      const res = await fetch("http://localhost:8000/api/v1/tally/export", {
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
        
        // Refresh batches
        api<any[]>("/api/v1/tally/batches").then((r) => { if (r) setBatches(r); });
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
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      
      {/* Header */}
      <div>
        <h1 style={{ fontSize: "32px", fontWeight: 800 }}>Tally ERP / Prime Integration</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
          Configure company accounting vouchers, payment gateways, and tax ledgers for idempotent Tally export
        </p>
      </div>

      {/* Status Notification */}
      {status && (
        <div role="status" style={{ padding: "14px 20px", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399", borderRadius: "10px", fontWeight: 600 }}>
          ✅ {status}
        </div>
      )}

      {/* Mapping Configuration Glass Card */}
      <div className="glass-card" style={{ padding: "32px" }}>
        
        <h2 style={{ fontSize: "20px", marginBottom: "16px", color: "var(--accent-primary)" }}>Voucher Types Configuration</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>Sales Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_sales || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>Sales Return Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_sales_return || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales_return: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>Credit Note Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_credit_note || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_credit_note: e.target.value })}
            />
          </div>
        </div>

        <h2 style={{ fontSize: "20px", marginBottom: "16px", color: "var(--accent-primary)" }}>Ledger Mappings</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>Sales Account Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_sales || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_sales: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>Razorpay Settlement Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_razorpay || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_razorpay: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>COD Receivable Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_cod || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_cod: e.target.value })}
            />
          </div>
        </div>

        {/* Save & Export Action Buttons */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
          <button onClick={handleSave} className="btn-secondary" style={{ padding: "12px 24px" }}>
            💾 Save Ledger Mappings
          </button>
          <button onClick={handleTallyExport} disabled={exporting} className="btn-primary" style={{ padding: "12px 28px" }}>
            📥 {exporting ? "Generating Batch..." : "Generate & Download Tally Export Batch"}
          </button>
        </div>

      </div>

      {/* Export Batches History */}
      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-color)" }}>
          <h2 style={{ fontSize: "18px", margin: 0 }}>Export Batch History</h2>
        </div>

        {batches.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
            No Tally export batches generated yet. Click "Generate & Download Tally Export Batch" above.
          </div>
        ) : (
          <table className="modern-table">
            <thead>
              <tr>
                <th>Batch Reference</th>
                <th>Record Count</th>
                <th>Status</th>
                <th>Generated At</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600, color: "#ffffff" }}>{b.batch_reference}</td>
                  <td>{b.record_count} Orders</td>
                  <td>
                    <span className="badge badge-success">{b.status}</span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
