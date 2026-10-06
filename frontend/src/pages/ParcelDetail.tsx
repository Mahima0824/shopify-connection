import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, API } from "../lib/api";
import { IconAlert } from "../components/icons";
import ParcelBarcode from "../components/barcode/ParcelBarcode";

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

  if (err) return <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "16px", background: "var(--background)" }}><p role="alert" className="bg-[var(--destructive/10)] text-foreground" style={{ padding: "12px 16px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}><IconAlert size={16} /> {err}</p></main>;
  if (!data) return <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ background: "var(--background)" }}><p style={{ color: "var(--muted-foreground)" }}>Loading…</p></main>;
  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--background)" }}>
      
      <Link to="/orders" style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>← Back to Orders Directory</Link>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700, marginBottom: "8px" }}>Parcel {data.parcel.barcode_value}</h1>
        <p style={{ color: "var(--foreground)", fontSize: "14px" }}>Status: <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--muted-foreground)] text-foreground bg-[var(--muted-foreground)] text-muted-foreground">{data.parcel.status}</span></p>
        {data.order && (
          <p style={{ color: "var(--foreground)", fontSize: "14px", marginTop: "8px" }}>Order: {data.order.shopify_order_name} — ₹{data.order.total_amount}</p>
        )}
        {data.customer && <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "8px" }}>Customer: {data.customer.name ?? data.customer.email}</p>}
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "8px" }}>Items: {data.item_count}</p>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", marginTop: "16px", maxWidth: "380px" }}>
          <ParcelBarcode value={data.parcel.barcode_value} />
        </div>
        <button onClick={openLabel} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginTop: "16px" }}>
          Print label
        </button>
        <button onClick={downloadPng} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginTop: "16px", marginLeft: "12px" }}>
          Download barcode PNG
        </button>
        <p style={{ color: "var(--muted-foreground)", fontSize: "13px", marginTop: "12px" }}>
          Scan this barcode with any USB scanner straight into the dispatch or return pages — no app or pairing needed.
        </p>
        {data.parcel.status !== "CLOSED" && (
          <button onClick={closeParcel} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full" style={{ marginTop: "12px" }}>
            Close parcel lifecycle
          </button>
        )}
      </div>
      {returns.length > 0 && (
        <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5">
          <h2 className="font-bold tracking-tight text-foreground" style={{ fontSize: "20px", marginBottom: "12px" }}>Returns on this parcel</h2>
          {returns.map((r: any) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
              <span style={{ fontSize: "14px" }}>{r.return_type} · {r.status}</span>
              {r.status === "RECEIVED" && (
                <button onClick={() => inspectReturn(r.id)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-border bg-white text-foreground max-[480px]:w-full">Mark inspected</button>
              )}
            </div>
          ))}
        </div>
      )}
      {msg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{msg}</p>}
    </main>
  );
}
