import React, { useState, useEffect } from "react";
import SelectField from "../components/SelectField";
import {
  IconAlert,
  IconArrowUpRight,
  IconCheck,
  IconClose,
  IconCoin,
  IconPhone,
  IconRefresh,
  IconRefund,
  IconSpark,
} from "../components/icons";
import { Card, Button, Badge, Input, Textarea, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../components/primitives";
import { getRtoSummary } from "../lib/api";
import { API, api } from "../lib/api";

export async function getCodRemittanceSummary() {
  return api<{
    total_cod_orders: number;
    total_expected_cod: number;
    total_remitted_cod: number;
    total_pending_cod: number;
    total_discrepancy_amount: number;
    matched_orders_count: number;
    short_remittance_count: number;
    pending_count: number;
    rto_zero_count: number;
    rto_rate: number;
  }>("/api/v1/cod-remittance/summary");
}

export async function getCodRemittanceOrders(params?: { q?: string; status?: string; carrier?: string; page?: number; page_size?: number }) {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.status) query.set("status", params.status);
  if (params?.carrier) query.set("carrier", params.carrier);
  if (params?.page) query.set("page", String(params.page));
  if (params?.page_size) query.set("page_size", String(params.page_size));

  const path = `/api/v1/cod-remittance/orders${query.toString() ? `?${query.toString()}` : ""}`;
  return api<{
    items: Array<{
      order_id: string;
      order_name: string;
      internal_order_number: string;
      customer_name: string;
      customer_mobile: string;
      city: string;
      order_date: string | null;
      carrier_code: string;
      awb_number: string;
      expected_cod: number;
      remitted_amount: number;
      fee_amount: number;
      difference: number;
      utr_number: string;
      settlement_date: string | null;
      remittance_status: string;
      operational_status: string;
    }>;
    total: number;
    page: number;
    page_size: number;
  }>(path);
}

export async function uploadCodRemittanceFile(file: File) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API}/api/v1/cod-remittance/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.detail || data.error?.message || "File upload failed");
  }

  return data.data;
}

export async function resolveCodDiscrepancy(payload: { order_id: string; action: string; write_off_amount?: number; notes?: string }) {
  return api<{ success: boolean; message: string; data: any }>("/api/v1/cod-remittance/resolve", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}


export default function CodRemittance() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [page, setPage] = useState(1);

  // File Upload State
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Modal State
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveAction, setResolveAction] = useState("ACCEPT_SHORT");
  const [writeOffAmount, setWriteOffAmount] = useState(0);
  const [resolveNotes, setResolveNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumData, ordData] = await Promise.all([
        getCodRemittanceSummary(),
        getCodRemittanceOrders({ q: searchQuery, status: statusFilter, carrier: carrierFilter, page, page_size: 15 })
      ]);
      setSummary(sumData);
      setOrders(ordData.items || []);
      setTotalCount(ordData.total || 0);
    } catch (err) {
      console.error("Failed to fetch COD remittance data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchQuery, statusFilter, carrierFilter, page]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const res = await uploadCodRemittanceFile(file);
      setUploadResult(res);
      fetchData();
    } catch (err: any) {
      setUploadError(err.message || "Failed to parse remittance file");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleOpenResolve = (item: any) => {
    setSelectedOrder(item);
    setResolveAction("ACCEPT_SHORT");
    setWriteOffAmount(item.difference > 0 ? item.difference : 0);
    setResolveNotes("");
    setFeedback(null);
    setShowResolveModal(true);
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await resolveCodDiscrepancy({
        order_id: selectedOrder.order_id,
        action: resolveAction,
        write_off_amount: Number(writeOffAmount) || 0,
        notes: resolveNotes
      });
      setFeedback({ type: "success", message: res.message || "Discrepancy resolved successfully!" });
      setTimeout(() => {
        setShowResolveModal(false);
        fetchData();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to resolve discrepancy" });
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
              <IconCoin size={18} />
            </span>
            <h1 className="text-2xl font-medium tracking-tight text-foreground font-heading">
              COD Remittance Reconciliation
            </h1>
            <Badge variant="secondary" className="text-xs font-semibold uppercase px-2.5 py-0.5">
              Automated Matching
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Auto-match courier COD remittance transfers (Delhivery, India Post, DTDC, BlueDart) against expected order values.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer inline-flex items-center gap-2 h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-colors">
            <IconArrowUpRight size={15} />
            Upload Courier Remittance Report
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border-border  shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-success">
              Total Expected COD
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-success/10 text-status-success"><IconRefund size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              ₹{summary ? Number(summary.total_expected_cod || 0).toLocaleString("en-IN") : "0"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {summary?.total_cod_orders || 0} Total COD Orders
          </p>
        </Card>

        <Card className="p-5 border-border  shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-info">
              Total COD Remitted
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-info/10 text-status-info"><IconRefund size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              ₹{summary ? Number(summary.total_remitted_cod || 0).toLocaleString("en-IN") : "0"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {summary?.matched_orders_count || 0} Matched Orders Settled in Bank
          </p>
        </Card>

        <Card className="p-5 border-border  shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-warning">
              Pending Remittance
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning"><IconRefund size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-foreground">
              ₹{summary ? Number(summary.total_pending_cod || 0).toLocaleString("en-IN") : "0"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {summary?.pending_count || 0} Orders pending courier bank transfer
          </p>
        </Card>

        <Card className="p-5 border-border  shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-heading uppercase text-status-danger">
              Shortfall / Discrepancy
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-status-danger/10 text-status-danger"><IconRefund size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-3xl font-semibold tracking-tight text-status-danger">
              ₹{summary ? Number(summary.total_discrepancy_amount || 0).toLocaleString("en-IN") : "0"}
            </span>
            <Badge variant="destructive" className="text-[10px]">
              {summary?.short_remittance_count || 0} Orders
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Amount under-remitted by couriers
          </p>
        </Card>
      </div>

      {/* Upload Banner / Result Notification */}
      {uploading && (
        <div className="p-4 rounded-xl border border-status-success/30 bg-status-success/10 text-status-success text-xs font-bold flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg"><IconRefresh size={16} className="animate-spin" /></span>
          <span>Parsing remittance report, executing 4-level matching engine & auto-posting ledger...</span>
        </div>
      )}

      {uploadError && (
        <div className="p-4 rounded-xl border border-status-danger/30 bg-status-danger/10 text-status-danger text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-1.5"><IconAlert size={14} /> {uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} aria-label="Dismiss error"><IconClose size={14} /></button>
        </div>
      )}

      {uploadResult && (
        <div className="p-4 rounded-xl border border-status-success/30 bg-status-success/10 text-xs font-medium space-y-2">
          <div className="flex items-center justify-between font-bold text-status-success">
            <span className="flex items-center gap-1.5"><IconCheck size={16} /> Report {uploadResult.filename} Processed!</span>
            <button type="button" onClick={() => setUploadResult(null)} aria-label="Dismiss"><IconClose size={14} /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-muted-foreground pt-1">
            <div>Total Rows: <span className="font-bold text-foreground">{uploadResult.total_rows}</span></div>
            <div>Matched: <span className="font-bold text-status-success">{uploadResult.matched_count}</span></div>
            <div>Shortfalls: <span className="font-bold text-status-danger">{uploadResult.short_count}</span></div>
            <div>Total Net Remitted: <span className="font-bold text-foreground">₹{uploadResult.total_net_remitted?.toLocaleString()}</span></div>
          </div>
        </div>
      )}

      {/* COD Remittance Orders Table */}
      <Card className="p-5 border-border space-y-4">
        
        {/* Table Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <Input
              placeholder="Search by Order #, Customer Name, Mobile or UTR / Bank Ref..."
              aria-label="Search COD remittance"
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
              ariaLabel="Remittance status"
              value={statusFilter}
              allLabel="All Remittance Statuses"
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              triggerClassName="rounded-xl px-3 py-2 text-xs font-medium"
              options={[
                { value: "MATCHED", label: "Matched (Settled)" },
                { value: "SHORT_REMITTANCE", label: "Short Remittance (Discrepancy)" },
                { value: "PENDING_REMITTANCE", label: "Pending Remittance" },
                { value: "RTO_ZERO_REMITTANCE", label: "RTO (Zero Remittance)" },
              ]}
            />

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
          <div className="py-12 text-center text-xs text-muted-foreground">Loading COD remittance records...</div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            No COD orders found matching your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Name</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Carrier & AWB</TableHead>
                  <TableHead>UTR / Bank Ref</TableHead>
                  <TableHead className="text-right">Expected COD</TableHead>
                  <TableHead className="text-right">Net Received</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Remittance Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((item) => (
                  <TableRow key={item.order_id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs font-bold text-foreground">
                      {item.order_name}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-semibold text-foreground block">{item.customer_name}</span>
                        <span className="font-mono text-muted-foreground block text-[11px] flex items-center gap-1 mt-0.5">
                          <IconPhone size={11} className="text-muted-foreground" />
                          <span>{item.customer_mobile}</span>
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs">
                        <span className="font-bold text-primary font-mono block">{item.awb_number}</span>
                        <span className="text-muted-foreground text-[11px] block">{item.carrier_code}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-foreground font-medium">
                      {item.utr_number || "N/A"}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs font-semibold text-foreground">
                      ₹{item.expected_cod.toLocaleString("en-IN")}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs font-bold text-status-success">
                      ₹{item.remitted_amount.toLocaleString("en-IN")}
                      {item.fee_amount > 0 && (
                        <span className="text-[10px] text-muted-foreground block font-normal">
                          Fee: ₹{item.fee_amount}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs font-bold">
                      {item.difference > 0 ? (
                        <span className="text-status-danger">+₹{item.difference.toLocaleString("en-IN")} Short</span>
                      ) : item.difference < 0 ? (
                        <span className="text-status-info font-normal">₹{Math.abs(item.difference)} Over</span>
                      ) : (
                        <span className="text-muted-foreground font-normal">₹0.00</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          item.remittance_status === "MATCHED"
                            ? "default"
                            : item.remittance_status === "SHORT_REMITTANCE"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-[10px] px-2.5 py-0.5"
                      >
                        {item.remittance_status.replace("_", " ")}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      {item.difference > 1.0 ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleOpenResolve(item)}
                          className="bg-status-danger hover:bg-status-danger/90 text-white font-bold text-xs gap-1.5 h-7 px-2.5 shadow-2xs"
                        >
                          <IconSpark size={13} />
                          Resolve Shortfall
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium flex items-center justify-end gap-1">
                          <IconCheck size={13} className="text-status-success" /> Settled
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Modal: Resolve Discrepancy */}
      {showResolveModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="fixed inset-0" onClick={() => setShowResolveModal(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-medium text-foreground flex items-center gap-1.5">
                <IconSpark size={16} className="text-status-danger" /> Resolve COD Shortfall / Discrepancy
              </h3>
              <button type="button" onClick={() => setShowResolveModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close modal">
                <IconClose size={14} />
              </button>
            </div>

            {feedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold ${feedback.type === "success" ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleResolveSubmit} className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-status-danger/10 border border-border text-status-danger">
                <p className="font-bold">Order: {selectedOrder.order_name}</p>
                <p className="mt-1">
                  Expected COD: <span className="font-mono font-bold">₹{selectedOrder.expected_cod}</span> • Remitted: <span className="font-mono font-bold">₹{selectedOrder.remitted_amount}</span> • Shortfall: <span className="font-mono font-bold text-status-danger">₹{selectedOrder.difference}</span>
                </p>
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Resolution Action</label>
                <SelectField
                  ariaLabel="Resolution Action"
                  value={resolveAction}
                  includeAll={false}
                  onChange={setResolveAction}
                  triggerClassName="w-full p-2.5 text-xs"
                  options={[
                    {
                      value: "ACCEPT_SHORT",
                      label: "Accept & Write Off Shortfall (Courier Reversal / Loss)",
                    },
                    { value: "DISPUTE_COURIER", label: "Flag Courier Dispute / Claim" },
                    { value: "FORCE_MATCH", label: "Force Mark as 100% Settled" },
                  ]}
                />
              </div>

              {resolveAction === "ACCEPT_SHORT" && (
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">Write-off Amount (₹)</label>
<Input
                  type="number"
                  aria-label="Write-off amount"
                  value={writeOffAmount}
                  onChange={(e) => setWriteOffAmount(Number(e.target.value))}
                  className="text-xs"
                />
                </div>
              )}

              <div>
                <label className="font-bold text-muted-foreground block mb-1">Notes / Remarks</label>
                <Textarea
                  aria-label="Resolve notes"
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  placeholder="Enter notes for audit trail..."
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowResolveModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} size="sm" className="bg-status-success hover:bg-status-success/90 text-white font-bold">
                  {submitting ? "Resolving..." : "Confirm & Save Resolution"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
