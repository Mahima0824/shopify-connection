import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import ScanBanner from "../components/ScanBanner";
import BarcodeScanner from "../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../components/scanner/ManualBarcodeInput";
import { Button, Card, Input } from "../components/primitives";
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
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">RTO Station</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan courier-returned parcels to record RTO events and update order state
        </p>
      </div>

      {/* Lookup card */}
      <Card className="p-6">
        <form onSubmit={lookup} className="flex flex-col gap-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            SCAN RTO BARCODE
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              ref={ref}
              autoFocus
              className="min-h-12 flex-1 text-lg font-semibold"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan barcode to inspect parcel (e.g. P00000001)..."
              aria-label="Parcel barcode"
            />
            <Button type="submit" className="min-h-12 whitespace-nowrap px-6">
              Inspect Parcel
            </Button>
          </div>
        </form>

        {msg && !info && (
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
          onDetected={(v) => { setCode(v.trim()); lookupBarcode(v.trim()); }}
          onError={(_code, message) => setMsg({ kind: "error", text: message })}
        />
        <div className="mt-4">
          <ManualBarcodeInput onSubmit={(v) => { setCode(v); lookupBarcode(v); }} />
        </div>
      </Card>

      {/* Inspection & Confirmation Workspace */}
      {info && (
        <Card className="p-6">
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">
            RTO Inspection: <span>{info.order?.shopify_order_name || "Order"}</span>
          </h2>

          <div className="mb-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              PARCEL ITEM CONDITION
            </label>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={cond === c ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCond(c)}
                  aria-pressed={cond === c}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              NOTES / REASON (OPTIONAL)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Door locked, address incomplete..."
              aria-label="Reason"
            />
          </div>

          <div className="flex gap-3">
            <Button type="button" onClick={confirm} className="flex-1">
              Confirm &amp; Save RTO Event
            </Button>
            <Button type="button" variant="outline" onClick={() => setInfo(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
