"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import SeverityBadge from "../../components/SeverityBadge";

type Issue = {
  id: string;
  order_id: string;
  order_name: string | null;
  issue_code: string;
  severity: string;
  issue_message: string;
  resolved: boolean;
  detected_at: string | null;
};

export default function ExceptionsPage() {
  const [items, setItems] = useState<Issue[]>([]);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      const q = new URLSearchParams({ status, ...(severity ? { severity } : {}) });
      const data = await api<{ items: Issue[] }>(`/api/v1/reconciliation/issues?${q}`, {}, token);
      setItems(data.items ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status, severity]);

  async function doResolve() {
    if (!reason.trim()) return;
    try {
      const token = localStorage.getItem("token") ?? undefined;
      await api(
        `/api/v1/reconciliation/issues/${resolving!.id}/resolve`,
        { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
        token
      );
      setResolving(null);
      setReason("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      
      {/* Header */}
      <div>
        <h1 style={{ fontSize: "32px", fontWeight: 800 }}>Mismatch Exceptions Queue</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
          Review and audit system-detected operational discrepancies between Shopify, physical scans, and returns
        </p>
      </div>

      {/* Filter Tabs Bar */}
      <div className="glass-card" style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        
        {/* Status Filter Tabs */}
        <div style={{ display: "flex", gap: "8px" }}>
          {(["OPEN", "RESOLVED", "ALL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={status === s ? "btn-primary" : "btn-secondary"}
              aria-pressed={status === s}
              style={{ fontSize: "13px", padding: "8px 16px" }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Severity Select Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>SEVERITY:</label>
          <select
            className="input-control"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Severity"
            style={{ width: "160px", padding: "8px 12px" }}
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </div>

      </div>

      {/* Error Alert */}
      {error && (
        <div role="alert" style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#f87171", padding: "12px 16px", borderRadius: "8px" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Main Issues Table */}
      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
            Loading exception queue...
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
            No exception issues found matching selected filters.
          </div>
        ) : (
          <table className="modern-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Issue Code</th>
                <th>Severity</th>
                <th>Detected At</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/orders/${i.order_id}`}>
                      {i.order_name || i.order_id}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 600, color: "#ffffff" }}>{i.issue_code}</td>
                  <td>
                    <SeverityBadge severity={i.severity} />
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {i.detected_at ? new Date(i.detected_at).toLocaleString() : "-"}
                  </td>
                  <td>
                    <span className={`badge ${i.resolved ? "badge-success" : "badge-warning"}`}>
                      {i.resolved ? "RESOLVED" : "OPEN"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!i.resolved ? (
                      <button onClick={() => setResolving(i)} className="btn-primary" style={{ padding: "6px 14px", fontSize: "12px" }}>
                        Resolve Discrepancy
                      </button>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Resolved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Resolve Dialog Modal */}
      {resolving && (
        <div
          role="dialog"
          aria-label="Resolve issue"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
        >
          <div className="glass-card" style={{ width: "100%", maxWidth: "540px", padding: "32px", border: "1px solid var(--accent-primary)" }}>
            <h2 style={{ fontSize: "22px", marginBottom: "8px" }}>Resolve Discrepancy</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "20px" }}>
              {resolving.order_name || resolving.order_id}: <strong style={{ color: "#ffffff" }}>{resolving.issue_code}</strong>
            </p>

            <div style={{ background: "#0f172a", padding: "16px", borderRadius: "8px", marginBottom: "20px", fontSize: "14px", border: "1px solid #1e293b" }}>
              {resolving.issue_message}
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>
                AUDITED RESOLUTION REASON (MANDATORY)
              </label>
              <textarea
                className="input-control"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this exception is resolved (e.g. Manually inspected parcel, customer agreed to partial return)..."
                aria-label="Reason"
              />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={doResolve}
                disabled={!reason.trim()}
                className="btn-primary"
                style={{ flex: 1, padding: "12px" }}
              >
                Confirm Resolution & Audit
              </button>
              <button
                onClick={() => setResolving(null)}
                className="btn-secondary"
                style={{ padding: "12px 20px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
