"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { IconBox, IconReceipt, IconSpark } from "../../../components/icons";

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
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1000px", background: "var(--canvas)" }}>

     

      {/* Teal signature band */}
      <div className="feature-card-teal">
        <h1 className="display" style={{ fontSize: "32px", color: "var(--on-primary)" }}>Tally ERP / Prime Integration</h1>
        <p style={{ background: "var(--on-primary)", color: "var(--ink)", fontSize: "14px", marginTop: "12px", borderRadius: "12px", padding: "8px 12px", display: "inline-block" }}>
          Configure company accounting vouchers, payment gateways, and tax ledgers for idempotent Tally export
        </p>
      </div>

      {/* Status Notification */}
      {status && (
        <div role="status" style={{ padding: "14px 20px", background: "var(--brand-mint)", border: "1px solid var(--hairline)", color: "var(--ink)", borderRadius: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
          <IconSpark size={16} /> {status}
        </div>
      )}

      {/* Mapping Configuration Card */}
      <div className="content-card">

        <h2 className="display" style={{ fontSize: "20px", marginBottom: "16px" }}>Voucher Types Configuration</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Sales Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_sales || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Sales Return Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_sales_return || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_sales_return: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Credit Note Voucher Name</label>
            <input
              className="input-control"
              value={mapping.voucher_credit_note || ""}
              onChange={(e) => setMapping({ ...mapping, voucher_credit_note: e.target.value })}
            />
          </div>
        </div>

        <h2 className="display" style={{ fontSize: "20px", marginBottom: "16px" }}>Ledger Mappings</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Sales Account Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_sales || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_sales: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Razorpay Settlement Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_razorpay || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_razorpay: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>COD Receivable Ledger</label>
            <input
              className="input-control"
              value={mapping.ledger_cod || ""}
              onChange={(e) => setMapping({ ...mapping, ledger_cod: e.target.value })}
            />
          </div>
        </div>

        {/* Save & Export Action Buttons */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", paddingTop: "16px", borderTop: "1px solid var(--hairline)" }}>
          <button onClick={handleSave} className="btn-secondary" style={{ padding: "12px 24px" }}>
            <span style={{ display: "inline-flex", marginRight: "8px" }}><IconBox size={16} /></span>
            Save Ledger Mappings
          </button>
          <button onClick={handleTallyExport} disabled={exporting} className="btn-primary" style={{ padding: "12px 28px" }}>
            <span style={{ display: "inline-flex", marginRight: "8px" }}><IconReceipt size={16} /></span>
            {exporting ? "Generating Batch..." : "Generate & Download Tally Export Batch"}
          </button>
        </div>

      </div>

      {/* Export Batches History */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--hairline)" }}>
          <h2 className="display" style={{ fontSize: "18px", margin: 0 }}>Export Batch History</h2>
        </div>

        {batches.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)" }}>
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
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{b.batch_reference}</td>
                  <td>{b.record_count} Orders</td>
                  <td>
                    <span className="badge badge-success">{b.status}</span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: "13px" }}>
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
