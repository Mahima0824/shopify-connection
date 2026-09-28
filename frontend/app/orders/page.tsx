"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import OrderTable from "../../components/OrderTable";
import { IconAlert, IconRefund } from "../../components/icons";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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

  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", background: "var(--canvas)" }}>

     

      {/* Ochre sync signature band */}
      <div className="feature-card-ochre" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "32px" }}>Orders Directory</h1>
          <p style={{ color: "var(--ink)", fontSize: "14px", marginTop: "4px" }}>
            View and search all synchronized commerce orders
          </p>
        </div>
        <button
          onClick={handleSyncShopify}
          disabled={syncing}
          className="btn-primary"
        >
          <span style={{ display: "inline-flex", marginRight: "8px" }}><IconRefund size={16} /></span>
          {syncing ? "Syncing Shopify..." : "Sync Shopify Orders"}
        </button>
      </div>

      {/* Filter & Search Controls */}
      <div className="content-card" style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <input
            className="input-control"
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
        <div role="alert" className="badge-danger" style={{ padding: "12px 16px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
          <IconAlert size={16} /> {error}
        </div>
      )}

      {/* Main Table */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "16px" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            Loading orders directory...
          </div>
        ) : (
          <OrderTable orders={orders} />
        )}
      </div>

    </div>
  );
}
