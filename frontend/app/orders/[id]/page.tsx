"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import SeverityBadge from "../../../components/SeverityBadge";
import Timeline, { TNode } from "../../../components/Timeline";
import { IconAlert, IconSpark } from "../../../components/icons";

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
      <div className="container" style={{ maxWidth: "900px", background: "var(--canvas)" }}>
        <Link href="/orders" style={{ color: "var(--muted)", fontSize: "14px" }}>← Back to Orders Directory</Link>
        <div role="alert" className="badge-danger" style={{ marginTop: "16px", padding: "24px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <IconAlert size={16} /> {error}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container" style={{ maxWidth: "900px", padding: "40px", textAlign: "center", color: "var(--muted)", background: "var(--canvas)" }}>
        Loading Order Details...
      </div>
    );
  }

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1000px", background: "var(--canvas)" }}>

     

      {/* Back Link & Header */}
      <div>
        <Link href="/orders" style={{ color: "var(--muted)", fontSize: "14px", display: "inline-block", marginBottom: "8px" }}>
          ← Back to Orders Directory
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 className="display" style={{ fontSize: "32px" }}>
            Order {order.shopify_order_name || order.internal_order_number || order.id}
          </h1>
          <span style={{ fontSize: "24px", fontWeight: 800, color: "var(--ink)" }}>
            ₹{Number(order.total_amount || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Order Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        <div className="content-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>Financial Status</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px", color: "var(--ink)" }}>{order.financial_status || "PENDING"}</div>
        </div>
        <div className="content-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>Fulfillment / Op Status</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px", color: "var(--ink)" }}>{order.operational_status || "NEW"}</div>
        </div>
        <div className="content-card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>Currency</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px", color: "var(--ink)" }}>{order.currency || "INR"}</div>
        </div>
      </div>

      {/* Reconciliation Engine Alert Block */}
      {recon && (
        <div className="content-card" style={{ borderLeft: recon.status === "RECONCILED" ? "4px solid var(--brand-mint)" : "4px solid var(--brand-coral)" }}>
          <h2 className="display" style={{ fontSize: "18px", marginBottom: "12px" }}>Reconciliation Engine Status</h2>
          {recon.status === "RECONCILED" ? (
            <div style={{ color: "var(--brand-teal)", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <IconSpark size={16} /> <span>Fully Reconciled — Operational state agrees across Shopify, physical scans, payments, and returns.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(recon.issues ?? []).map((issue) => (
                <div key={issue.code} style={{ background: "var(--soft)", padding: "12px", borderRadius: "12px", border: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: "12px" }}>
                  <SeverityBadge severity={issue.severity} />
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--ink)" }}>{issue.code}</span>
                    <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>{issue.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Order Timeline Section */}
      <div className="content-card">
        <h2 className="display" style={{ fontSize: "20px", marginBottom: "20px" }}>Order Lifecycle Timeline</h2>
        <Timeline items={timeline} />
      </div>

    </div>
  );
}
