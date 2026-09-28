"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import SeverityBadge from "../../../components/SeverityBadge";
import Timeline, { TNode } from "../../../components/Timeline";

type ReconIssue = { code: string; severity: string; message: string };
type ReconState = { status: string; issues: ReconIssue[] } | null;

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TNode[]>([]);
  const [recon, setRecon] = useState<ReconState>(null);

  useEffect(() => {
    api<any>(`/api/v1/orders/${params.id}`)
      .then((data) => setOrder(data))
      .catch((err) => setError(err?.message ?? "Failed to load order"));
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: TNode[] }>(`/api/v1/orders/${params.id}/timeline`, {}, token)
      .then((data) => setTimeline(data.items ?? []))
      .catch(() => setTimeline([]));
    api<ReconState>(`/api/v1/reconciliation/order/${params.id}`, { method: "POST" }, token)
      .then((data) => setRecon(data))
      .catch(() => setRecon(null));
  }, [params.id]);

  if (error) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <Link href="/orders" style={{ color: "var(--text-muted)", fontSize: "14px" }}>← Back to Orders Directory</Link>
        <div className="glass-card" style={{ marginTop: "16px", color: "#f87171" }}>
          ⚠️ {error}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        Loading Order Details...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      
      {/* Back Link & Header */}
      <div>
        <Link href="/orders" style={{ color: "var(--text-muted)", fontSize: "14px", display: "inline-block", marginBottom: "8px" }}>
          ← Back to Orders Directory
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: "32px", fontWeight: 800 }}>
            Order {order.shopify_order_name || order.internal_order_number || order.id}
          </h1>
          <span style={{ fontSize: "24px", fontWeight: 800, color: "var(--success)" }}>
            ₹{Number(order.total_amount || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Order Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        <div className="glass-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase" }}>Financial Status</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{order.financial_status || "PENDING"}</div>
        </div>
        <div className="glass-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase" }}>Fulfillment / Op Status</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{order.operational_status || "NEW"}</div>
        </div>
        <div className="glass-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase" }}>Currency</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{order.currency || "INR"}</div>
        </div>
      </div>

      {/* Reconciliation Engine Alert Block */}
      {recon && (
        <div className="glass-card" style={{ borderLeft: recon.status === "RECONCILED" ? "4px solid var(--success)" : "4px solid var(--danger)" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Reconciliation Engine Status</h2>
          {recon.status === "RECONCILED" ? (
            <div style={{ color: "#34d399", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <span>✅</span> <span>Fully Reconciled — Operational state agrees across Shopify, physical scans, payments, and returns.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(recon.issues ?? []).map((issue) => (
                <div key={issue.code} style={{ background: "rgba(239, 68, 68, 0.1)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", alignItems: "center", gap: "12px" }}>
                  <SeverityBadge severity={issue.severity} />
                  <div>
                    <span style={{ fontWeight: 600, color: "#ffffff" }}>{issue.code}</span>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>{issue.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Order Timeline Section */}
      <div className="glass-card">
        <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Order Lifecycle Timeline</h2>
        <Timeline items={timeline} />
      </div>

    </div>
  );
}
