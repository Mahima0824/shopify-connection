export const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";



export async function api<T>(p: string, init?: RequestInit, token?: string): Promise<T> {
  const path = p.startsWith("/") ? p : `/${p}`;
  const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  try {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers,
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errorMsg = data.detail || data.error?.message || `Request failed with status ${r.status}`;
      const err: any = new Error(errorMsg);
      err.status = r.status;
      err.code = data.error?.code ?? data.code ?? "";
      if (data.error?.issues !== undefined) err.issues = data.error.issues;
      else if (data.issues !== undefined) err.issues = data.issues;
      throw err;
    }

    if (data.success === false) {
      const err: any = new Error(data.error?.message ?? "API Error");
      err.status = 422;
      err.code = data.error?.code ?? "";
      if (data.error?.issues !== undefined) err.issues = data.error.issues;
      throw err;
    }

    return (data.data !== undefined ? data.data : data) as T;
  } catch (err: any) {
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to backend server. Make sure FastAPI backend is running at " + API);
    }
    throw err;
  }
}

// --- Finance ledger (FE1) ---

export type LedgerTxnType =
  | "SALE"
  | "PAYMENT"
  | "REFUND"
  | "CANCELLATION"
  | "COGS"
  | "SHIPPING_EXPENSE"
  | "PACKAGING_EXPENSE"
  | "PAYMENT_GATEWAY_FEE"
  | "OTHER_EXPENSE"
  | "TAX"
  | "ADJUSTMENT";

export const LEDGER_TXN_TYPES: LedgerTxnType[] = [
  "SALE",
  "PAYMENT",
  "REFUND",
  "CANCELLATION",
  "COGS",
  "SHIPPING_EXPENSE",
  "PACKAGING_EXPENSE",
  "PAYMENT_GATEWAY_FEE",
  "OTHER_EXPENSE",
  "TAX",
  "ADJUSTMENT",
];

export type LedgerEntry = {
  id: string;
  transaction_id: string;
  business_id: string;
  order_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
  expense_id: string | null;
  transaction_type: LedgerTxnType | string;
  transaction_date: string | null;
  transaction_date_ist: string | null;
  amount: string;
  tax_amount: string;
  net_amount: string;
  currency: string;
  debit_account: string;
  credit_account: string;
  payment_method: string | null;
  reference_number: string | null;
  status: string;
  tally_voucher_type: string | null;
  tally_voucher_number: string | null;
  reversal_of_id: string | null;
};

export type LedgerListParams = {
  from?: string;
  to?: string;
  type?: LedgerTxnType | string;
  order_id?: string;
};

export type LedgerListResponse = { items: LedgerEntry[]; total: number };

export type LedgerSummary = {
  revenue: {
    gross_inclusive: string;
    discounts: string;
    refunds_inclusive: string;
    cancellations_inclusive: string;
    net_inclusive: string;
    gst: string;
    gross_exclusive: string;
    net_exclusive: string;
  };
  profit: {
    net_sales_exclusive: string;
    cogs: string;
    gross_profit: string;
    shipping: string;
    packaging: string;
    gateway_fees: string;
    other: string;
    operating_profit: string;
    label: string;
    warning: string;
    margin_pct: string;
  };
  cogs_total: string;
  transaction_count: number;
  display_timezone: string;
  period: { from: string; to: string };
};

export function buildLedgerQuery(params: LedgerListParams): string {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.type) q.set("type", params.type);
  if (params.order_id) q.set("order_id", params.order_id);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listLedger(params: LedgerListParams = {}, token?: string): Promise<LedgerListResponse> {
  return api<LedgerListResponse>(`/api/v1/ledger${buildLedgerQuery(params)}`, {}, token);
}

// --- Bank reconciliation / statements mismatch board (FE2) ---

export type BankSummary = {
  expected_settlement: string;
  actual_bank_credit: string;
  difference: string;
  matched: number;
  pending: number;
  mismatch: number;
  unknown: number;
  ignored: number;
  total: number;
};

export type BankMismatchItem = {
  bank_row_id: string;
  order_id: string | null;
  order_name: string | null;
  payment_id: string | null;
  payment_reference: string | null;
  shipment_id: string | null;
  gateway_settlement_reference: string | null;
  expected_amount: number;
  actual_amount: number;
  bank_reference: string | null;
  difference: number;
  match_level: string | null;
  transaction_date: string | null;
  // Present when the backend returns POTENTIAL_MATCH candidates alongside
  // MISMATCH rows; bank-mismatches today returns MISMATCH only.
  status?: string;
};

export type BankMismatchResponse = { items: BankMismatchItem[]; total: number };

export function getBankSummary(token?: string): Promise<BankSummary> {
  return api<BankSummary>(`/api/v1/reconciliation/bank-summary`, {}, token);
}

export function listBankMismatches(token?: string): Promise<BankMismatchResponse> {
  return api<BankMismatchResponse>(`/api/v1/reconciliation/bank-mismatches`, {}, token);
}

export function manualMatchStatementRow(
  rowId: string,
  shipmentId: string,
  token?: string,
): Promise<{ id: string; reconciliation_status: string }> {
  return api<{ id: string; reconciliation_status: string }>(
    `/api/v1/statements/rows/${rowId}/match`,
    { method: "POST", body: JSON.stringify({ shipment_id: shipmentId }) },
    token,
  );
}

// Role gating for manual match (ADMIN/ACCOUNTANT only). No prior frontend role
// handling existed: login stores only the JWT, so decode the payload for a
// role claim and allow a localStorage "role" override (used by tests/dev).
export function getStoredRole(token?: string): string | null {
  try {
    if (typeof window !== "undefined") {
      const override = window.localStorage.getItem("role");
      if (override && override.trim()) return override.trim().toUpperCase();
    }
  } catch {
    // ignore storage errors
  }
  const t =
    token ?? (typeof window !== "undefined" ? window.localStorage.getItem("token") : null);
  if (t) {
    try {
      const payload = JSON.parse(atob(t.split(".")[1] ?? ""));
      const r = payload.role ?? payload.user_role ?? payload.userRole;
      if (r && String(r).trim()) return String(r).trim().toUpperCase();
    } catch {
      // not a decodable JWT; fall through
    }
  }
  return null;
}

export function canManualMatch(role?: string | null): boolean {
  const r = (role ?? getStoredRole() ?? "").toUpperCase();
  return r === "ADMIN" || r === "ACCOUNTANT";
}

// --- Tally validation + workbook export + batches (FE3) ---

export type TallyValidationIssue = {
  code: string;
  message: string;
  ref?: string | null;
};

export type TallyValidation = {
  transactions: number;
  valid: number;
  error_count: number;
  warning_count: number;
  errors: TallyValidationIssue[];
  warnings: TallyValidationIssue[];
  already_exported: number;
  fresh: number;
  can_export: boolean;
};

export type TallyExportBatch = {
  id: string;
  batch_reference: string;
  record_count: number;
  transaction_count?: number | null;
  status: string;
  file_name?: string | null;
  created_at?: string | null;
};

export type TallyExportList = { items: TallyExportBatch[] };

export function buildTallyRangeQuery(params: { from?: string; to?: string }): string {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function validateTallyExport(
  params: { from?: string; to?: string },
  token?: string,
): Promise<TallyValidation> {
  return api<TallyValidation>(
    `/api/v1/tally/validate${buildTallyRangeQuery(params)}`,
    { method: "POST" },
    token,
  );
}

export function listTallyExports(
  params: { from?: string; to?: string } = {},
  token?: string,
): Promise<TallyExportList> {
  return api<TallyExportList>(
    `/api/v1/tally/exports${buildTallyRangeQuery(params)}`,
    {},
    token,
  );
}

export function markTallyImported(
  batchId: string,
  opts: { imported?: boolean; partial?: boolean; failed?: boolean } = { imported: true },
  token?: string,
): Promise<{ id: string; status: string }> {
  return api<{ id: string; status: string }>(
    `/api/v1/tally/exports/${batchId}/mark-imported`,
    {
      method: "POST",
      body: JSON.stringify({
        imported: opts.imported ?? true,
        partial: opts.partial ?? false,
        failed: opts.failed ?? false,
      }),
    },
    token,
  );
}

export function getLedgerSummary(
  params: { from: string; to: string },
  token?: string,
): Promise<LedgerSummary> {
  const q = new URLSearchParams({ from: params.from, to: params.to }).toString();
  return api<LedgerSummary>(`/api/v1/ledger/summary?${q}`, {}, token);
}

// --- Month close (FE4) ---

export type CloseCheckCounts = {
  unreconciled_payments: number;
  unreconciled_bank: number;
  unexported_transactions: number;
  invalid_gst: number;
  missing_cogs: number;
  pending_refunds: number;
  check_errors: number;
  [k: string]: number;
};

export type CloseIssues = {
  total: number;
  counts: CloseCheckCounts;
  checks: Record<string, string[]>;
  period?: { year: number; month: number };
  display_timezone?: string;
};

export type PeriodDetail = { status: string; issues: CloseIssues };

export type CloseResult = { id: string; status: string; closed_at?: string; already_closed?: boolean };

export type ReopenResult = { id: string; status: string };

export function getPeriodDetail(year: number, month: number, token?: string): Promise<PeriodDetail> {
  return api<PeriodDetail>(`/api/v1/accounting/periods/${year}/${month}`, {}, token);
}

export function closeMonth(year: number, month: number, token?: string): Promise<CloseResult> {
  return api<CloseResult>(
    `/api/v1/accounting/periods/${year}/${month}/close`,
    { method: "POST" },
    token,
  );
}

export function reopenMonth(year: number, month: number, token?: string): Promise<ReopenResult> {
  return api<ReopenResult>(
    `/api/v1/accounting/periods/${year}/${month}/reopen`,
    { method: "POST" },
    token,
  );
}

export function canCloseMonth(role?: string | null): boolean {
  const r = (role ?? getStoredRole() ?? "").toUpperCase();
  return r === "ADMIN" || r === "ACCOUNTANT";
}

export function canReopenMonth(role?: string | null): boolean {
  const r = (role ?? getStoredRole() ?? "").toUpperCase();
  return r === "ADMIN";
}

// --- Reports GST + profit with FY presets (FE5) ---

export const REPORT_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "financial_year",
  "last_fy",
  "custom",
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number];

export type GstTotals = {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
};

export type GstRow = {
  order_id: string;
  order_name: string | null;
  valid: boolean;
  jurisdiction: string;
  invoice_check?: { taxable: string; cgst: string; sgst: string; igst: string; total: string };
  errors?: { code: string; message: string }[];
  warnings?: string[];
};

export type GstReport = {
  period: { from: string; to: string };
  orders: number;
  invalid: number;
  totals: GstTotals;
  rows: GstRow[];
};

export type ProfitReport = {
  period: { from: string; to: string };
  orders: number;
  revenue: { gross_inclusive: string; net_exclusive: string; gst: string };
  profit: {
    cogs: string;
    gross_profit: string;
    operating_profit: string;
    margin_pct: string;
    label: string;
    warning: string;
  };
};

export function buildReportRangeQuery(params: { preset?: string; from?: string; to?: string }): string {
  const q = new URLSearchParams();
  if (params.preset) q.set("preset", params.preset);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getGstReport(
  params: { preset?: string; from?: string; to?: string },
  token?: string,
): Promise<GstReport> {
  return api<GstReport>(`/api/v1/reports/gst${buildReportRangeQuery(params)}`, {}, token);
}

export function getProfitReport(
  params: { preset?: string; from?: string; to?: string },
  token?: string,
): Promise<ProfitReport> {
  return api<ProfitReport>(`/api/v1/reports/profit${buildReportRangeQuery(params)}`, {}, token);
}

// --- ShipSagar health + retry drain (FE5) ---

export type ShipsagarHealth = {
  provider: string;
  configured: boolean;
  status: string;
  failed_webhooks: number;
  failed_jobs: number;
  pending_jobs: number;
  unregistered_shipments: number;
};

export type RetryDrainResult = {
  checked?: number;
  succeeded?: number;
  requeued?: number;
  dead_lettered?: number;
  drained?: number;
  moved_to_dead_letter?: number;
  remaining?: number;
  [k: string]: unknown;
};

export function getShipsagarHealth(token?: string): Promise<ShipsagarHealth> {
  return api<ShipsagarHealth>(`/api/v1/shipsagar/health`, {}, token);
}

export function drainShipsagarRetries(limit = 50, token?: string): Promise<RetryDrainResult> {
  return api<RetryDrainResult>(
    `/api/v1/shipsagar/retry-drain?limit=${limit}`,
    { method: "POST" },
    token,
  );
}

export function canDrainRetries(role?: string | null): boolean {
  const r = (role ?? getStoredRole() ?? "").toUpperCase();
  return r === "ADMIN";
}

export function shipmentProvider(s: {
  carrier_code?: string | null;
  shipsagar_tracking_id?: string | null;
}): "SHIPSAGAR" | "MANUAL" | "DIRECT" {
  if (s.shipsagar_tracking_id) return "SHIPSAGAR";
  if ((s.carrier_code ?? "").toUpperCase() === "MANUAL") return "MANUAL";
  return "DIRECT";
}

// --- Shipments: list, push, sync ---

export type ShipmentRow = {
  id: string;
  business_id: string;
  order_id: string;
  parcel_id: string;
  carrier_code: string;
  awb_number: string;
  shipsagar_tracking_id?: string | null;
  tracking_status: string;
  carrier_status_raw?: string | null;
  current_location?: string | null;
  last_checkpoint_message?: string | null;
  last_checkpoint_at?: string | null;
  last_synced_at?: string | null;
  entry_datetime?: string | null;
  shipment_type?: string | null;
  country_name?: string | null;
  order_no?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_mobile?: string | null;
  company_name?: string | null;
};

export type ShipmentFacets = {
  carriers: { code: string; count: number }[];
  statuses: { code: string; count: number }[];
};

export type ShipmentListResult = {
  items: ShipmentRow[];
  total: number;
  page: number;
  page_size: number;
  facets: ShipmentFacets;
};

export type PushShipmentResult = ShipmentRow & { pushed: boolean; message: string };

export type ShipmentSyncResult = {
  synced: boolean;
  new_events?: number;
  reason?: string;
};

export type PushOrderOption = {
  id: string;
  order_no?: string | null;
  customer_name?: string | null;
  receiver_city?: string | null;
  receiver_pincode?: string | null;
  shipment_id?: string | null;
};

export function listShipments(
  params: {
    date_from?: string;
    date_to?: string;
    q?: string;
    order_no?: string;
    status?: string;
    carrier?: string;
    page?: number;
    page_size?: number;
  } = {},
  token?: string,
): Promise<ShipmentListResult> {
  const p = new URLSearchParams();
  if (params.date_from) p.set("date_from", params.date_from);
  if (params.date_to) p.set("date_to", params.date_to);
  if (params.q?.trim()) p.set("q", params.q.trim());
  if (params.order_no?.trim()) p.set("order_no", params.order_no.trim());
  if (params.status) p.set("status", params.status.toUpperCase());
  if (params.carrier) p.set("carrier", params.carrier.toUpperCase());
  if (params.page && params.page > 1) p.set("page", String(params.page));
  if (params.page_size) p.set("page_size", String(params.page_size));
  const qs = p.toString();
  return api<ShipmentListResult>(`/api/v1/shipments${qs ? `?${qs}` : ""}`, {}, token);
}

export function pushShipment(
  payload: { order_id: string; tracking_no: string; courier_code: string },
  token?: string,
): Promise<PushShipmentResult> {
  return api<PushShipmentResult>(
    "/api/v1/shipments/push",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function syncShipment(id: string, token?: string): Promise<ShipmentSyncResult> {
  return api<ShipmentSyncResult>(`/api/v1/shipments/${id}/sync`, { method: "POST" }, token);
}

export function listOrdersForPush(token?: string): Promise<PushOrderOption[]> {
  return api<any>("/api/v1/orders?page_size=100", {}, token).then((data: any) =>
    Array.isArray(data) ? data : (data?.items ?? []));
}
