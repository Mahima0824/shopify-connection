import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import SeverityBadge from "../components/SeverityBadge";
import { IconAlert } from "../components/icons";

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
  const [category, setCategory] = useState("");
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      const q = new URLSearchParams({ status, ...(severity ? { severity } : {}), ...(category ? { category } : {}) });
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
  }, [status, severity, category]);

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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>

     

      {/* Header */}
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Mismatch Exceptions Queue</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Review and audit system-detected operational discrepancies between Shopify, physical scans, and returns
        </p>
      </div>

      {/* Filter Tabs Bar */}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>

        {/* Status Filter Tabs */}
        <div style={{ display: "flex", gap: "8px" }}>
          {(["OPEN", "RESOLVED", "ALL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={status === s ? "inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" : "inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full"}
              aria-pressed={status === s}
              style={{ fontSize: "13px", padding: "8px 16px" }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Severity Select Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontSize: "13px", color: "var(--muted-foreground)", fontWeight: 600 }}>SEVERITY:</label>
          <select
            className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
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

        {/* Category Select Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontSize: "13px", color: "var(--muted-foreground)", fontWeight: 600 }}>CATEGORY:</label>
          <select
            className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
            style={{ width: "160px", padding: "8px 12px" }}
          >
            <option value="">All Categories</option>
            <option value="COURIER">Courier</option>
            <option value="MONEY">Money</option>
            <option value="RETURNS">Returns</option>
            <option value="SLA">SLA</option>
          </select>
        </div>

      </div>

      {/* Error Alert */}
      {error && (
        <div role="alert" className="bg-[var(--destructive/10)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
          <IconAlert size={16} /> {error}
        </div>
      )}

      {/* Main Issues Table */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>
            Loading exception queue...
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>
            No exception issues found matching selected filters.
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted">
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
                    <Link to={`/orders/${i.order_id}`}>
                      {i.order_name || i.order_id}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 600, color: "var(--foreground)" }}>{i.issue_code}</td>
                  <td>
                    <SeverityBadge severity={i.severity} />
                  </td>
                  <td style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>
                    {i.detected_at ? new Date(i.detected_at).toLocaleString() : "-"}
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-muted text-foreground ${i.resolved ? "bg-[var(--success/12)] text-foreground" : "bg-[var(--warning/12)] text-foreground"}`}>
                      {i.resolved ? "RESOLVED" : "OPEN"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!i.resolved ? (
                      <button onClick={() => setResolving(i)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" style={{ padding: "6px 14px", fontSize: "12px" }}>
                        Resolve Discrepancy
                      </button>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>Resolved</span>
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
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
        >
          <div style={{ width: "100%", maxWidth: "540px", padding: "32px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "22px", marginBottom: "8px" }}>Resolve Discrepancy</h2>
            <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginBottom: "20px" }}>
              {resolving.order_name || resolving.order_id}: <strong style={{ color: "var(--foreground)" }}>{resolving.issue_code}</strong>
            </p>

            <div style={{ background: "var(--muted-foreground)", padding: "16px", borderRadius: "12px", marginBottom: "20px", fontSize: "14px", border: "1px solid var(--border)", color: "var(--foreground)" }}>
              {resolving.issue_message}
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>
                AUDITED RESOLUTION REASON (MANDATORY)
              </label>
              <textarea
                className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
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
                className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full"
                style={{ flex: 1, padding: "12px" }}
              >
                Confirm Resolution & Audit
              </button>
              <button
                onClick={() => setResolving(null)}
                className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full"
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
