import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API, api } from "../lib/api";
import { buildOrderQuery, downloadXlsx } from "../lib/india-post";
import AddShipmentDialog from "../components/AddShipmentDialog";
import EditOrderDialog from "../components/EditOrderDialog";
import OrderDetailDialog from "../components/OrderDetailDialog";
import OrderTable from "../components/OrderTable";
import WhatsAppDialog from "../components/WhatsAppDialog";
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
  const navigate = useNavigate();
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
  const [addShipmentCourier, setAddShipmentCourier] = useState<string>("IP");
  const [editOrder, setEditOrder] = useState<any | null>(null);
  const [viewOrder, setViewOrder] = useState<any | null>(null);
  const [whatsAppOrder, setWhatsAppOrder] = useState<any | null>(null);
  const [codMode, setCodMode] = useState("");
  const [datePreset, setDatePreset] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [carrier, setCarrier] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [totalOrders, setTotalOrders] = useState(0);

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    setPage(1);
    const now = new Date();
    const fmt = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    if (preset === "TODAY") {
      const todayStr = fmt(now);
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === "YESTERDAY") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = fmt(y);
      setDateFrom(yStr);
      setDateTo(yStr);
    } else if (preset === "THIS_MONTH") {
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      setDateFrom(firstDay);
      setDateTo(lastDay);
    } else if (preset === "LAST_MONTH") {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const firstDay = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = fmt(new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0));
      setDateFrom(firstDay);
      setDateTo(lastDay);
    } else if (preset === "ALL") {
      setDateFrom("");
      setDateTo("");
    }
  };

  const query = buildOrderQuery({
    search,
    status,
    cod_mode: codMode,
    date_from: dateFrom,
    date_to: dateTo,
    city,
    pincode,
    carrier,
    page,
    page_size: pageSize,
  });

  const fetchOrders = (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    api<any>(`/api/v1/orders${query}`)
      .then((data) => {
        const rawItems = Array.isArray(data) ? data : ((data as any)?.items ?? []);
        const total = (data as any)?.total ?? rawItems.length;
        setOrders(rawItems);
        setTotalOrders(total);
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
  }, [search, status, codMode, dateFrom, dateTo, city, pincode, carrier, page, pageSize]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => fetchOrders(true), 15000);
    return () => clearInterval(t);
  }, [live, search, status, codMode, dateFrom, dateTo, city, pincode, carrier, page, pageSize]);

  const handleFilterChange = (setter: (val: any) => void, val: any) => {
    setter(val);
    setPage(1);
  };

  const handleSyncShopify = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await api<any>("/api/v1/shopify/sync?days=0", { method: "POST" });
      await fetchOrders();
      const data = res?.data ?? res;
      if (data?.error) {
        setError(`Shopify Sync Warning: ${data.error}. Please update SHOPIFY_ACCESS_TOKEN in .env.`);
      }
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

  const handleDeleteOrder = async (order: any) => {
    const name = order.shopify_order_name || order.internal_order_number || order.id;
    if (!window.confirm(`Are you sure you want to delete order ${name}? This action cannot be undone.`)) {
      return;
    }
    try {
      const token = localStorage.getItem("token") ?? undefined;
      await api(`/api/v1/orders/${order.id}`, { method: "DELETE" }, token);
      await fetchOrders(true);
    } catch (err: any) {
      alert(err?.message ?? "Failed to delete order");
    }
  };

  const activeFiltersCount = [
    codMode,
    datePreset !== "ALL" ? datePreset : (dateFrom || dateTo ? "CUSTOM" : null),
    status,
    carrier,
    city,
    pincode,
  ].filter(Boolean).length;
  const selectClass =
    "w-full h-9 px-3 bg-card border border-border/80 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition shadow-xs";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 bg-background px-3 sm:px-5">
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
            Search, filter, and manage synchronized commerce &amp; multi-courier orders
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            to="/orders/new"
            className="inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none active:scale-[0.98] bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs rounded-md shadow-xs font-semibold gap-1.5"
          >
            <IconBox size={15} /> + New Order
          </Link>

          {/* Multi-Carrier Export Dropdown Menu */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExportMenu((v) => !v)}
              className="shadow-xs gap-1.5 font-medium"
              aria-label="Export options"
            >
              <IconReceipt size={15} /> Export (.xlsx) ▾
            </Button>

            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-border bg-card p-1.5 shadow-xl z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 mb-1">
                    Select Carrier Export Format
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowExportMenu(false);
                      downloadXlsx(`${API}/api/v1/orders/export/india-post.xlsx${query}`, "india-post.xlsx").catch(
                        (e) => setError(e?.message ?? "Export failed")
                      );
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-foreground hover:bg-muted font-medium transition text-left cursor-pointer"
                  >
                    <span className="text-base">🇮🇳</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">India Post</span>
                      <span className="text-[10px] text-muted-foreground">Speed Post 48-col format</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowExportMenu(false);
                      downloadXlsx(`${API}/api/v1/orders/export/delhivery.xlsx${query}`, "delhivery.xlsx").catch(
                        (e) => setError(e?.message ?? "Export failed")
                      );
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-foreground hover:bg-muted font-medium transition text-left cursor-pointer"
                  >
                    <span className="text-base">🔴</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">Delhivery</span>
                      <span className="text-[10px] text-muted-foreground">B2C Surface &amp; Express client format</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowExportMenu(false);
                      downloadXlsx(`${API}/api/v1/orders/export/bluedart.xlsx${query}`, "bluedart.xlsx").catch(
                        (e) => setError(e?.message ?? "Export failed")
                      );
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-foreground hover:bg-muted font-medium transition text-left cursor-pointer"
                  >
                    <span className="text-base">✈️</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">Blue Dart</span>
                      <span className="text-[10px] text-muted-foreground">Express Air &amp; Surface manifest</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowExportMenu(false);
                      downloadXlsx(`${API}/api/v1/orders/export/dtdc.xlsx${query}`, "dtdc.xlsx").catch(
                        (e) => setError(e?.message ?? "Export failed")
                      );
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-foreground hover:bg-muted font-medium transition text-left cursor-pointer"
                  >
                    <span className="text-base">📦</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">DTDC</span>
                      <span className="text-[10px] text-muted-foreground">B2C Consignments Excel format</span>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

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
            placeholder="Search orders by customer name, saree name, shipment ID, AWB, or order #..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
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
            <select
              className={selectClass}
              aria-label="COD mode"
              value={codMode}
              onChange={(e) => {
                setCodMode(e.target.value);
                setPage(1);
              }}
            >
              <option value="">ALL</option>
              <option value="COD">COD</option>
              <option value="PREPAID">PREPAID</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Status</span>
            <select
              className={selectClass}
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              <option value="NEW">NEW</option>
              <option value="PACKED">PACKED</option>
              <option value="DISPATCHED">DISPATCHED</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="RTO">RTO</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Delivery Partner</span>
            <select
              className={selectClass}
              aria-label="Delivery Partner"
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Partners</option>
              <option value="INDIA_POST">🇮🇳 India Post</option>
              <option value="DELHIVERY">🔴 Delhivery</option>
              <option value="BLUEDART">✈️ Blue Dart</option>
              <option value="DTDC">📦 DTDC</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Date Range</span>
            <select
              className={selectClass}
              aria-label="Date range"
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value)}
            >
              <option value="ALL">All Dates</option>
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="LAST_MONTH">Last Month</option>
              <option value="CUSTOM">Custom Date</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">City</span>
            <Input
              className="h-9"
              placeholder="Filter city"
              aria-label="City"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading">Pincode</span>
            <Input
              className="h-9"
              placeholder="6-digit pincode"
              aria-label="Pincode"
              value={pincode}
              onChange={(e) => {
                setPincode(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              onClick={() => {
                setCodMode("");
                setDatePreset("ALL");
                setDateFrom("");
                setDateTo("");
                setStatus("");
                setCarrier("");
                setCity("");
                setPincode("");
                setSearch("");
                setPage(1);
              }}
              disabled={activeFiltersCount === 0 && !search}
            >
              Clear {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ""}
            </Button>
          </div>
        </div>

        {/* Custom Date Pickers - shown only when 'Custom Date' is selected */}
        {datePreset === "CUSTOM" && (
          <div className="flex flex-wrap items-center gap-3 pt-3 mt-1 border-t border-border/50 bg-muted/20 px-3.5 py-2.5 rounded-lg animate-in fade-in-50 duration-200">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-heading flex items-center gap-1.5">
              <span>📅</span> Custom Date Range:
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">From:</span>
              <Input
                className="h-8.5 w-38 text-xs bg-card"
                type="date"
                aria-label="Date from"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">To:</span>
              <Input
                className="h-8.5 w-38 text-xs bg-card"
                type="date"
                aria-label="Date to"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground ml-auto"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setPage(1);
                }}
              >
                Reset Custom Dates
              </Button>
            )}
          </div>
        )}
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
              <Link
                to="/orders/new"
                className="inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none active:scale-[0.98] bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 text-sm rounded-lg font-semibold gap-2 shadow-xs"
              >
                + Create New Order
              </Link>
              <Button variant="outline" onClick={handleSyncShopify} disabled={syncing}>
                Sync Shopify Orders
              </Button>
            </div>
          </div>
        ) : (
          <>
            <OrderTable
              orders={orders}
              onAddShipment={(o) => {
                setAddShipmentCourier("IP");
                setAddShipmentOrder(o);
              }}
              onEditOrder={(o) => setEditOrder(o)}
              onDeleteOrder={handleDeleteOrder}
              onViewOrder={(o) => setViewOrder(o)}
              onWhatsApp={(o) => setWhatsAppOrder(o)}
            />

            {/* On-Demand Item Pagination Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-border bg-muted/20">
              <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
                <span>
                  Showing <span className="font-bold font-mono text-foreground">{Math.min((page - 1) * pageSize + 1, totalOrders)}</span> to{" "}
                  <span className="font-bold font-mono text-foreground">{Math.min(page * pageSize, totalOrders)}</span> of{" "}
                  <span className="font-bold font-mono text-foreground">{totalOrders}</span> orders
                </span>
                
                {/* Page Size Selector */}
                <div className="flex items-center gap-1.5 ml-2 border-l border-border/80 pl-3">
                  <span className="text-[11px] text-muted-foreground">Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-7 px-2 bg-background border border-border rounded-md text-xs font-mono font-bold text-foreground focus:outline-none"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 text-xs font-semibold px-3 gap-1"
                >
                  <span>◀ Previous</span>
                </Button>

                <div className="flex items-center gap-1 text-xs font-bold font-mono px-3 py-1 rounded-lg bg-background border border-border">
                  <span>Page {page} of {Math.max(1, Math.ceil(totalOrders / pageSize))}</span>
                </div>

                {(() => {
                  const remaining = Math.max(0, totalOrders - page * pageSize);
                  const nextBatch = Math.min(pageSize, remaining);
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= Math.ceil(totalOrders / pageSize) || loading}
                      onClick={() => setPage((p) => Math.min(Math.ceil(totalOrders / pageSize), p + 1))}
                      className="h-8 text-xs font-semibold px-3 gap-1"
                    >
                      <span>Next {nextBatch > 0 ? nextBatch : pageSize} ▶</span>
                    </Button>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </Card>

      {viewOrder && (
        <OrderDetailDialog
          open={!!viewOrder}
          order={viewOrder}
          onClose={() => setViewOrder(null)}
          onEditOrder={(o) => setEditOrder(o)}
          onAddShipment={(o, courierCode) => {
            setViewOrder(null);
            setAddShipmentCourier(courierCode || "IP");
            setAddShipmentOrder(o);
          }}
        />
      )}

      {/* Edit Order Dialog */}

      {editOrder && (
        <EditOrderDialog
          open={!!editOrder}
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onSaved={() => {
            setEditOrder(null);
            fetchOrders(true);
          }}
        />
      )}

      <AddShipmentDialog
        open={!!addShipmentOrder}
        orderId={addShipmentOrder?.id ?? null}
        orderLabel={addShipmentOrder?.shopify_order_name || addShipmentOrder?.internal_order_number || undefined}
        order={addShipmentOrder}
        initialCourier={addShipmentCourier}
        onClose={() => setAddShipmentOrder(null)}
        onPushed={() => {
          fetchOrders(true);
        }}
        onRecovered={() => {
          fetchOrders(true);
        }}
      />

      {whatsAppOrder && (
        <WhatsAppDialog
          open={!!whatsAppOrder}
          order={whatsAppOrder}
          onClose={() => setWhatsAppOrder(null)}
        />
      )}
    </div>
  );
}