import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import ScanBanner from "../components/ScanBanner";
import BarcodeScanner from "../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../components/scanner/ManualBarcodeInput";
import { Badge, Button, Card, Input } from "../components/primitives";

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
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Warehouse Dispatch Station</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan physical parcel barcodes to record dispatch events and update Shopify order state
        </p>
      </div>

      {/* Scanner card */}
      <Card className="p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              BARCODE INPUT (SCANNER ACTIVE)
            </label>
            <Badge variant="secondary" className="text-[11px] font-normal">
              Press / to focus
            </Badge>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              ref={ref}
              autoFocus
              className="min-h-12 flex-1 text-lg font-semibold"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type barcode (e.g. P00000001)..."
              aria-label="Parcel barcode"
            />
            <Button type="submit" className="min-h-12 whitespace-nowrap px-6">
              Confirm Dispatch
            </Button>
          </div>
        </form>

        {/* Feedback Banner */}
        {msg && (
          <div className="mt-6">
            <ScanBanner kind={msg.kind} text={msg.text} />
          </div>
        )}
      </Card>

      {/* Camera + manual entry */}
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setCamOn((v) => !v)}>
            {camOn ? "Stop camera" : "Use camera"}
          </Button>
          <span className="text-xs text-muted-foreground">Phone camera scanning via ZXing (Code128).</span>
        </div>
        <BarcodeScanner
          active={camOn}
          onDetected={(v) => submitBarcode(v.trim())}
          onError={(_code, message) => setMsg({ kind: "error", text: message })}
        />
        <div className="mt-4">
          <ManualBarcodeInput onSubmit={(v) => submitBarcode(v)} />
        </div>
      </Card>

      {/* Courier booking */}
      {parcel && (
        <Card className="p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Courier booking
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {parcel.orderName} · {parcel.barcode}
          </p>
          {existing ? (
            <p role="status" className="flex items-center gap-2 text-sm text-foreground">
              <Badge variant="secondary" className="bg-success/15 text-foreground font-semibold">BOOKED</Badge>{" "}
              <span className="font-semibold">{existing.carrier_code} · {existing.awb_number}</span>{" "}
              <span className="text-muted-foreground">— shipment exists, booking skipped.</span>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                aria-label="Courier"
                className="min-h-11 w-44 rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                disabled={booking === "BOOKING"}
              >
                {COURIERS.map((c) => <option key={c}>{c}</option>)}
              </select>
              <Input
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                placeholder="AWB number (required for MANUAL)"
                aria-label="AWB number"
                className="flex-1 min-w-[200px]"
                disabled={booking === "BOOKING"}
              />
              <Button
                type="button"
                onClick={bookShipment}
                disabled={booking === "BOOKING"}
              >
                {booking === "BOOKING" ? "Booking…" : "Book shipment"}
              </Button>
              {booking === "BOOKED" && (
                <Badge variant="secondary" className="bg-success/15 text-foreground font-semibold">
                  BOOKED
                </Badge>
              )}
              {booking === "BOOKING_ERROR" && bookingError && (
                <span role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {bookingError}
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Grid: Last Scanned Card & History */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Last Dispatched Card */}
        <Card className="p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Last Dispatched Parcel
          </h2>
          {last ? (
            <div>
              <div className="text-2xl font-extrabold text-foreground">{last.order}</div>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline">{last.barcode}</Badge>
                <Badge variant="secondary" className="bg-success/15 text-foreground">{last.status}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scans recorded in this session.</p>
          )}
        </Card>

        {/* Recent Session History */}
        <Card className="p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Session Barcodes
          </h2>
          {hist.length === 0 ? (
            <p className="text-sm text-muted-foreground">History will populate as you scan barcodes.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {hist.map((h, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-semibold text-foreground font-mono">{h}</span>
                  <Badge variant="secondary" className="bg-success/15 text-foreground text-xs font-medium">Dispatched</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
