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
import { IconBox, IconTag, IconAlert } from "../components/icons";

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

function getStatusBadge(status: string) {
  switch (status) {
    case "DISPATCHED":
      return <Badge variant="success">DISPATCHED</Badge>;
    case "PACKED":
      return <Badge variant="secondary">PACKED</Badge>;
    case "RETURN_RECEIVED":
      return <Badge variant="warning">RETURNED</Badge>;
    case "RTO":
      return <Badge variant="destructive">RTO</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function ParcelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(s: string) {
    try {
      setLoading(true);
      setErr(null);
      const q = s ? `?status=${encodeURIComponent(s)}` : "";
      const d = await api<{ items: ParcelRow[] }>(`/api/v1/parcels${q}`, {}, localStorage.getItem("token") ?? undefined);
      setItems(d.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold font-heading tracking-tight text-foreground">
              Parcels Directory
            </h1>
            <Badge variant="secondary" className="text-xs">
              Physical Identity
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order's physical identity — one barcode per parcel, stable for life
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/parcels/labels" className={buttonVariants({ size: "sm" })}>
            <IconTag size={15} />
            Labels manager
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            className="h-9 w-full sm:w-[220px] rounded-lg border border-input bg-background/90 px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 shadow-xs"
            value={status}
            onChange={(e) => { setStatus(e.target.value); load(e.target.value); }}
            aria-label="Status filter"
          >
            <option value="">All statuses</option>
            {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {items.length} parcel{items.length === 1 ? "" : "s"} found
        </span>
      </Card>

      {err && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <IconAlert size={16} />
          {err}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          {notice}
        </div>
      )}

      {/* Main Table Card */}
      <Card className="overflow-hidden p-0 border-border/80">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Loading parcels...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8">
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
                    <TableCell className="font-semibold text-foreground">
                      <Link to={`/parcels/${p.barcode_value}`} className="hover:text-primary transition-colors">
                        {p.parcel_code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-foreground font-medium">{p.order_name ?? p.order_id}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                        {p.barcode_value}
                      </span>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(p.status)}
                    </TableCell>
                    <TableCell className="text-foreground">{p.courier ?? "—"}</TableCell>
                    <TableCell>
                      {p.awb ? (
                        <span className="font-mono text-xs text-foreground font-semibold">{p.awb}</span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{fmtDate(p.created_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
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
