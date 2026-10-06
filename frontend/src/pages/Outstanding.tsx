import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { slaTone } from "../lib/sla";
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/primitives";

type Row = {
  shipment_id: string;
  order_name: string | null;
  carrier_code: string;
  awb_number: string;
  tracking_status: string;
  age_days: number;
  sla_status: string;
  sla_days_used: number;
  sla_deadline: string | null;
  amount: number;
  money_status: string;
};

const TONE_BORDER: Record<string, string> = {
  critical: "border-l-4 border-l-destructive",
  warn: "border-l-4 border-l-warning",
  ok: "",
};

export default function OutstandingPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [sla, setSla] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    const qs = new URLSearchParams({ ...(sla ? { sla } : {}) });
    api<{ items: Row[] }>(`/api/v1/shipments/outstanding?${qs}`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e?.message ?? "Failed to load outstanding shipments"));
  }, [sla]);

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Outstanding Shipments
            </h1>
            <Badge variant="secondary" className="text-xs">
              SLA Tracking
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Parcels that need courier follow-up — oldest and breached first
          </p>
        </div>
      </div>

      <Card className="p-4 sm:p-5 border-border/80 shadow-xs">
        <select
          className="min-h-11 w-full max-w-[220px] rounded-md border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          value={sla}
          onChange={(e) => setSla(e.target.value)}
          aria-label="SLA band"
        >
          <option value="">All bands</option>
          <option value="NORMAL">NORMAL</option>
          <option value="APPROACHING">APPROACHING</option>
          <option value="BREACHED">BREACHED</option>
        </select>
      </Card>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="overflow-hidden p-0 border-border/80 shadow-xs">
        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Nothing outstanding. Every parcel is delivered, returned, or resolved.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>AWB</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow
                    key={r.shipment_id}
                    className={`transition-colors ${TONE_BORDER[slaTone(r.sla_status)] || ""}`}
                  >
                    <TableCell className="font-semibold text-foreground">
                      {r.order_name ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-foreground">{r.awb_number}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.tracking_status}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.age_days}d
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          slaTone(r.sla_status) === "critical"
                            ? "destructive"
                            : slaTone(r.sla_status) === "warn"
                            ? "outline"
                            : "secondary"
                        }
                      >
                        {r.sla_status} ({r.sla_days_used}d)
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">
                      ₹{Number(r.amount || 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
