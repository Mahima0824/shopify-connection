
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import ScanBanner from "../components/ScanBanner";
import BarcodeScanner from "../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../components/scanner/ManualBarcodeInput";

type Last = { barcode: string; order: string; total: number; status: string } | null;

type BookingState = "IDLE" | "BOOKING" | "BOOKED" | "BOOKING_ERROR";

type ParcelInfo = { id: string; barcode: string; orderId: string; orderName: string };

type ExistingShipment = { carrier_code: string; awb_number: string } | null;

const COURIERS = ["MANUAL", "DTDC", "INDIA_POST"];

export default function DispatchPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [last, setLast] = useState<Last>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [camOn, setCamOn] = useState(false);
  const [parcel, setParcel] = useState<ParcelInfo | null>(null);
  const [existing, setExisting] = useState<ExistingShipment>(null);
  const [booking, setBooking] = useState<BookingState>("IDLE");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [courier, setCourier] = useState("MANUAL");
  const [awb, setAwb] = useState("");
  const bookingBusy = useRef(false);
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
    setParcel(null);
    setExisting(null);
    setBooking("IDLE");
    setBookingError(null);
    try {
      const looked = await api<{ parcel: any; order: any }>(`/api/v1/parcels/${barcode}`, {}, token);
      const p = looked.parcel;
      const o = looked.order;
      setParcel({ id: p.id, barcode, orderId: o?.id ?? "", orderName: o?.shopify_order_name ?? "Order" });
      if (o?.id) {
        try {
          const s = await api<{ items: any[] }>(
            `/api/v1/shipments?order_id=${encodeURIComponent(o.id)}`, {}, token);
          const hit = (s.items ?? []).find((r) => r.parcel_id === p.id);
          if (hit) setExisting({ carrier_code: hit.carrier_code, awb_number: hit.awb_number });
        } catch {
          // Shipment check is best-effort; booking will surface duplicates.
        }
      }
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

  async function bookShipment() {
    if (!parcel || bookingBusy.current) return;
    bookingBusy.current = true;
    setBooking("BOOKING");
    setBookingError(null);
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const s = await api<any>(`/api/v1/shipments/${parcel.id}/book`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ carrier_code: courier, awb_number: awb.trim() || undefined }),
      }, token);
      setExisting({ carrier_code: s.carrier_code, awb_number: s.awb_number });
      setBooking("BOOKED");
    } catch (err: any) {
      setBooking("BOOKING_ERROR");
      setBookingError(err?.message ?? "Booking failed");
    } finally {
      bookingBusy.current = false;
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--background)" }}>

     

      {/* Header */}
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Warehouse Dispatch Station</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Scan physical parcel barcodes to record dispatch events and update Shopify order state
        </p>
      </div>

      {/* Scanner card */}
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>
              BARCODE INPUT (SCANNER ACTIVE)
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-foreground" style={{ fontSize: "11px" }}>Press / to focus</span>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <input
              ref={ref}
              autoFocus
              className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type barcode (e.g. P00000001)..."
              aria-label="Parcel barcode"
              style={{ fontSize: "20px", fontWeight: 600, padding: "16px 20px" }}
            />
            <button type="submit" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full" style={{ padding: "16px 28px", whiteSpace: "nowrap" }}>
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
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
          <button type="button" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" onClick={() => setCamOn((v) => !v)}>
            {camOn ? "Stop camera" : "Use camera"}
          </button>
          <span style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>Phone camera scanning via ZXing (Code128).</span>
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

      {/* Courier booking */}
      {parcel && (
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
          <h2 style={{ fontSize: "16px", marginBottom: "4px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>
            Courier booking
          </h2>
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", marginBottom: "16px" }}>
            {parcel.orderName} · {parcel.barcode}
          </p>
          {existing ? (
            <p role="status" style={{ fontSize: "14px" }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--success-bg)] text-foreground">BOOKED</span>{" "}
              <span style={{ fontWeight: 600 }}>{existing.carrier_code} · {existing.awb_number}</span>{" "}
              <span style={{ color: "var(--muted-foreground)" }}>— shipment exists, booking skipped.</span>
            </p>
          ) : (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                aria-label="Courier"
                className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
                style={{ width: "180px" }}
                disabled={booking === "BOOKING"}
              >
                {COURIERS.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input
                className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                placeholder="AWB number (required for MANUAL)"
                aria-label="AWB number"
                style={{ flex: 1, minWidth: "200px" }}
                disabled={booking === "BOOKING"}
              />
              <button
                type="button"
                onClick={bookShipment}
                disabled={booking === "BOOKING"}
                className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full"
              >
                {booking === "BOOKING" ? "Booking…" : "Book shipment"}
              </button>
              {booking === "BOOKED" && (
                <span role="status" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--success-bg)] text-foreground">BOOKED</span>
              )}
              {booking === "BOOKING_ERROR" && bookingError && (
                <span role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "8px 12px", borderRadius: "12px", fontSize: "13px" }}>
                  {bookingError}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Grid: Last Scanned Card & History */}
      <div className="grid grid-cols-1 gap-4 min-[769px]:grid-cols-2" style={{ gap: "24px" }}>

        {/* Last Dispatched Card */}
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
          <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>
            Last Dispatched Parcel
          </h2>
          {last ? (
            <div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--foreground)" }}>{last.order}</div>
              <div style={{ display: "flex", gap: "12px", marginTop: "8px", alignItems: "center" }}>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--neutral-bg)] text-muted-foreground">{last.barcode}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--neutral-bg)] text-foreground bg-[var(--success-bg)] text-foreground">{last.status}</span>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>No scans recorded in this session.</p>
          )}
        </div>

        {/* Recent Session History */}
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
          <h2 style={{ fontSize: "16px", marginBottom: "16px", color: "var(--muted-foreground)", textTransform: "uppercase" }}>
            Recent Session Barcodes
          </h2>
          {hist.length === 0 ? (
            <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>History will populate as you scan barcodes.</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
              {hist.map((h, i) => (
                <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: "14px" }}>
                  <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{h}</span>
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
