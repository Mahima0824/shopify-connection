import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import LabelPreview from "../components/barcode/LabelPreview";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

export default function LabelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reprinted, setReprinted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api<{ items: ParcelRow[] }>(`/api/v1/parcels`, {}, localStorage.getItem("token") ?? undefined)
      .then((d) => setItems(d.items))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const filtered = items.filter((p) => {
    if (!query) return true;
    const q = query.trim().toUpperCase();
    return p.barcode_value.toUpperCase().includes(q) || p.parcel_code.toUpperCase().includes(q) || (p.order_name ?? "").toUpperCase().includes(q);
  });

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function reprint(p: ParcelRow) {
    try {
      await api(`/api/v1/parcels/${p.id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      setReprinted((r) => ({ ...r, [p.id]: true }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  const chosen = filtered.filter((p) => selected[p.id]);

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>
      {/* Print rules live in src/styles/globals.css; .no-print/.label are
          behavioural classes there because page-break has no utility. */}
      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>Labels manager</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>Select parcels, print labels, and audit reprints.</p>
      </div>
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search barcode, parcel, order" aria-label="Search parcels" className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2" style={{ flex: 1 }} />
        <button className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full" onClick={() => window.print()} disabled={chosen.length === 0}>
          Print Selected ({chosen.length})
        </button>
      </div>
      {err && <p role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px" }}>{err}</p>}
      {filtered.length === 0 ? (
        <EmptyState
          title="No parcels to label"
          body="Sync orders or import a CSV — parcels appear here automatically."
          primary={{ label: "Sync orders", href: "/orders" }}
          secondary={{ label: "Import CSV", href: "/import" }}
        />
      ) : (
      <div style={{ overflowX: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
      <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-[var(--hairline)] [&_thead_th]:bg-[var(--surface)] [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-[var(--muted)] [&_td]:border-b [&_td]:border-[var(--hairline)] [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-[var(--ink)] [&_tbody_tr:hover]:bg-[var(--surface)]" style={{ border: "none" }}>
        <thead>
          <tr><th>Select</th><th>Parcel</th><th>Barcode</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td><input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)} aria-label={`Select ${p.barcode_value}`} /></td>
              <td style={{ fontWeight: 600 }}>{p.parcel_code}</td>
              <td>{p.barcode_value}</td>
              <td><span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)]">{p.status}</span></td>
              <td><button onClick={() => reprint(p)} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">Reprint</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      )}
      </div>
      <div className="print-container">
        {chosen.map((p) => (
          <LabelPreview key={p.id} businessName="Recon Parcel" orderName={p.order_name ?? p.order_id} parcelCode={p.barcode_value} reprint={!!reprinted[p.id]} />
        ))}
      </div>
    </main>
  );
}
