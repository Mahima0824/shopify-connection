"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import ScanBanner from "../../../components/ScanBanner";

import { CONDITIONS, RETURN_TYPES } from "../../../lib/return-options";

type Info = { parcel: any; order: any; customer: any } | null;

export default function ReturnPage() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info>(null);
  const [rtype, setRtype] = useState("CUSTOMER_RETURN");
  const [cond, setCond] = useState("GOOD");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    if (!barcode) return;
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const data = await api<Info>(`/api/v1/parcels/${barcode}`, {}, token);
      setInfo(data);
      setMsg(null);
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Parcel lookup failed. Verify barcode is dispatched." });
    }
  }

  async function confirm() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const out = await api<any>(`/api/v1/scan/return`, {
        method: "POST",
        body: JSON.stringify({
          barcode: code.trim(),
          return_type: rtype,
          condition: cond,
          reason: reason || undefined
        })
      }, token);

      setMsg({ kind: "ok", text: `Return successfully recorded for ${out.order?.shopify_order_name || ""}` });
      setInfo(null);
      setCode("");
      setReason("");
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Return processing failed" });
    } finally {
      ref.current?.focus();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", margin: "0 auto" }}>
      
      {/* Header */}
      <div>
        <h1 style={{ fontSize: "32px", fontWeight: 800 }}>Returns & RTO Station</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
          Scan returned packages to log customer returns, inspect item condition, and auto-flag refunds
        </p>
      </div>

      {/* Main Barcode Lookup Box */}
      <div className="glass-card" style={{ padding: "32px" }}>
        <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-muted)" }}>
            SCAN RETURNED BARCODE
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              ref={ref}
              autoFocus
              className="input-control"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan barcode to inspect parcel (e.g. P00000001)..."
              aria-label="Parcel barcode"
              style={{ fontSize: "20px", fontWeight: 600, padding: "16px 20px" }}
            />
            <button type="submit" className="btn-primary" style={{ padding: "16px 28px", whiteSpace: "nowrap" }}>
              Inspect Parcel
            </button>
          </div>
        </form>

        {msg && !info && (
          <div style={{ marginTop: "24px" }}>
            <ScanBanner kind={msg.kind} text={msg.text} />
          </div>
        )}
      </div>

      {/* Inspection & Confirmation Workspace */}
      {info && (
        <div className="glass-card" style={{ border: "2px solid var(--accent-primary)", padding: "32px" }}>
          <h2 style={{ fontSize: "22px", marginBottom: "16px" }}>
            Order Inspection: <span style={{ color: "var(--accent-primary)" }}>{info.order?.shopify_order_name || "Order"}</span>
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px", padding: "16px", background: "#0f172a", borderRadius: "8px" }}>
            <div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Total Order Value</span>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#ffffff" }}>₹{info.order?.total_amount}</div>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Customer Name</span>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "#ffffff" }}>
                {info.customer ? `${info.customer.first_name ?? ""} ${info.customer.last_name ?? ""}`.trim() || "-" : "-"}
              </div>
            </div>
          </div>

          {/* Return Type Selectors */}
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "8px" }}>
              RETURN CLASSIFICATION TYPE
            </label>
            <div style={{ display: "flex", gap: "12px" }}>
              {RETURN_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRtype(t)}
                  aria-pressed={rtype === t}
                  className={rtype === t ? "btn-primary" : "btn-secondary"}
                  style={{ flex: 1, padding: "12px", justifyContent: "center" }}
                >
                  {t === "CUSTOMER_RETURN" ? "📦 Customer Return" : "🚚 Courier RTO"}
                </button>
              ))}
            </div>
          </div>

          {/* Condition Selectors */}
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "8px" }}>
              PARCEL ITEM CONDITION
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {CONDITIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCond(c)}
                  aria-pressed={cond === c}
                  className={cond === c ? "btn-primary" : "btn-secondary"}
                  style={{ fontSize: "13px", padding: "8px 16px" }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Reason Input */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>
              NOTES / REASON (OPTIONAL)
            </label>
            <input
              className="input-control"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong size sent, damaged outer box..."
              aria-label="Reason"
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" onClick={confirm} className="btn-primary" style={{ flex: 1, padding: "14px" }}>
              Confirm & Save Return Event
            </button>
            <button type="button" onClick={() => setInfo(null)} className="btn-secondary" style={{ padding: "14px 24px" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
