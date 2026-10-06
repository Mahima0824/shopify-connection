
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import ScanBanner from "../components/ScanBanner";
import BarcodeScanner from "../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../components/scanner/ManualBarcodeInput";
import { CONDITIONS } from "../lib/return-options";

type Info = { parcel: any; order: any; customer: any } | null;

export default function RtoPage() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info>(null);
  const [cond, setCond] = useState("GOOD");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [camOn, setCamOn] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function lookupBarcode(barcode: string) {
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

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    await lookupBarcode(barcode);
  }

  async function confirm() {
    const token = localStorage.getItem("token") ?? undefined;
    const client_scan_id = `rto:${crypto.randomUUID()}`;
    try {
      const out = await api<any>(`/api/v1/scan/rto`, {
        method: "POST",
        body: JSON.stringify({
          barcode: code.trim(),
          condition: cond,
          reason: reason || undefined,
          client_scan_id
        })
      }, token);

      setMsg({ kind: "ok", text: `RTO successfully recorded for ${out.order?.shopify_order_name || ""}` });
      setInfo(null);
      setCode("");
      setReason("");
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "RTO processing failed" });
    } finally {
      ref.current?.focus();
    }
  }

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>

      {/* Header */}
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>RTO Station</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Scan courier-returned parcels to record RTO events and update order state
        </p>
      </div>

      {/* Lookup card */}
      <div className="content-card">
        <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>
            SCAN RTO BARCODE
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

      {/* Camera + manual entry */}
      <div className="content-card">
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
          <button type="button" className="btn-secondary" onClick={() => setCamOn((v) => !v)}>
            {camOn ? "Stop camera" : "Use camera"}
          </button>
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>Phone camera scanning via ZXing (Code128).</span>
        </div>
        <BarcodeScanner
          active={camOn}
          onDetected={(v) => { setCode(v.trim()); lookupBarcode(v.trim()); }}
          onError={(code, message) => setMsg({ kind: "error", text: message })}
        />
        <div style={{ marginTop: "12px" }}>
          <ManualBarcodeInput onSubmit={(v) => { setCode(v); lookupBarcode(v); }} />
        </div>
      </div>

      {/* Inspection & Confirmation Workspace */}
      {info && (
        <div className="content-card">
          <h2 className="display" style={{ fontSize: "22px", marginBottom: "16px" }}>
            RTO Inspection: <span style={{ color: "var(--ink)" }}>{info.order?.shopify_order_name || "Order"}</span>
          </h2>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "8px" }}>
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

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>
              NOTES / REASON (OPTIONAL)
            </label>
            <input
              className="input-control"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Door locked, address incomplete..."
              aria-label="Reason"
            />
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" onClick={confirm} className="btn-primary" style={{ flex: 1, padding: "14px" }}>
              Confirm & Save RTO Event
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
