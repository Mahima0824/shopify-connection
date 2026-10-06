import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, api } from "../lib/api";
import EmptyState from "../components/EmptyState";

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
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>Parcels</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            Every order's physical identity — one barcode per parcel, stable for life
          </p>
        </div>
        <Link to="/parcels/labels" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full" style={{ textDecoration: "none" }}>
          Labels manager
        </Link>
      </div>
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: "16px 24px", display: "flex", gap: "16px", alignItems: "center" }}>
        <select className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" value={status} onChange={(e) => { setStatus(e.target.value); load(e.target.value); }} aria-label="Status filter" style={{ width: "220px" }}>
          <option value="">All statuses</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: "13px", color: "var(--muted)" }}>{items.length} parcel{items.length === 1 ? "" : "s"}</span>
      </div>
      {err && <p role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px" }}>{err}</p>}
      {notice && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{notice}</p>}
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
        {items.length === 0 ? (
          <div style={{ padding: "24px" }}>
            <EmptyState
              title="No parcels yet"
              body="Sync orders or import a CSV — parcels are created automatically."
              primary={{ label: "Sync orders", href: "/orders" }}
              secondary={{ label: "Import CSV", href: "/import" }}
            />
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-[var(--hairline)] [&_thead_th]:bg-[var(--surface)] [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-[var(--muted)] [&_td]:border-b [&_td]:border-[var(--hairline)] [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-[var(--ink)] [&_tbody_tr:hover]:bg-[var(--surface)]" style={{ border: "none" }}>
            <thead>
              <tr><th>Parcel</th><th>Order</th><th>Barcode</th><th>Status</th><th>Courier</th><th>AWB</th><th>Created</th><th style={{ textAlign: "right" }}>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.parcel_code}</td>
                  <td>{p.order_name ?? p.order_id}</td>
                  <td>{p.barcode_value}</td>
                  <td><span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)]">{p.status}</span></td>
                  <td>{p.courier ?? "—"}</td>
                  <td>{p.awb ?? "—"}</td>
                  <td style={{ fontSize: "13px", color: "var(--muted)" }}>{fmtDate(p.created_at)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link to={`/parcels/${p.barcode_value}`} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">View</Link>{" "}
                    <button onClick={() => openLabel(p.id)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">Print</button>{" "}
                    <button onClick={() => reprint(p.id, p.parcel_code)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">Reprint</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
