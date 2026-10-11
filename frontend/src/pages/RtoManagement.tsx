import React, { useState, useEffect } from "react";
import SelectField from "../components/SelectField";
import { Link } from "react-router-dom";
import { Card, Button, Badge, Checkbox, Input, Textarea, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../components/primitives";
import ProductAvatar from "../components/ProductAvatar";
import { EmptyPanel } from "../components/EmptyState";
import {
  IconAlert,
  IconBox,
  IconClose,
  IconCoin,
  IconDownload,
  IconMessage,
  IconRefresh,
  IconRefund,
  IconReturn,
} from "../components/icons";
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
  { code: "GOOD", label: "Good (Restockable to Inventory)", color: "text-status-success border-status-success bg-status-success/5" },
  { code: "DAMAGED", label: "Damaged (Scrap / Claim)", color: "text-status-danger border-status-danger bg-status-danger/5" },
  { code: "OPENED", label: "Opened / Tampered Box", color: "text-status-warning border-status-warning bg-status-warning/5" },
  { code: "WRONG_ITEM", label: "Wrong Item Returned", color: "text-status-info border-status-info bg-status-info/5" },
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
    <div className="page-shell space-y-8 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconReturn size={18} />
            </span>
            <h1 className="text-2xl font-medium tracking-tight text-foreground font-heading">
              RTO (Return-To-Origin) Management
            </h1>
            <Badge variant="destructive" className="text-xs font-semibold uppercase px-2.5 py-0.5">
              High Impact
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Track returned shipments, log reasons, restock inventory, reconcile COD amounts &amp; minimize revenue loss.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={fetchData} size="sm" className="gap-1.5">
            <IconRefresh size={15} />
            Refresh RTO Pipeline
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards. The tone lives on the icon chip and the label; the
          card itself stays on the neutral surface so the four read as one set
          rather than four competing colour blocks. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-danger">
              RTO Rate %
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-danger/10 text-status-danger">
              <IconRefund size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              {summary ? `${summary.rto_rate_pct}%` : "0%"}
            </span>
            <span className="text-xs text-status-danger font-medium">
              {summary?.total_rto_orders || 0} of {summary?.total_orders || 0} Orders
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            National Indian E-commerce Average: 15% – 30%
          </p>
        </Card>

        <Card className="p-5 border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-warning">
              COD Value at Risk
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning">
              <IconCoin size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              ₹{summary ? Number(summary.cod_rto_value || 0).toLocaleString("en-IN") : "0"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Total COD amount trapped in pending/returned orders
          </p>
        </Card>

        <Card className="p-5 border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-success">
              Restocked to Stock
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-success/10 text-status-success">
              <IconBox size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              {summary?.restocked_count || 0}
            </span>
            <span className="text-xs text-status-success font-medium">Units</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Good condition items automatically returned to product inventory
          </p>
        </Card>

        <Card className="p-5 border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-info">
              Damaged / Scrapped
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-info/10 text-status-info">
              <IconAlert size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
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
          <h3 className="text-sm font-medium font-heading uppercase tracking-wider text-foreground mb-4 flex items-center justify-between">
            <span>Primary RTO Reasons</span>
            <span className="text-xs font-normal text-muted-foreground">Breakdown by %</span>
          </h3>

          <div className="space-y-3">
            {summary?.reason_breakdown?.length ? (
              summary.reason_breakdown.map((r: any, idx: number) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-foreground">
                    <span>{r.reason}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {r.count} orders ({r.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-status-danger h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, r.percentage * 1.5)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              /* Without this the card rendered as a bare titled box, which read
                 as a broken panel rather than "no data yet". */
              <EmptyPanel
                title="No RTO reasons yet"
                hint="Reason breakdowns appear once returned shipments are logged."
              />
            )}
          </div>
        </Card>

        {/* Courier-wise RTO Comparison */}
        <Card className="p-5 border-border">
          <h3 className="text-sm font-medium font-heading uppercase tracking-wider text-foreground mb-4 flex items-center justify-between">
            <span>Carrier RTO Performance</span>
            <span className="text-xs font-normal text-muted-foreground">Courier Comparison</span>
          </h3>

          <div className="space-y-3">
            {summary?.carrier_breakdown?.length ? (
              summary.carrier_breakdown.map((c: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20">
                      {c.carrier_code}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-foreground truncate">{c.carrier_name}</h4>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {c.rto_count} RTO / {c.total_shipments} Total Shipments
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <Badge
                      variant={c.rto_rate > 20 ? "destructive" : c.rto_rate > 10 ? "secondary" : "outline"}
                      className="text-xs font-semibold tabular-nums"
                    >
                      {c.rto_rate}% RTO Rate
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel
                title="No carrier data yet"
                hint="Courier comparison appears once RTO shipments are recorded."
              />
            )}
          </div>
        </Card>
      </div>

      {/* RTO Shipments Management Table */}
      <Card className="p-5 border-border space-y-4">
        
        {/* Table Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <Input
              placeholder="Search by Order #, Customer Name, Mobile or City..."
              aria-label="Search RTO shipments"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full max-w-md"
            />
          </div>

          <div className="flex items-center gap-2">
            <SelectField
              ariaLabel="Carrier filter"
              value={carrierFilter}
              allLabel="All Carriers"
              onChange={(v) => {
                setCarrierFilter(v);
                setPage(1);
              }}
              triggerClassName="rounded-xl px-3 py-2 text-xs font-medium"
              options={[
                { value: "DELHIVERY", label: "Delhivery" },
                { value: "INDIA_POST", label: "India Post" },
                { value: "DTDC", label: "DTDC" },
                { value: "BLUEDART", label: "BlueDart" },
              ]}
            />
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
                        <span className="font-mono text-muted-foreground block">{item.customer_mobile}</span>
                        <span className="text-muted-foreground block text-[11px]">{item.city}, {item.pincode}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-bold text-primary font-mono block">{item.awb_number}</span>
                        <span className="text-muted-foreground text-[11px] block">{item.carrier_code}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs font-bold text-status-danger">
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
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleOpenProcess(item)}
                          className="h-7 px-2.5 text-xs font-bold bg-status-success hover:bg-status-success/90 text-white shadow-2xs gap-1"
                        >
                          <IconDownload size={13} />
                          Process RTO
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenCodReconcile(item)}
                          className="h-7 px-2 text-xs font-semibold gap-1"
                        >
                          <IconCoin size={13} />
                          Reconcile
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => { setSelectedOrder(item); setShowWhatsAppModal(true); }}
                          className="h-7 px-2 text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-2xs gap-1"
                          aria-label="WhatsApp Notification"
                        >
                          <IconMessage size={13} />
                        </Button>
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
              <h3 className="text-base font-medium text-foreground flex items-center gap-2">
                <IconDownload size={16} className="text-status-success" />
                <span>Process RTO Return Receipt</span>
              </h3>
              <button type="button" onClick={() => setShowProcessModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close modal">
                <IconClose size={14} />
              </button>
            </div>

            {feedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold ${feedback.type === "success" ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleProcessSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-muted-foreground block mb-1">RTO Reason</label>
                <SelectField
                  ariaLabel="RTO Reason"
                  value={rtoReason}
                  includeAll={false}
                  onChange={setRtoReason}
                  triggerClassName="w-full p-2.5 text-xs"
                  options={RTO_REASONS.map((r) => ({ value: r, label: r }))}
                />
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
                <div className="p-3 rounded-xl bg-status-success/10 border border-status-success/20 flex items-center gap-2">
<Checkbox
                  id="restock"
                  checked={restockInventory}
                  onCheckedChange={(v) => setRestockInventory(v === true)}
                />
                  <label htmlFor="restock" className="font-bold text-status-success cursor-pointer">
                    Automatically Restock Item into Inventory (+1 Stock)
                  </label>
                </div>
              )}

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Reverse Shipping / Freight Charge (₹)</label>
                <Input
                  type="number"
                  aria-label="Reverse shipping charge"
                  value={reverseFreight}
                  onChange={(e) => setReverseFreight(Number(e.target.value))}
                  className="text-xs"
                  placeholder="120"
                />
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Inspector Notes</label>
                <Textarea
                  aria-label="Inspector notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter any warehouse inspection remarks..."
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowProcessModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} size="sm" className="bg-status-success hover:bg-status-success/90 text-white font-bold">
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
              <h3 className="text-base font-medium text-foreground">Reconcile RTO COD Remittance</h3>
              <button type="button" onClick={() => setShowCodModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close modal">
                <IconClose size={14} />
              </button>
            </div>

            {feedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold ${feedback.type === "success" ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleCodSubmit} className="space-y-4 text-xs">
              <p className="text-muted-foreground">
                This action sets expected COD collected for order <span className="font-bold text-foreground">{selectedOrder.order_name}</span> to <span className="font-mono font-bold text-status-danger">₹0.00</span> and records reverse freight charges in ledger.
              </p>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Reverse Shipping Charge (₹)</label>
                <Input
                  type="number"
                  aria-label="Reverse shipping charge"
                  value={reverseFreight}
                  onChange={(e) => setReverseFreight(Number(e.target.value))}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCodModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} size="sm" className="bg-status-danger hover:bg-status-danger/90 text-white font-bold">
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
