import React, { useEffect, useRef, useState } from "react";
import { API, api } from "../lib/api";
import { buildOrderQuery, downloadXlsx } from "../lib/india-post";
import AddShipmentDialog from "../components/AddShipmentDialog";
import NewOrderDialog from "../components/NewOrderDialog";
import OrderTable from "../components/OrderTable";
import ImportResult, { ImportSummary } from "../components/ImportResult";
import {
  IconAlert,
  IconBox,
  IconReceipt,
  IconRefund,
  IconTag,
} from "../components/icons";

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
  const [showNew, setShowNew] = useState(false);
  const [addShipmentOrder, setAddShipmentOrder] = useState<any | null>(null);
  const [codMode, setCodMode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");

  const query = buildOrderQuery({
    search,
    status,
    cod_mode: codMode,
    date_from: dateFrom,
    date_to: dateTo,
    city,
    pincode,
  });

  const fetchOrders = (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    api<any>(`/api/v1/orders${query}`)
      .then((data) => {
        setOrders(Array.isArray(data) ? data : (data as any)?.items ?? []);
        setUpdatedAt(new Date().toLocaleTimeString());
      })
      .catch((err) => {
        if (!silent) setError(err?.message ?? "Failed to load orders from backend server");
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    fetchOrders();
  }, [search, status, codMode, dateFrom, dateTo, city, pincode]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => fetchOrders(true), 15000);
    return () => clearInterval(t);
  }, [live, search, status, codMode, dateFrom, dateTo, city, pincode]);

  const handleSyncShopify = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api("/api/v1/shopify/sync?days=30", { method: "POST" });
      await fetchOrders();
    } catch (err: any) {
      setError(err?.message ?? "Shopify Sync failed. Check API connection.");
    } finally {
      setSyncing(false);
    }
  };

  const handleCsvUpload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setImportSummary(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/imports/shopify-csv`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? "Import failed");
      setImportSummary(j.data);
      fetchOrders(true);
    } catch (err: any) {
      setError(err?.message ?? "CSV Import failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const activeFiltersCount = [codMode, dateFrom, dateTo, status, city, pincode].filter(Boolean).length;
  const inputClass =
    "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-6">
      {/* Top Header & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Orders Directory
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Search, filter, and manage synchronized commerce & India Post orders
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800 transition shadow-xs flex items-center gap-2 cursor-pointer"
            onClick={() => setShowNew(true)}
          >
            <IconBox size={16} /> + New Order
          </button>

          <button
            className="px-3.5 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition flex items-center gap-2 cursor-pointer"
            onClick={() =>
              downloadXlsx(`${API}/api/v1/orders/export/india-post.xlsx${query}`, "india-post.xlsx").catch(
                (e) => setError(e?.message ?? "Export failed")
              )
            }
          >
            <IconReceipt size={16} /> Export (.xlsx)
          </button>

          <button
            onClick={handleSyncShopify}
            disabled={syncing}
            className="px-3.5 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <IconRefund size={16} /> {syncing ? "Syncing..." : "Sync Shopify"}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            aria-label="Upload orders CSV"
            className="hidden"
            onChange={(e) => handleCsvUpload(e.target.files?.[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3.5 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <IconTag size={16} /> {uploading ? "Importing..." : "Import CSV"}
          </button>
        </div>
      </div>

      {importSummary && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          <ImportResult summary={importSummary} />
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[280px]">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs"
              placeholder="Search orders by name, customer, phone, or order ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              aria-label="Live updates"
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="bg-sky-50 text-sky-800 border border-sky-200 px-2.5 py-0.5 rounded-full font-semibold">
              Live Sync{updatedAt ? ` · ${updatedAt}` : ""}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Payment Mode</span>
            <select className={inputClass} aria-label="COD mode" value={codMode} onChange={(e) => setCodMode(e.target.value)}>
              <option value="">ALL</option>
              <option value="COD">COD</option>
              <option value="PREPAID">PREPAID</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</span>
            <select className={inputClass} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="NEW">NEW</option>
              <option value="PACKED">PACKED</option>
              <option value="DISPATCHED">DISPATCHED</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="RTO">RTO</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Date From</span>
            <input className={inputClass} type="date" aria-label="Date from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Date To</span>
            <input className={inputClass} type="date" aria-label="Date to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">City</span>
            <input className={inputClass} placeholder="Filter city" aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pincode</span>
            <input className={inputClass} placeholder="6-digit pincode" aria-label="Pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <button
              className="px-3 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition cursor-pointer disabled:opacity-40"
              onClick={() => {
                setCodMode("");
                setDateFrom("");
                setDateTo("");
                setStatus("");
                setCity("");
                setPincode("");
                setSearch("");
              }}
              disabled={activeFiltersCount === 0 && !search}
            >
              Clear {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Connection Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-medium">
            <IconAlert size={18} />
            <span><strong>Connection Warning:</strong> {error}</span>
          </div>
          <button
            className="px-3 py-1 bg-white text-red-700 border border-red-300 rounded-md text-xs font-semibold hover:bg-red-100 transition cursor-pointer"
            onClick={() => fetchOrders()}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Main Order Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-16 text-center text-slate-500 text-sm font-medium">
            Loading orders directory...
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mb-3">
              <IconBox size={24} />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">No orders found</h3>
            <p className="text-xs text-slate-500 max-w-sm mb-5">
              No orders matched your active filters or directory is empty. Sync Shopify or create a manual order.
            </p>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800 transition cursor-pointer"
                onClick={() => setShowNew(true)}
              >
                + Create New Order
              </button>
              <button
                onClick={handleSyncShopify}
                disabled={syncing}
                className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition cursor-pointer"
              >
                Sync Shopify Orders
              </button>
            </div>
          </div>
        ) : (
          <OrderTable orders={orders} onAddShipment={(o) => setAddShipmentOrder(o)} />
        )}
      </div>

      {showNew && (
        <NewOrderDialog
          open
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            fetchOrders(true);
          }}
        />
      )}

      <AddShipmentDialog
        open={!!addShipmentOrder}
        orderId={addShipmentOrder?.id ?? null}
        orderLabel={addShipmentOrder?.internal_order_number ?? undefined}
        onClose={() => setAddShipmentOrder(null)}
        onPushed={() => {
          fetchOrders(true);
        }}
        // A 502 means the AWB was committed and a retry job is queued, so the
        // row changed even though the provider refused. Refreshing is what stops
        // it still offering Add Shipment on a shipment that would now 400.
        onRecovered={() => {
          fetchOrders(true);
        }}
      />
    </div>
  );
}
