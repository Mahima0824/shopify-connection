import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import ScanBanner from "../components/ScanBanner";
import { IconBox, IconTruck } from "../components/icons";
import BarcodeScanner from "../components/scanner/BarcodeScanner";
import ManualBarcodeInput from "../components/scanner/ManualBarcodeInput";
import { Badge, Button, Card, Input } from "../components/primitives";

import { CONDITIONS, RETURN_TYPES } from "../lib/return-options";

type Info = { parcel: any; order: any; customer: any } | null;

export default function ReturnPage() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info>(null);
  const [rtype, setRtype] = useState("CUSTOMER_RETURN");
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
    const client_scan_id = `return:${crypto.randomUUID()}`;
    try {
      const out = await api<any>(`/api/v1/scan/return`, {
        method: "POST",
        body: JSON.stringify({
          barcode: code.trim(),
          return_type: rtype,
          condition: cond,
          reason: reason || undefined,
          client_scan_id
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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Returns &amp; RTO Station
            </h1>
            <Badge variant="secondary" className="text-xs">
              Reverse Logistics
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan returned packages to log customer returns, inspect item condition, and auto-flag refunds
          </p>
        </div>
      </div>

      {/* Lookup card */}
      <Card className="p-6 border-border/80 shadow-xs">
        <form onSubmit={lookup} className="flex flex-col gap-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            SCAN RETURNED BARCODE
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
      <Card className="p-6 border-border/80 shadow-xs">
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
        <Card className="p-6 border-border/80 shadow-xs">
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">
            Order Inspection: <span>{info.order?.shopify_order_name || "Order"}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-border bg-muted/40 p-4 mb-6">
            <div>
              <span className="text-xs text-muted-foreground">Total Order Value</span>
              <div className="text-xl font-bold text-foreground">₹{info.order?.total_amount}</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Customer Name</span>
              <div className="text-lg font-semibold text-foreground">
                {info.customer ? `${info.customer.first_name ?? ""} ${info.customer.last_name ?? ""}`.trim() || "-" : "-"}
              </div>
            </div>
          </div>

          {/* Return Type Selectors */}
          <div className="mb-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              RETURN CLASSIFICATION TYPE
            </label>
            <div className="flex gap-3">
              {RETURN_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={rtype === t ? "default" : "outline"}
                  onClick={() => setRtype(t)}
                  aria-pressed={rtype === t}
                  className="flex-1 justify-center gap-2"
                >
                  {t === "CUSTOMER_RETURN" ? <IconBox size={16} /> : <IconTruck size={16} />}
                  {t === "CUSTOMER_RETURN" ? "Customer Return" : "Courier RTO"}
                </Button>
              ))}
            </div>
          </div>

          {/* Condition Selectors */}
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

          {/* Optional Reason Input */}
          <div className="mb-6 flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              NOTES / REASON (OPTIONAL)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong size sent, damaged outer box..."
              aria-label="Reason"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button type="button" onClick={confirm} className="flex-1">
              Confirm &amp; Save Return Event
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
