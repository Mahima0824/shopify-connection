import React, { useEffect, useRef, useState } from "react";
import { API, api } from "../lib/api";
import { buildOrderQuery, downloadXlsx } from "../lib/india-post";
import AddShipmentDialog from "../components/AddShipmentDialog";
import NewOrderDialog from "../components/NewOrderDialog";
import OrderTable from "../components/OrderTable";
import ImportResult, { ImportSummary } from "../components/ImportResult";
import { Button, Card, Checkbox, Input, Label, Badge } from "../components/primitives";
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
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.detail ?? `Upload failed (${r.status})`);
      }
      setImportSummary(data);
      await fetchOrders();
    } catch (err: any) {
      setError(err.message ?? "CSV upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const activeFiltersCount = [codMode, dateFrom, dateTo, status, city, pincode].filter(Boolean).length;
  const selectClass =
    "w-full h-9 px-3 bg-card border border-border/80 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition shadow-xs";

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Orders Directory
            </h1>
            <Badge variant="secondary" className="text-xs">
              Live Pipeline
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Search, filter, and manage synchronized commerce &amp; India Post orders
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button onClick={() => setShowNew(true)} size="sm" className="shadow-xs font-semibold gap-1.5">
            <IconBox size={15} /> + New Order
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadXlsx(`${API}/api/v1/orders/export/india-post.xlsx${query}`, "india-post.xlsx").catch(
                (e) => setError(e?.message ?? "Export failed")
              )
            }
            className="shadow-xs gap-1.5"
          >
            <IconReceipt size={15} /> Export (.xlsx)
          </Button>

          <Button onClick={handleSyncShopify} disabled={syncing} variant="outline" size="sm" className="shadow-xs gap-1.5">
            <IconRefund size={15} />
            {syncing ? "Syncing..." : "Sync Shopify"}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            aria-label="Upload orders CSV"
            className="hidden"
            onChange={(e) => handleCsvUpload(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="shadow-xs gap-1.5">
            <IconTag size={15} />
            {uploading ? "Importing…" : "Import CSV"}
          </Button>
        </div>
      </div>

      {importSummary && (
        <Card className="border-border/80">
          <ImportResult summary={importSummary} />
        </Card>
      )}

      {/* Filter & Search Controls */}
      <Card className="p-4 sm:p-5 border-border/80 flex flex-col gap-4 shadow-xs">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-4">
          <Input
            placeholder="Search orders by name, customer, phone, or order ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Label className="cursor-pointer gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap flex items-center">
            <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} aria-label="Live updates" />
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
              Live{updatedAt ? ` · updated ${updatedAt}` : ""}
            </span>
          </Label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end pt-2 border-t border-border/60">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Payment Mode</span>
            <select className={selectClass} aria-label="COD mode" value={codMode} onChange={(e) => setCodMode(e.target.value)}>
              <option value="">ALL</option>
              <option value="COD">COD</option>
              <option value="PREPAID">PREPAID</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Status</span>
            <select className={selectClass} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="NEW">NEW</option>
              <option value="PACKED">PACKED</option>
              <option value="DISPATCHED">DISPATCHED</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="RTO">RTO</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Date From</span>
            <Input className="h-9" type="date" aria-label="Date from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Date To</span>
            <Input className="h-9" type="date" aria-label="Date to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">City</span>
            <Input className="h-9" placeholder="Filter city" aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Pincode</span>
            <Input className="h-9" placeholder="6-digit pincode" aria-label="Pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs"
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
            </Button>
          </div>
        </div>
      </Card>

      {/* Connection Error Alert */}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <IconAlert size={16} />
            <span><strong>Connection Warning:</strong> {error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchOrders()} className="h-7 text-xs border-destructive/30 hover:bg-destructive/10">
            Retry Connection
          </Button>
        </div>
      )}

      {/* Main Table */}
      <Card className="overflow-hidden p-0 border-border/80 shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
            <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading orders directory...
          </div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center">
            <div className="size-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
              <IconBox size={24} />
            </div>
            <h3 className="text-base font-bold font-heading text-foreground mb-1">No orders found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mb-5">
              No orders matched your active filters or directory is empty. Sync Shopify or create a manual order.
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => setShowNew(true)}>
                + Create New Order
              </Button>
              <Button variant="outline" onClick={handleSyncShopify} disabled={syncing}>
                Sync Shopify Orders
              </Button>
            </div>
          </div>
        ) : (
          <OrderTable orders={orders} onAddShipment={(o) => setAddShipmentOrder(o)} />
        )}
      </Card>

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
        onRecovered={() => {
          fetchOrders(true);
        }}
      />
    </div>
  );
}