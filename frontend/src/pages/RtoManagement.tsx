import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, Button, Badge, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../components/primitives";
import ProductAvatar from "../components/ProductAvatar";
import WhatsAppDialog from "../components/WhatsAppDialog";
import { getRtoSummary, getRtoShipments, processRtoRecord, reconcileRtoCod } from "../lib/api";

const RTO_REASONS = [
  "Customer Refused Delivery",
  "Address Incomplete / Unlocatable",
  "Phone Unreachable / Invalid",
  "COD Cash Unavailable",
  "Delivery Delayed / Rescheduled",
  "Damaged Package / Tampered",
  "Buyer Cancelled",
  "Others"
];

const ITEM_CONDITIONS = [
  { code: "GOOD", label: "Good (Restockable to Inventory)", color: "text-emerald-600 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  { code: "DAMAGED", label: "Damaged (Scrap / Claim)", color: "text-rose-600 border-rose-500 bg-rose-50 dark:bg-rose-950/40" },
  { code: "OPENED", label: "Opened / Tampered Box", color: "text-amber-600 border-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  { code: "WRONG_ITEM", label: "Wrong Item Returned", color: "text-purple-600 border-purple-500 bg-purple-50 dark:bg-purple-950/40" },
];

export default function RtoManagement() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [shipments, setShipments] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [page, setPage] = useState(1);

  // Modals state
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [showCodModal, setShowCodModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);

  // Process RTO form
  const [rtoReason, setRtoReason] = useState("Customer Refused Delivery");
  const [itemCondition, setItemCondition] = useState("GOOD");
  const [restockInventory, setRestockInventory] = useState(true);
  const [reverseFreight, setReverseFreight] = useState<number>(120);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumRes, shipRes] = await Promise.all([
        getRtoSummary(),
        getRtoShipments({ q: searchQuery, carrier: carrierFilter, page, page_size: 15 })
      ]);
      setSummary(sumRes);
      setShipments(shipRes.items || []);
      setTotalCount(shipRes.total || 0);
    } catch (err) {
      console.error("Failed to load RTO data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchQuery, carrierFilter, page]);

  const handleOpenProcess = (item: any) => {
    setSelectedOrder(item);
    setRtoReason(item.rto_reason || "Customer Refused Delivery");
    setItemCondition("GOOD");
    setRestockInventory(true);
    setReverseFreight(120);
    setNotes("");
    setFeedback(null);
    setShowProcessModal(true);
  };

  const handleOpenCodReconcile = (item: any) => {
    setSelectedOrder(item);
    setReverseFreight(120);
    setNotes("");
    setFeedback(null);
    setShowCodModal(true);
  };

  const handleProcessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await processRtoRecord({
        order_id: selectedOrder.order_id,
        rto_reason: rtoReason,
        item_condition: itemCondition,
        restock_inventory: restockInventory,
        reverse_freight_charge: Number(reverseFreight) || 0,
        notes
      });
      setFeedback({ type: "success", message: res.message || "RTO processed successfully!" });
      setTimeout(() => {
        setShowProcessModal(false);
        fetchData();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to process RTO" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await reconcileRtoCod({
        order_id: selectedOrder.order_id,
        reverse_freight_charge: Number(reverseFreight) || 0,
        notes
      });
      setFeedback({ type: "success", message: res.message || "COD reconciled to ₹0.00!" });
      setTimeout(() => {
        setShowCodModal(false);
        fetchData();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to reconcile COD" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📦</span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
              RTO (Return-To-Origin) Management
            </h1>
            <Badge variant="destructive" className="font-mono text-xs uppercase px-2.5 py-0.5">
              High Impact
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Track returned shipments, log reasons, restock inventory, reconcile COD amounts & minimize revenue loss.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={fetchData} size="sm">
            🔄 Refresh RTO Pipeline
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border-rose-500/20 bg-rose-500/5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-rose-700 dark:text-rose-300">
              RTO Rate %
            </span>
            <span className="text-base">📉</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight font-mono">
              {summary ? `${summary.rto_rate_pct}%` : "0%"}
            </span>
            <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">
              {summary?.total_rto_orders || 0} of {summary?.total_orders || 0} Orders
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            National Indian E-commerce Average: 15% – 30%
          </p>
        </Card>

        <Card className="p-5 border-amber-500/20 bg-amber-500/5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-amber-700 dark:text-amber-300">
              COD Value at Risk
            </span>
            <span className="text-base">💰</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight font-mono">
              ₹{summary ? Number(summary.cod_rto_value || 0).toLocaleString("en-IN") : "0"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Total COD amount trapped in pending/returned orders
          </p>
        </Card>

        <Card className="p-5 border-emerald-500/20 bg-emerald-500/5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-emerald-700 dark:text-emerald-300">
              Restocked to Stock
            </span>
            <span className="text-base">🏬</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight font-mono">
              {summary?.restocked_count || 0}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Units</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Good condition items automatically returned to product inventory
          </p>
        </Card>

        <Card className="p-5 border-blue-500/20 bg-blue-500/5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-blue-700 dark:text-blue-300">
              Damaged / Scrapped
            </span>
            <span className="text-base">⚠️</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight font-mono">
              {summary?.damaged_count || 0}
            </span>
            <span className="text-xs text-muted-foreground font-medium">Units</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Items inspected as damaged or tampered upon return
          </p>
        </Card>
      </div>

      {/* RTO Analytics Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* RTO Reasons Distribution */}
        <Card className="p-5 border-border">
          <h3 className="text-sm font-bold font-heading uppercase tracking-wider text-foreground mb-4 flex items-center justify-between">
            <span>Primary RTO Reasons</span>
            <span className="text-xs font-normal text-muted-foreground">Breakdown by %</span>
          </h3>

          <div className="space-y-3">
            {summary?.reason_breakdown?.map((r: any, idx: number) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs font-medium text-foreground">
                  <span>{r.reason}</span>
                  <span className="font-mono text-muted-foreground">{r.count} orders ({r.percentage}%)</span>
                </div>
                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-rose-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, r.percentage * 1.5)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Courier-wise RTO Comparison */}
        <Card className="p-5 border-border">
          <h3 className="text-sm font-bold font-heading uppercase tracking-wider text-foreground mb-4 flex items-center justify-between">
            <span>Carrier RTO Performance</span>
            <span className="text-xs font-normal text-muted-foreground">Courier Comparison</span>
          </h3>

          <div className="space-y-3">
            {summary?.carrier_breakdown?.map((c: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                    {c.carrier_code}
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">{c.carrier_name}</h4>
                    <p className="text-[11px] text-muted-foreground">
                      {c.rto_count} RTO / {c.total_shipments} Total Shipments
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <Badge
                    variant={c.rto_rate > 20 ? "destructive" : c.rto_rate > 10 ? "secondary" : "default"}
                    className="font-mono text-xs font-bold"
                  >
                    {c.rto_rate}% RTO Rate
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* RTO Shipments Management Table */}
      <Card className="p-5 border-border space-y-4">
        
        {/* Table Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <input
              type="text"
              placeholder="Search by Order #, Customer Name, Mobile or City..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full max-w-md rounded-xl border border-border bg-background px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={carrierFilter}
              onChange={(e) => { setCarrierFilter(e.target.value); setPage(1); }}
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground focus:outline-hidden"
            >
              <option value="">All Carriers</option>
              <option value="DELHIVERY">Delhivery</option>
              <option value="INDIA_POST">India Post</option>
              <option value="DTDC">DTDC</option>
              <option value="BLUEDART">BlueDart</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">Loading RTO shipments...</div>
        ) : shipments.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            No RTO shipments found matching your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order & Item</TableHead>
                  <TableHead>Customer Info</TableHead>
                  <TableHead>Carrier & AWB</TableHead>
                  <TableHead>COD Value</TableHead>
                  <TableHead>RTO Status & Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((item) => (
                  <TableRow key={item.order_id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <ProductAvatar imageUrl={item.image_url} title={item.item_title} className="size-9 shrink-0" />
                        <div>
                          <span className="font-mono text-xs font-bold text-foreground block">
                            {item.order_name}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate max-w-[140px] block">
                            {item.item_title}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-semibold text-foreground block">{item.customer_name}</span>
                        <span className="font-mono text-muted-foreground block">📞 {item.customer_mobile}</span>
                        <span className="text-muted-foreground block text-[11px]">{item.city}, {item.pincode}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-bold text-primary font-mono block">{item.awb_number}</span>
                        <span className="text-muted-foreground text-[11px] block">{item.carrier_code}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                      ₹{item.cod_value.toLocaleString("en-IN")}
                      <span className="text-[10px] font-normal text-muted-foreground block">{item.cod_mode}</span>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={item.return_status === "INSPECTED" ? "default" : "destructive"} className="text-[10px] px-2 py-0">
                          {item.tracking_status || item.return_status}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground block font-medium">
                          {item.rto_reason}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenProcess(item)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs"
                        >
                          📥 Process RTO
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCodReconcile(item)}
                          className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-muted text-foreground transition"
                        >
                          💰 Reconcile
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSelectedOrder(item); setShowWhatsAppModal(true); }}
                          className="px-2 py-1.5 rounded-lg text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-white transition shadow-2xs"
                        >
                          💬
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Modal: Process RTO Receipt */}
      {showProcessModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="fixed inset-0" onClick={() => setShowProcessModal(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <span>📥 Process RTO Return Receipt</span>
              </h3>
              <button type="button" onClick={() => setShowProcessModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {feedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold ${feedback.type === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleProcessSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-muted-foreground block mb-1">RTO Reason</label>
                <select
                  value={rtoReason}
                  onChange={(e) => setRtoReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                >
                  {RTO_REASONS.map((r, idx) => (
                    <option key={idx} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Item Inspection Condition</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ITEM_CONDITIONS.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setItemCondition(c.code)}
                      className={`p-2.5 rounded-xl border text-left font-medium text-xs transition ${
                        itemCondition === c.code ? c.color + " font-bold shadow-xs" : "border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {itemCondition === "GOOD" && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="restock"
                    checked={restockInventory}
                    onChange={(e) => setRestockInventory(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 size-4"
                  />
                  <label htmlFor="restock" className="font-bold text-emerald-800 dark:text-emerald-300 cursor-pointer">
                    Automatically Restock Item into Inventory (+1 Stock)
                  </label>
                </div>
              )}

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Reverse Shipping / Freight Charge (₹)</label>
                <input
                  type="number"
                  value={reverseFreight}
                  onChange={(e) => setReverseFreight(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs font-mono text-foreground"
                  placeholder="120"
                />
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Inspector Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter any warehouse inspection remarks..."
                  rows={2}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowProcessModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  {submitting ? "Processing..." : "Confirm & Save RTO Receipt"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reconcile COD */}
      {showCodModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="fixed inset-0" onClick={() => setShowCodModal(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">💰 Reconcile RTO COD Remittance</h3>
              <button type="button" onClick={() => setShowCodModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {feedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold ${feedback.type === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleCodSubmit} className="space-y-4 text-xs">
              <p className="text-muted-foreground">
                This action sets expected COD collected for order <span className="font-bold text-foreground">{selectedOrder.order_name}</span> to <span className="font-mono font-bold text-rose-600">₹0.00</span> and records reverse freight charges in ledger.
              </p>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Reverse Shipping Charge (₹)</label>
                <input
                  type="number"
                  value={reverseFreight}
                  onChange={(e) => setReverseFreight(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background p-2.5 font-mono text-foreground"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCodModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} size="sm" className="bg-rose-600 hover:bg-rose-700 text-white font-bold">
                  {submitting ? "Reconciling..." : "Confirm COD Zeroing"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Modal */}
      {showWhatsAppModal && selectedOrder && (
        <WhatsAppDialog
          open={showWhatsAppModal}
          order={{
            id: selectedOrder.order_id,
            shopify_order_name: selectedOrder.order_name,
            internal_order_number: selectedOrder.internal_order_number,
            receiver_name: selectedOrder.customer_name,
            receiver_mobile: selectedOrder.customer_mobile,
            total_amount: selectedOrder.total_amount,
            shipment: {
              carrier_code: selectedOrder.carrier_code,
              awb_number: selectedOrder.awb_number
            }
          }}
          onClose={() => setShowWhatsAppModal(false)}
        />
      )}

    </div>
  );
}
