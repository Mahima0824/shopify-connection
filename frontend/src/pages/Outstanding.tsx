
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { slaTone } from "../lib/sla";

type Row = { shipment_id: string; order_name: string | null; carrier_code: string; awb_number: string; tracking_status: string; age_days: number; sla_status: string; sla_days_used: number; sla_deadline: string | null; amount: number; money_status: string };

const TONE_BG: Record<string, string> = { critical: "var(--error)", warn: "var(--warning)", ok: "transparent" };

export default function OutstandingPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [sla, setSla] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({ ...(sla ? { sla } : {}) });
    api<{ items: Row[] }>(`/api/v1/shipments/outstanding?${qs}`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load"));
  }, [sla]);
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Outstanding shipments</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Parcels that need courier follow-up — oldest and breached first
        </p>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: "16px 24px" }}>
        <select className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2" value={sla} onChange={(e) => setSla(e.target.value)} aria-label="SLA band" style={{ width: "220px" }}>
          <option value="">All bands</option>
          <option>NORMAL</option><option>APPROACHING</option><option>BREACHED</option>
        </select>
      </div>
      {error && <p role="alert" className="bg-[var(--error-bg)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px" }}>{error}</p>}
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        {items.length === 0 ? (
          <p style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)" }}>
            Nothing outstanding. Every parcel is delivered, returned, or resolved.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-foreground [&_tbody_tr:hover]:bg-muted" style={{ border: "none" }}>
            <thead><tr><th>Order</th><th>AWB</th><th>Status</th><th>Age</th><th>SLA</th><th>Amount</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.shipment_id} style={{ borderLeft: `4px solid ${TONE_BG[slaTone(r.sla_status)]}` }}>
                  <td style={{ fontWeight: 600 }}>{r.order_name ?? "-"}</td><td>{r.awb_number}</td><td>{r.tracking_status}</td>
                  <td>{r.age_days}d</td><td><span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-foreground">{r.sla_status} ({r.sla_days_used}d)</span></td><td className="tabular-nums">₹{Number(r.amount || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
