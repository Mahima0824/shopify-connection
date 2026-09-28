"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import OrderTable from "../../components/OrderTable";

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
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      
      {/* Header & Quick Action */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "32px", fontWeight: 800 }}>Orders Directory</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
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
      <div className="glass-card" style={{ padding: "16px 24px" }}>
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
        <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", padding: "12px 16px", borderRadius: "8px" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Main Table */}
      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
            Loading orders directory...
          </div>
        ) : (
          <OrderTable orders={orders} />
        )}
      </div>

    </div>
  );
}
