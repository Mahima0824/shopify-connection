import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API, api } from "../lib/api";
import OrderTable from "../components/OrderTable";
import ImportResult, { ImportSummary } from "../components/ImportResult";
import { IconAlert, IconRefund } from "../components/icons";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchOrders = (silent = false) => {
    if (!silent) setLoading(true);
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    api<any>(`/api/v1/orders${query}`)
      .then((data) => {
        setOrders(Array.isArray(data) ? data : (data as any)?.items ?? []);
        setUpdatedAt(new Date().toLocaleTimeString());
      })
      .catch((err) => { if (!silent) setError(err?.message ?? "Failed to load orders"); })
      .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(() => {
    fetchOrders();
  }, [search]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => fetchOrders(true), 15000);
    return () => clearInterval(t);
  }, [live, search]);

  const handleSyncShopify = async () => {
    setSyncing(true);
    try {
      await api("/api/v1/shopify/sync?days=30", { method: "POST" });
      await fetchOrders();
    } catch (err: any) {
      setError(err?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCsvUpload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setImportSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/imports/shopify-csv`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? "Import failed");
      setImportSummary(j.data);
      fetchOrders(true);
    } catch (err: any) {
      setError(err?.message ?? "Import failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>

     

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", fontWeight: 700 }}>Orders Directory</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            View and search all synchronized commerce orders
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={handleSyncShopify}
          disabled={syncing}
          className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full"
        >
          <span style={{ display: "inline-flex", marginRight: "8px" }}><IconRefund size={16} /></span>
          {syncing ? "Syncing Shopify..." : "Sync Shopify Orders"}
        </button>
        <input ref={fileRef} type="file" accept=".csv" aria-label="Upload orders CSV" style={{ display: "none" }}
          onChange={(e) => handleCsvUpload(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">
          {uploading ? "Importing…" : "Import CSV"}
        </button>
        </div>
      </div>

      {importSummary && (
        <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5">
          <ImportResult summary={importSummary} />
        </div>
      )}

      {/* Filter & Search Controls */}
      <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <input
            className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
            placeholder="Search orders by name, customer, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} aria-label="Live updates" />
            Live{updatedAt ? ` · updated ${updatedAt}` : ""}
          </label>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{ padding: "12px 16px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
          <IconAlert size={16} /> {error}
        </div>
      )}

      {/* Main Table */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            Loading orders directory...
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center" }}>
            <p style={{ color: "var(--muted)", marginBottom: "16px" }}>
              No orders yet. Sync Shopify or import a CSV to populate the directory.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button onClick={handleSyncShopify} disabled={syncing} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">
                Sync Shopify Orders
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">
                Import CSV
              </button>
            </div>
          </div>
        ) : (
          <OrderTable orders={orders} />
        )}
      </div>

    </div>
  );
}
