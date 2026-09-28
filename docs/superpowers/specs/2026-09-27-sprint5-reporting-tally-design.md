# Sprint 5 Spec — Dashboard, Reports, Excel Export & Tally Integration — 2026-09-27

Source plan: `ecommerce_order_reconciliation_mvp_implementation_plan.md` (§28, §37–41, §76–78, §92, §97, §109, §110).
Builds on: Sprints 1–4 (auth/orders/sync/parcels/dispatch/returns/timeline/audit/webhooks/reconciliation). Backend 45/45 green.

---

## 1. Goal
Complete the executive intelligence and accounting export layer of the Order Reconciliation MVP. 
Business owners gain real-time operational/financial metrics on the Dashboard, export complete operational workbooks to Excel, configure custom TallyPrime ledger mappings, run accounting validation, and download idempotent Tally-ready Excel files for seamless import into Tally.

---

## 2. Data Models (Migration 0005)

### `tally_mappings` Table
- `id`: UUID PK
- `business_id`: UUID FK (`businesses.id`), UNIQUE constraint per business
- `voucher_sales`: VARCHAR(64), default `'Sales'`
- `voucher_sales_return`: VARCHAR(64), default `'Sales Return'`
- `voucher_credit_note`: VARCHAR(64), default `'Credit Note'`
- `ledger_razorpay`: VARCHAR(128), default `'Razorpay Settlement'`
- `ledger_cod`: VARCHAR(128), default `'COD Receivable'`
- `ledger_sales`: VARCHAR(128), default `'Sales Account'`
- `ledger_cgst`: VARCHAR(128), default `'Output CGST'`
- `ledger_sgst`: VARCHAR(128), default `'Output SGST'`
- `ledger_igst`: VARCHAR(128), default `'Output IGST'`
- `created_at`: TIMESTAMPTZ, default `now()`
- `updated_at`: TIMESTAMPTZ, default `now()`

### `export_batches` Table
- `id`: UUID PK
- `business_id`: UUID FK (`businesses.id`)
- `batch_reference`: VARCHAR(64) UNIQUE (e.g. `TALLY-2026-09-27-0001`)
- `export_type`: VARCHAR(32), default `'TALLY_EXCEL'` (also supports `'EXCEL_WORKBOOK'`)
- `date_from`: TIMESTAMPTZ NULL
- `date_to`: TIMESTAMPTZ NULL
- `record_count`: INT, default 0
- `generated_by`: UUID FK (`users.id`)
- `status`: VARCHAR(32), default `'COMPLETED'`
- `created_at`: TIMESTAMPTZ, default `now()`

---

## 3. Services

### A. Dashboard Service (`app/services/dashboard_service.py`)
`get_dashboard_summary(db, business_id, date_from=None, date_to=None) -> dict`
- **KPI Metrics**:
  - `orders_total`: Total count of orders
  - `orders_today`: Orders created today
  - `paid_orders`: Count of orders with `financial_status == 'PAID'`
  - `cancelled_orders`: Count of orders with `cancelled_at IS NOT NULL`
  - `packed_orders`: Count of parcels with `status == 'PACKED'`
  - `dispatched_orders`: Count of scan events with `event_type == 'DISPATCHED'`
  - `returns_total`: Count of return records
  - `rto_total`: Count of return records with `return_type == 'RTO'`
  - `open_exceptions`: Count of active reconciliation issues with `resolved == False`
  - `reconciled_rate`: Percentage of orders without open exceptions
- **Financial Summary**:
  - `gross_sales`: `SUM(total_amount)` of all active orders
  - `total_tax`: `SUM(total_tax)` of all active orders
  - `total_shipping`: `SUM(total_shipping)` of all active orders
  - `total_refunds`: `SUM(amount)` from `refunds` table
  - `net_revenue`: `gross_sales - total_refunds`
- Database-calculated queries (SQL aggregates via SQLAlchemy).

### B. Export Service (`app/services/export_service.py`)
`generate_excel_workbook(db, business_id, date_from=None, date_to=None) -> bytes (CSV/Excel format)`
- Exports 6 core datasets: Orders, Payments, Returns, Scan Events, Reconciliations, and Summary.
- Structured CSV output with headers formatted for Excel compatibility.

### C. Tally Service (`app/services/tally_service.py`)
- `get_or_create_mapping(db, business_id) -> TallyMapping`
- `update_mapping(db, business_id, data: dict) -> TallyMapping`
- `validate_tally_export(db, business_id, date_from=None, date_to=None) -> dict{valid: bool, errors: list[str], counts: dict}`
  - Checks if required mapping fields are filled out.
  - Checks for unmapped payment methods or zero amounts.
- `generate_tally_export(db, business_id, user_id, date_from=None, date_to=None) -> dict{batch: ExportBatch, content: bytes}`
  - Creates idempotent `ExportBatch` with unique reference `TALLY-YYYY-MM-DD-XXXX`.
  - Generates Tally-compatible Vouchers table (Date, Voucher Type, Voucher No, Customer/Ledger Name, Debit Ledger, Debit Amount, Credit Ledger, Credit Amount, Narration).

---

## 4. API Routes

- `GET /api/v1/dashboard/summary`: Returns KPI metrics and financial summary. Authed.
- `GET /api/v1/export/excel`: Query parameters `date_from`, `date_to`. Returns downloadable file (`text/csv` / `application/vnd.ms-excel`) with headers `Content-Disposition: attachment; filename="recon_export_...csv"`. Authed.
- `GET /api/v1/tally/mapping`: Returns current business Tally mappings. Authed.
- `PUT /api/v1/tally/mapping`: Updates Tally mappings. Authed (ADMIN / ACCOUNTANT).
- `POST /api/v1/tally/validate`: Validates orders and mappings before export. Authed.
- `POST /api/v1/tally/export`: Generates Tally export file, records batch row, returns batch details + CSV content download. Authed (ADMIN / ACCOUNTANT).
- `GET /api/v1/tally/batches`: Returns history of export batches. Authed.

---

## 5. Frontend UI Components & Pages

1. **Dashboard Page (`frontend/app/page.tsx` or `frontend/app/dashboard/page.tsx`)**:
   - Executive summary cards for KPIs (Orders, Dispatched, Returns, Open Exceptions, Net Sales).
   - Financial breakdown table (Gross Sales, Tax, Shipping, Refunds, Net Revenue).
   - Recent Exceptions widget with direct links to resolve issues.
2. **Tally Settings Page (`frontend/app/settings/tally/page.tsx`)**:
   - Voucher mappings section (Sales, Sales Return, Credit Note).
   - Payment ledger mappings section (Razorpay, COD).
   - Tax ledger mappings section (CGST, SGST, IGST).
   - Validation & Export card: Button to validate mappings, view errors/warnings, and trigger Tally export download.
   - Previous Export Batches history table.

---

## 6. Testing Strategy

- `backend/tests/test_dashboard.py`: Verifies KPI and financial summary aggregation queries across test orders, payments, refunds, and returns.
- `backend/tests/test_tally.py`: Verifies mapping CRUD, validation rule failures (unmapped fields), idempotent batch creation, and Tally export CSV output.
- `frontend/tests/dashboard.test.tsx`: Component tests for Dashboard page and financial metrics rendering.
- `frontend/tests/tally.test.tsx`: Component tests for Tally mapping inputs and export button state.
- **Full E2E & Hardening**: Full suite execution covering Sprints 1 through 5.

---

## 7. Acceptance Criteria
- Dashboard displays accurate aggregates for orders, dispatch, returns, open exceptions, and financial summary.
- Excel Export generates valid CSV/Excel download containing full operational ledger data.
- Tally mappings can be saved, updated, and validated against orders.
- Tally export produces an idempotent batch record (`TALLY-YYYY-MM-DD-XXXX`) and valid Tally-compatible voucher file.
- All backend (50+ pytest) and frontend tests pass cleanly with zero TypeScript errors.
