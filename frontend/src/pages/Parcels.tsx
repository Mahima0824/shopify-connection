import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "../components/primitives";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

const STATUSES = ["", "CREATED", "PACKED", "DISPATCHED", "RETURN_RECEIVED", "RTO"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function ParcelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function load(s: string) {
    try {
      setErr(null);
      const q = s ? `?status=${encodeURIComponent(s)}` : "";
      const d = await api<{ items: ParcelRow[] }>(`/api/v1/parcels${q}`, {}, localStorage.getItem("token") ?? undefined);
      setItems(d.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => { load(""); }, []);

  async function openLabel(id: string) {
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${id}/label`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      setErr("Label failed to load — please log in again.");
      return;
    }
    window.open(URL.createObjectURL(await r.blob()), "_blank", "noopener");
  }

  async function reprint(id: string, code: string) {
    try {
      await api(`/api/v1/parcels/${id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      setNotice(`Reprint logged for ${code} — same barcode, audited.`);
    } catch (e) {
      setNotice(null);
      setErr(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Parcels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order's physical identity — one barcode per parcel, stable for life
          </p>
        </div>
        <Link to="/parcels/labels" className={buttonVariants({ size: "lg" })}>
          Labels manager
        </Link>
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <select
          className="min-h-11 w-full sm:w-[220px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={status}
          onChange={(e) => { setStatus(e.target.value); load(e.target.value); }}
          aria-label="Status filter"
        >
          <option value="">All statuses</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{items.length} parcel{items.length === 1 ? "" : "s"}</span>
      </Card>

      {err && (
        <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-success/30 bg-success/15 px-4 py-3 text-sm font-semibold text-foreground">
          {notice}
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No parcels yet"
              body="Sync orders or import a CSV — parcels are created automatically."
              primary={{ label: "Sync orders", href: "/orders" }}
              secondary={{ label: "Import CSV", href: "/import" }}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcel</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>AWB</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-semibold text-foreground">{p.parcel_code}</TableCell>
                    <TableCell className="text-foreground">{p.order_name ?? p.order_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.barcode_value}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">{p.courier ?? "—"}</TableCell>
                    <TableCell className="text-foreground">{p.awb ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(p.created_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/parcels/${p.barcode_value}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          View
                        </Link>
                        <Button variant="outline" size="sm" onClick={() => openLabel(p.id)}>
                          Print
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => reprint(p.id, p.parcel_code)}>
                          Reprint
                        </Button>
                      </div>
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
