import React, { useEffect, useRef, useState } from "react";
import { API, api } from "../lib/api";
import AddShipmentDialog from "../components/AddShipmentDialog";
import OrderTable from "../components/OrderTable";
import ImportResult, { ImportSummary } from "../components/ImportResult";
import { Button, Card, Checkbox, Input, Label } from "../components/primitives";
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
  const [addShipmentOrder, setAddShipmentOrder] = useState<any | null>(null);

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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-bold tracking-tight text-2xl text-foreground">Orders Directory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and search all synchronized commerce orders
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSyncShopify} disabled={syncing}>
            <IconRefund size={16} />
            {syncing ? "Syncing Shopify..." : "Sync Shopify Orders"}
          </Button>
          <input ref={fileRef} type="file" accept=".csv" aria-label="Upload orders CSV" className="hidden"
            onChange={(e) => handleCsvUpload(e.target.files?.[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Importing…" : "Import CSV"}
          </Button>
        </div>
      </div>

      {importSummary && (
        <Card>
          <ImportResult summary={importSummary} />
        </Card>
      )}

      {/* Filter & Search Controls */}
      <Card className="py-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Search orders by name, customer, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Label className="cursor-pointer gap-1.5 text-[13px] whitespace-nowrap">
            <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} aria-label="Live updates" />
            Live{updatedAt ? ` · updated ${updatedAt}` : ""}
          </Label>
        </div>
      </Card>

      {/* Error Alert */}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl bg-destructive/10 px-4 py-3 text-destructive">
          <IconAlert size={16} /> {error}
        </div>
      )}

      {/* Main Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">
            Loading orders directory...
          </div>
        ) : orders.length === 0 ? (
          <div className="p-6 text-center">
            <p className="mb-4 text-muted-foreground">
              No orders yet. Sync Shopify or import a CSV to populate the directory.
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={handleSyncShopify} disabled={syncing}>
                Sync Shopify Orders
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                Import CSV
              </Button>
            </div>
          </div>
        ) : (
          <OrderTable orders={orders} onAddShipment={(o) => setAddShipmentOrder(o)} />
        )}
      </div>
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