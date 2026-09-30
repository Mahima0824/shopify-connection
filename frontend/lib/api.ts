export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
      throw new Error(errorMsg);
    }

    if (data.success === false) {
      throw new Error(data.error?.message ?? "API Error");
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

export function getLedgerSummary(
  params: { from: string; to: string },
  token?: string,
): Promise<LedgerSummary> {
  const q = new URLSearchParams({ from: params.from, to: params.to }).toString();
  return api<LedgerSummary>(`/api/v1/ledger/summary?${q}`, {}, token);
}
