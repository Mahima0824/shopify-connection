import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, API } from "../lib/api";
import { IconAlert } from "../components/icons";
import ParcelBarcode from "../components/barcode/ParcelBarcode";
import { Badge, Button, Card } from "../components/primitives";

type ParcelData = {
  parcel: { id: string; parcel_code: string; barcode_value: string; status: string };
  order: { id: string; shopify_order_name: string; total_amount: number; financial_status: string; operational_status: string } | null;
  customer: { name: string | null; email: string | null; phone: string | null } | null;
  item_count: number;
};

export default function ParcelPage() {
  const { barcode } = useParams();
  const [data, setData] = useState<ParcelData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function openLabel() {
    if (!data) return;
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${data.parcel.id}/label`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("Label failed to load");
    const blob = await r.blob();
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  }

  async function downloadPng() {
    if (!data) return;
    const token = localStorage.getItem("token") ?? "";
    const r = await fetch(`${API}/api/v1/parcels/${data.parcel.id}/barcode.png`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error("Barcode download failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.parcel.barcode_value}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<ParcelData>(`/api/v1/parcels/${barcode!}`, {}, token)
      .then((d) => {
        setData(d);
        return api<{ items: any[] }>(`/api/v1/returns?order_id=${d.order?.id ?? ""}`, {}, token)
          .then((r) => ({ items: (r.items ?? []).filter((x: any) => x.parcel_id === d.parcel.id) }))
          .catch(() => ({ items: [] as any[] }));
      })
      .then((r) => setReturns(r.items))
      .catch((e: Error) => setErr(e.message));
  }, [barcode]);

  async function inspectReturn(rid: string) {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/returns/${rid}/inspect`, { method: "POST", body: JSON.stringify({}) }, token);
    window.location.reload();
  }

  async function closeParcel() {
    const reason = window.prompt("Close reason (required):");
    if (!reason || !reason.trim() || !data) return;
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/parcels/${data.parcel.id}/close`, { method: "POST", body: JSON.stringify({ reason }) }, token);
    window.location.reload();
  }

  if (err) {
    return (
      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 bg-background px-6 max-[480px]:px-4">
        <p role="alert" className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <IconAlert size={16} /> {err}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-[1280px] bg-background px-6 max-[480px]:px-4">
        <p className="p-10 text-center text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <Link to="/orders" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        ← Back to Orders Directory
      </Link>

      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
          Parcel {data.parcel.barcode_value}
        </h1>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span>Status:</span>
          <Badge variant="secondary">{data.parcel.status}</Badge>
        </div>
        {data.order && (
          <p className="mt-2 text-sm text-foreground">
            Order: {data.order.shopify_order_name} — ₹{data.order.total_amount}
          </p>
        )}
        {data.customer && (
          <p className="mt-1 text-sm text-muted-foreground">
            Customer: {data.customer.name ?? data.customer.email}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">Items: {data.item_count}</p>

        <div className="mt-4 max-w-[380px] rounded-xl border border-border bg-card p-4">
          <ParcelBarcode value={data.parcel.barcode_value} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={openLabel}>
            Print label
          </Button>
          <Button variant="outline" onClick={downloadPng}>
            Download barcode PNG
          </Button>
          {data.parcel.status !== "CLOSED" && (
            <Button variant="outline" onClick={closeParcel}>
              Close parcel lifecycle
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Scan this barcode with any USB scanner straight into the dispatch or return pages — no app or pairing needed.
        </p>
      </Card>

      {returns.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-bold tracking-tight text-foreground">Returns on this parcel</h2>
          <div className="flex flex-col divide-y divide-border">
            {returns.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between py-3">
                <span className="text-sm font-medium text-foreground">{r.return_type} · {r.status}</span>
                {r.status === "RECEIVED" && (
                  <Button variant="outline" size="sm" onClick={() => inspectReturn(r.id)}>
                    Mark inspected
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {msg && (
        <p role="status" className="rounded-xl border border-success/30 bg-success/15 px-4 py-3 text-sm font-semibold text-foreground">
          {msg}
        </p>
      )}
    </main>
  );
}
