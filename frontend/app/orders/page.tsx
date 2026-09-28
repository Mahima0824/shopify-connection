"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import OrderTable from "../../components/OrderTable";
import NavPillGroup from "../../components/NavPillGroup";
import { APP_NAV_ITEMS } from "../../lib/app-nav";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = () => {
    setLoading(true);
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    api<any>(`/api/v1/orders${query}`)
      .then((data) => setOrders(Array.isArray(data) ? data : (data as any)?.items ?? []))
      .catch((err) => setError(err?.message ?? "Failed to load orders"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [search]);

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
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

      <NavPillGroup items={APP_NAV_ITEMS} active="/orders" />

      {/* Header & Quick Action */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className="display" style={{ fontSize: "32px" }}>Orders Directory</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            View and search all synchronized commerce orders
          </p>
        </div>
        <button
          onClick={handleSyncShopify}
          disabled={syncing}
          className="btn-primary"
        >
          🔄 {syncing ? "Syncing Shopify..." : "Sync Shopify Orders"}
        </button>
      </div>

      {/* Filter & Search Controls */}
      <div style={{ padding: "16px 24px", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <input
            className="input-control"
            placeholder="🔍 Search orders by name, customer, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div role="alert" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#b91c1c", padding: "12px 16px", borderRadius: "8px" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Main Table */}
      <div style={{ padding: 0, overflow: "hidden", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>
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
