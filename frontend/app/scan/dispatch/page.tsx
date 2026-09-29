"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import ScanBanner from "../../../components/ScanBanner";
import BarcodeScanner from "../../../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../../../components/scanner/ManualBarcodeInput";

type Last = { barcode: string; order: string; total: number; status: string } | null;

export default function DispatchPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [last, setLast] = useState<Last>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [camOn, setCamOn] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function submitBarcode(barcode: string) {
    if (!barcode) return;
    const token = localStorage.getItem("token") ?? undefined;
    const client_scan_id = `dispatch:${crypto.randomUUID()}`;
    try {
      await api<{ parcel: any; order: any }>(`/api/v1/parcels/${barcode}`, {}, token);
      const out = await api<{ parcel: any; order: any }>(`/api/v1/scan/dispatch`, {
        method: "POST",
        body: JSON.stringify({ barcode, client_scan_id })
      }, token);

      setLast({
        barcode,
        order: out.order?.shopify_order_name || "Order",
        total: 0,
        status: "DISPATCHED"
      });
      setMsg({ kind: "ok", text: `Successfully Dispatched ${out.order?.shopify_order_name || ""} (${barcode})` });
      setHist((h) => [barcode, ...h].slice(0, 10));
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Dispatch scan failed" });
    } finally {
      ref.current?.focus();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    if (!barcode) return;
    setCode("");
    await submitBarcode(barcode);
  }

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--canvas)" }}>

     

      {/* Header */}
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Warehouse Dispatch Station</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Scan physical parcel barcodes to record dispatch events and update Shopify order state
        </p>
      </div>

      {/* Scanner card */}
      <div className="content-card">
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>
              BARCODE INPUT (SCANNER ACTIVE)
            </label>
            <span className="badge-pill" style={{ fontSize: "11px" }}>Press / to focus</span>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <input
              ref={ref}
              autoFocus
              className="input-control"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type barcode (e.g. P00000001)..."
              aria-label="Parcel barcode"
              style={{ fontSize: "20px", fontWeight: 600, padding: "16px 20px" }}
            />
            <button type="submit" className="btn-primary" style={{ padding: "16px 28px", whiteSpace: "nowrap" }}>
              Confirm Dispatch
            </button>
          </div>
        </form>

        {/* Feedback Banner */}
        {msg && (
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
          onDetected={(v) => submitBarcode(v.trim())}
          onError={(code, message) => setMsg({ kind: "error", text: message })}
        />
        <div style={{ marginTop: "12px" }}>
          <ManualBarcodeInput onSubmit={(v) => submitBarcode(v)} />
        </div>
      </div>

      {/* Grid: Last Scanned Card & History */}
      <div className="cols-2" style={{ gap: "24px" }}>

        {/* Last Dispatched Card */}
        <div className="content-card">
          <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>
            Last Dispatched Parcel
          </h2>
          {last ? (
            <div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--ink)" }}>{last.order}</div>
              <div style={{ display: "flex", gap: "12px", marginTop: "8px", alignItems: "center" }}>
                <span className="badge badge-neutral">{last.barcode}</span>
                <span className="badge badge-success">{last.status}</span>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "14px" }}>No scans recorded in this session.</p>
          )}
        </div>

        {/* Recent Session History */}
        <div className="content-card">
          <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted)", textTransform: "uppercase" }}>
            Recent Session Barcodes
          </h2>
          {hist.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "14px" }}>History will populate as you scan barcodes.</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
              {hist.map((h, i) => (
                <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: "12px", fontSize: "14px" }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{h}</span>
                  <span style={{ color: "var(--success)", fontSize: "12px", fontWeight: 600 }}>Dispatched</span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>

    </div>
  );
}
