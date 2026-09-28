# E-commerce Order Reconciliation System — Detailed MVP Implementation Plan

## 0. Document Purpose

This document defines a complete implementation plan for an MVP of a SaaS/product that helps e-commerce businesses reconcile:

- Shopify order data
- Physical parcel movement
- Dispatch scans
- Return/RTO scans
- Cancellation and refund events
- Payment information
- Accounting/export data for TallyPrime

The MVP is intentionally designed to solve the operational reconciliation problem first.

The primary rule is:

> **PostgreSQL is the source of truth for the application's operational data. Excel is an export/reporting format, not the database.**

---

# 1. MVP Objective

The MVP should allow an e-commerce business to:

1. Connect one Shopify store.
2. Synchronize Shopify orders into the application.
3. Create an internal order/parcel record.
4. Generate a unique barcode for every parcel.
5. Print a parcel label.
6. Scan a parcel during dispatch.
7. Scan the same parcel when returned/RTO is received.
8. Maintain a complete event history.
9. Synchronize Shopify cancellation/refund/return/fulfillment changes.
10. Detect operational mismatches.
11. Display unresolved exceptions.
12. Export a structured Excel workbook.
13. Generate a Tally-compatible accounting export using configurable mappings.
14. Maintain employee/user permissions.
15. Keep an audit trail of important actions.

---

# 2. MVP Scope

## 2.1 Included

### Store management
- Shopify store connection
- Shopify OAuth/token management
- Store configuration
- One store per MVP tenant
- Manual disconnect/reconnect

### Order management
- Shopify order synchronization
- Order search
- Order detail page
- Customer details
- Product/line-item details
- Payment information
- Fulfillment information
- Cancellation information
- Refund information

### Parcel management
- Internal Parcel ID
- Barcode generation
- Barcode label generation
- Order-to-parcel relationship
- Parcel status

### Scanning
- Dispatch scan
- Return/RTO scan
- Duplicate scan detection
- Invalid barcode handling
- Scan event history
- Employee attribution
- Timestamp

### Reconciliation
- Shopify vs operational status comparison
- Payment/refund checks
- Return/refund exception detection
- Cancelled-after-packing detection
- Duplicate/impossible event detection
- Exception dashboard

### Reporting
- Orders
- Dispatches
- Returns
- Cancellations
- Refunds
- Scan logs
- Exceptions
- Daily summary

### Excel
- Orders sheet
- Order items sheet
- Scan events sheet
- Payments sheet
- Returns sheet
- Reconciliation sheet
- Tally export sheet

### Tally
- Ledger mapping configuration
- Transaction mapping
- Tally-ready Excel export
- Validation before export

### Users
- Admin
- Warehouse staff
- Accountant
- Read-only user

---

# 3. Explicitly Out of Scope for MVP

Do NOT build these initially:

- Multi-store management
- Marketplace integrations (Amazon/Flipkart/etc.)
- Courier API integrations
- Payment gateway settlement API integrations
- GST filing
- Full accounting engine
- Full replacement for Tally
- AI predictions
- Advanced warehouse management
- Inventory forecasting
- Multi-warehouse routing
- Automatic courier label generation
- Native Android/iOS apps
- Complex purchase accounting
- Advanced CRM
- Advanced analytics warehouse

These can be added after the basic workflow works reliably.

---

# 4. Core Business Workflow

## 4.1 Order Creation

```text
Shopify
   |
   | Order created
   v
Shopify Webhook
   |
   v
Backend
   |
   v
Validate + normalize
   |
   v
PostgreSQL
   |
   v
Create internal order
   |
   v
Create parcel
   |
   v
Generate barcode
```

Example:

```text
Shopify Order: #10452

Internal Order:
ORD-2026-0001452

Parcel:
PKG-2026-0001452

Barcode:
PKG-2026-0001452
```

---

# 5. Recommended Architecture

```text
                         ┌─────────────────────┐
                         │      Shopify        │
                         └──────────┬──────────┘
                                    │
                        GraphQL API + Webhooks
                                    │
                                    v
┌────────────────────────────────────────────────────────────┐
│                         BACKEND                            │
│                       FastAPI                             │
│                                                            │
│  Auth │ Orders │ Parcels │ Scanning │ Reconciliation     │
│       │ Refunds │ Returns │ Reports │ Tally Export       │
└───────────────┬──────────────────────┬─────────────────────┘
                │                      │
                v                      v
        ┌───────────────┐      ┌────────────────┐
        │  PostgreSQL   │      │ Redis / Queue  │
        └───────────────┘      └────────────────┘
                │
                v
        ┌──────────────────┐
        │ Excel/Tally      │
        │ Export Generator │
        └──────────────────┘

Frontend:
Next.js + TypeScript + Tailwind + shadcn/ui

Scanning:
USB barcode scanner + mobile camera scanner

Deployment:
Vercel (frontend)
Render/AWS (backend)
Managed PostgreSQL
Managed Redis if required
```

---

# 6. Technology Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query
- Zustand only where global client state is actually required

## Backend

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

## Database

- PostgreSQL

## Background jobs

For MVP:

- FastAPI background jobs for lightweight tasks

When synchronization/export workload grows:

- Redis
- Celery or RQ

## Barcode

Start with:

- Code 128

Optionally later:

- QR Code

## Excel

- openpyxl
- xlsxwriter where useful

## Testing

Backend:

- pytest
- pytest-asyncio
- HTTPX

Frontend:

- Vitest
- React Testing Library

End-to-end:

- Playwright

## Code quality

- Ruff
- Black
- mypy
- ESLint
- Prettier

---

# 7. Multi-Tenant Design

Even if the first customer is one business, design the database for multiple businesses.

Every business-owned record should have:

```text
business_id
```

Example:

```text
businesses
    |
    +-- users
    +-- shopify_stores
    +-- orders
    +-- parcels
    +-- payments
    +-- returns
    +-- scan_events
```

This prevents a painful rewrite when converting the MVP into SaaS.

---

# 8. Database Schema

## 8.1 businesses

```text
id UUID PK
name VARCHAR
legal_name VARCHAR NULL
email VARCHAR
phone VARCHAR NULL
timezone VARCHAR
currency VARCHAR
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 8.2 users

```text
id UUID PK
business_id UUID FK
name VARCHAR
email VARCHAR
password_hash VARCHAR
role ENUM
is_active BOOLEAN
created_at TIMESTAMP
updated_at TIMESTAMP
```

Roles:

```text
ADMIN
WAREHOUSE
ACCOUNTANT
VIEWER
```

---

## 8.3 shopify_stores

```text
id UUID PK
business_id UUID FK
shop_domain VARCHAR UNIQUE
access_token_encrypted TEXT
scopes TEXT
is_active BOOLEAN
last_sync_at TIMESTAMP NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

Never expose the access token to the frontend.

---

## 8.4 customers

```text
id UUID PK
business_id UUID FK
shopify_customer_id VARCHAR NULL
name VARCHAR
email VARCHAR NULL
phone VARCHAR NULL
address_json JSONB NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 8.5 products

```text
id UUID PK
business_id UUID FK
shopify_product_id VARCHAR
title VARCHAR
sku VARCHAR NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 8.6 orders

```text
id UUID PK
business_id UUID FK

internal_order_number VARCHAR UNIQUE
shopify_order_id VARCHAR
shopify_order_name VARCHAR

customer_id UUID FK

order_date TIMESTAMP
currency VARCHAR

subtotal_amount DECIMAL
discount_amount DECIMAL
shipping_amount DECIMAL
tax_amount DECIMAL
total_amount DECIMAL

payment_status VARCHAR
financial_status VARCHAR
fulfillment_status VARCHAR

operational_status VARCHAR

cancelled_at TIMESTAMP NULL
cancel_reason VARCHAR NULL

shopify_created_at TIMESTAMP
shopify_updated_at TIMESTAMP

created_at TIMESTAMP
updated_at TIMESTAMP
```

Recommended operational statuses:

```text
NEW
READY_TO_PACK
PACKED
DISPATCHED
DELIVERED
RETURN_REQUESTED
RETURN_RECEIVED
COMPLETED
CANCELLED
RTO
CLOSED
```

Do not use one `status` column to represent everything. Shopify financial state, fulfillment state, and your physical operational state are different dimensions.

---

## 8.7 order_items

```text
id UUID PK
order_id UUID FK
product_id UUID FK NULL

shopify_line_item_id VARCHAR
title VARCHAR
sku VARCHAR NULL
variant_title VARCHAR NULL

ordered_quantity INTEGER
fulfilled_quantity INTEGER
returned_quantity INTEGER

unit_price DECIMAL
discount_amount DECIMAL
tax_amount DECIMAL
line_total DECIMAL
```

---

## 8.8 parcels

```text
id UUID PK
business_id UUID FK
order_id UUID FK

parcel_code VARCHAR UNIQUE
barcode_value VARCHAR UNIQUE

status VARCHAR

created_at TIMESTAMP
updated_at TIMESTAMP
```

MVP assumption:

```text
1 order = 1 parcel
```

But schema should allow:

```text
1 order = multiple parcels
```

later.

---

## 8.9 scan_events

This table is critical.

```text
id UUID PK
business_id UUID FK
parcel_id UUID FK
order_id UUID FK

event_type VARCHAR

performed_by UUID FK user
device_id VARCHAR NULL

metadata JSONB NULL

created_at TIMESTAMP
```

Event types:

```text
PACKED
DISPATCHED
RETURN_RECEIVED
RTO_RECEIVED
INSPECTED
REFUND_VERIFIED
```

Never overwrite scan history.

---

## 8.10 payments

```text
id UUID PK
business_id UUID FK
order_id UUID FK

shopify_transaction_id VARCHAR NULL

payment_method VARCHAR
transaction_type VARCHAR

amount DECIMAL
currency VARCHAR

status VARCHAR

processed_at TIMESTAMP NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

Transaction types:

```text
PAYMENT
REFUND
CAPTURE
VOID
```

---

## 8.11 refunds

```text
id UUID PK
business_id UUID FK
order_id UUID FK

shopify_refund_id VARCHAR

amount DECIMAL
currency VARCHAR

status VARCHAR

created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 8.12 returns

```text
id UUID PK
business_id UUID FK
order_id UUID FK
parcel_id UUID FK

return_type VARCHAR
reason VARCHAR NULL
condition VARCHAR NULL

received_at TIMESTAMP NULL
inspected_at TIMESTAMP NULL

status VARCHAR

created_by UUID FK
created_at TIMESTAMP
updated_at TIMESTAMP
```

Return types:

```text
CUSTOMER_RETURN
RTO
PARTIAL_RETURN
```

Condition:

```text
GOOD
DAMAGED
USED
WRONG_PRODUCT
MISSING_ITEM
```

---

## 8.13 reconciliations

```text
id UUID PK
business_id UUID FK
order_id UUID FK

reconciliation_status VARCHAR
severity VARCHAR

issue_code VARCHAR
issue_message TEXT

resolved BOOLEAN
resolved_by UUID NULL
resolved_at TIMESTAMP NULL

created_at TIMESTAMP
updated_at TIMESTAMP
```

Issue examples:

```text
CANCELLED_BUT_DISPATCHED
RETURN_WITHOUT_REFUND
REFUND_WITHOUT_RETURN
PAID_BUT_MISSING_PAYMENT
DUPLICATE_DISPATCH_SCAN
RETURN_QUANTITY_MISMATCH
SHOPIFY_SYNC_MISSING
```

---

## 8.14 tally_mappings

```text
id UUID PK
business_id UUID FK

transaction_type VARCHAR
payment_method VARCHAR NULL

tally_ledger_name VARCHAR
tally_voucher_type VARCHAR

tax_ledger_name VARCHAR NULL

created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 8.15 audit_logs

```text
id UUID PK
business_id UUID FK

user_id UUID NULL

entity_type VARCHAR
entity_id UUID

action VARCHAR

old_data JSONB NULL
new_data JSONB NULL

created_at TIMESTAMP
```

Audit important changes.

---

# 9. Status Model

Do NOT create one giant status field.

Use separate dimensions:

## Shopify financial status

Examples:

```text
PENDING
AUTHORIZED
PAID
PARTIALLY_REFUNDED
REFUNDED
VOIDED
```

## Shopify fulfillment status

Examples:

```text
UNFULFILLED
PARTIALLY_FULFILLED
FULFILLED
```

## Application operational status

```text
NEW
READY_TO_PACK
PACKED
DISPATCHED
DELIVERED
RETURN_REQUESTED
RETURN_RECEIVED
RTO
CANCELLED
CLOSED
```

This separation prevents status logic from becoming impossible to maintain.

---

# 10. Shopify Integration

## 10.1 Shopify app requirements

Use Shopify's supported app authentication process.

The application should obtain only the permissions it actually needs.

Potential data requirements:

- Read orders
- Read customers
- Read products
- Read fulfillment information
- Read transaction/refund information
- Return/cancellation information as needed

Verify current Shopify API scopes and API version against Shopify developer documentation before production release.

---

# 11. Initial Shopify Sync

When a store connects:

```text
1. Authenticate
2. Store credentials securely
3. Pull recent orders
4. Upsert customers
5. Upsert products
6. Upsert orders
7. Upsert order items
8. Upsert payments/transactions where available
9. Create missing parcels
10. Generate barcodes
11. Run reconciliation
12. Save last_sync_at
```

Start with a configurable history window.

Example MVP:

```text
Last 30 days
```

Later allow:

```text
7 days
30 days
90 days
1 year
```

Do not import unlimited historical data by default.

---

# 12. Shopify Webhooks

Subscribe to the events that actually matter to your workflow.

Examples:

```text
orders/create
orders/updated
orders/cancelled
refunds/create
fulfillments/create
fulfillments/update
returns/create
```

The exact webhook names/topics and permissions must be confirmed against the Shopify API version being used during implementation.

---

# 13. Webhook Processing

Never directly perform large processing inside the webhook request.

Use this pattern:

```text
Shopify
  |
  v
Webhook endpoint
  |
  +-- Verify webhook authenticity
  |
  +-- Store event
  |
  +-- Return success quickly
  |
  v
Background processing
  |
  v
Update database
  |
  v
Run reconciliation
```

Create a table:

```text
shopify_webhook_events
```

with:

```text
id
shop_domain
topic
shopify_event_id / webhook_id
payload
received_at
processed_at
processing_status
error_message
```

This makes webhook processing idempotent and debuggable.

---

# 14. Idempotency

This is mandatory.

The same webhook may be delivered more than once.

Never create:

```text
Order A
Order A duplicate
Order A duplicate
```

Use unique constraints such as:

```text
business_id + shopify_order_id
business_id + shopify_transaction_id
business_id + shopify_refund_id
business_id + webhook_id
```

Use UPSERT logic where appropriate.

---

# 15. Barcode Generation

## 15.1 Barcode format

Use:

```text
PKG-2026-00000001
```

or shorter:

```text
P00000001
```

Barcode value should be unique globally within the business.

Do not encode:

- Customer phone
- Customer address
- Payment amount
- Sensitive information

---

# 16. Barcode Label

MVP label:

```text
--------------------------------
BUSINESS NAME

Order: #10452
Parcel: P00001452

Customer: Rahul
Items: 2

|||||||||||||||||||||||||||||||
P00001452

--------------------------------
```

Generate printable PDF or browser-printable HTML.

Support:

- A4 sheet printing
- Basic thermal-label size later

---

# 17. Dispatch Scanning Workflow

## Worker UI

Page:

```text
/scan/dispatch
```

Screen:

```text
SCAN PARCEL

[_____________________]

Last Scan:
Order #10452
₹1,499
PAID
READY TO PACK

[CONFIRM DISPATCH]
```

USB scanner can type the barcode into the field automatically.

After scan:

```text
Barcode
  |
  v
Find parcel
  |
  v
Find order
  |
  v
Validate current state
  |
  +--> invalid -> show error
  |
  +--> already dispatched -> warning
  |
  +--> cancelled -> block shipment
  |
  +--> valid -> allow dispatch
```

---

# 18. Dispatch Validation Rules

## Rule 1

Cancelled order must not be dispatched.

```text
IF order.cancelled = true
THEN block dispatch
```

## Rule 2

Already dispatched:

```text
IF dispatch scan exists
THEN block duplicate dispatch
```

## Rule 3

Parcel does not exist:

```text
THEN INVALID_BARCODE
```

## Rule 4

Inactive user:

```text
THEN reject operation
```

## Rule 5

Order is not ready:

For example:

```text
REFUNDED
```

should generally not be dispatched unless an authorized manual override exists.

---

# 19. Return/RTO Scan Workflow

Page:

```text
/scan/return
```

Worker scans:

```text
P00001452
```

System displays:

```text
Order #10452

Customer: Rahul
Product: Shoes
Order amount: ₹1,499

Original dispatch:
27-09-2026 10:15

Return Type:
[ CUSTOMER RETURN ]
[ RTO ]

Condition:
[ GOOD ]
[ DAMAGED ]
[ USED ]
[ WRONG PRODUCT ]

[CONFIRM RETURN]
```

After confirmation:

```text
Create return record
Create scan event
Update parcel
Update operational status
Run reconciliation
```

---

# 20. Return Quantity

Do not assume entire order is returned.

Example:

```text
Ordered:
3 units

Returned:
2 units
```

Add return items:

```text
return_items
```

Schema:

```text
id
return_id
order_item_id
quantity
condition
```

This is needed before the product can support partial returns correctly.

---

# 21. Cancellation Workflow

Cancellation may originate in Shopify.

Your system should not let warehouse staff manually alter Shopify cancellation status.

Instead:

```text
Shopify cancellation
      |
      v
Webhook
      |
      v
Update order
      |
      v
Run reconciliation
```

Dashboard should clearly show:

```text
CANCELLED
DO NOT DISPATCH
```

---

# 22. Cancellation After Packing/Dispatch

This is an important exception.

Example:

```text
10:00 Packed
10:30 Cancelled in Shopify
```

Reconciliation:

```text
WARNING:
ORDER CANCELLED AFTER PACKING
```

If:

```text
10:00 Dispatched
10:30 Cancelled
```

flag:

```text
HIGH:
ORDER CANCELLED AFTER DISPATCH
```

Do not silently change physical history.

Keep both:

```text
Shopify status
Physical event history
```

---

# 23. Reconciliation Engine

This should be a separate service/module.

Function:

```text
reconcile_order(order_id)
```

Input:

- Shopify state
- Payment state
- Refund state
- Return state
- Physical scans
- Operational status

Output:

```text
status = RECONCILED / EXCEPTION
issues[]
```

---

# 24. Reconciliation Rules

Implement MVP rules individually.

## R001 — Cancelled but dispatched

```text
IF order is cancelled
AND dispatch event exists

=> EXCEPTION
CANCELLED_BUT_DISPATCHED
```

---

## R002 — Returned but refund missing

```text
IF return received
AND refund expected
AND no refund exists

=> EXCEPTION
RETURN_WITHOUT_REFUND
```

Do not make “refund expected” blindly true for every return. Support a configurable rule or mark as review-required.

---

## R003 — Refund without physical return

```text
IF refund exists
AND no return exists

=> REVIEW
REFUND_WITHOUT_RETURN
```

This can be legitimate for some businesses.

---

## R004 — Paid but no payment record

```text
IF Shopify financial status = PAID
AND payment transaction missing

=> EXCEPTION
PAYMENT_DATA_MISSING
```

---

## R005 — Duplicate dispatch

```text
dispatch_event_count > 1
=> EXCEPTION
DUPLICATE_DISPATCH_SCAN
```

---

## R006 — Return without dispatch

```text
return_event exists
AND dispatch_event missing

=> REVIEW/EXCEPTION
RETURN_WITHOUT_DISPATCH
```

---

## R007 — Quantity mismatch

```text
sum(returned_qty) > sum(ordered_qty)
=> EXCEPTION
RETURN_QUANTITY_MISMATCH
```

---

## R008 — Shopify sync gap

If:

```text
Shopify updated_at > local last processed update
```

after a defined grace period:

```text
SYNC_DELAY
```

---

# 25. Exception Dashboard

Page:

```text
/exceptions
```

Columns:

```text
Order
Issue
Severity
Detected At
Status
Action
```

Example:

```text
#10452
RETURN_WITHOUT_REFUND
HIGH
27 Sep 10:45
OPEN
[VIEW]

#10473
CANCELLED_BUT_DISPATCHED
CRITICAL
27 Sep 11:10
OPEN
[VIEW]
```

Filters:

```text
OPEN
RESOLVED
HIGH
MEDIUM
LOW
DATE
ISSUE TYPE
```

---

# 26. Order Detail Page

Page:

```text
/orders/:id
```

Layout:

```text
Order #10452

CUSTOMER
Rahul
Phone
Address

FINANCIAL
Total       ₹1,499
Payment     PAID
Refund      ₹0

SHOPIFY
Financial     PAID
Fulfillment   FULFILLED
Cancellation  None

PHYSICAL
Parcel        P00001452
Status        RETURN_RECEIVED

TIMELINE
10:00 Created
10:05 Paid
10:20 Packed
10:25 Dispatched
17:15 Return Received

RECONCILIATION
⚠ Refund not found
```

---

# 27. Timeline UI

Use event history instead of only displaying the current status.

Example:

```text
● Order Created
|
● Payment Received
|
● Parcel Created
|
● Packed
|
● Dispatched
|
● Returned
|
○ Refund Pending
```

This is one of the most useful views for business users.

---

# 28. Dashboard

Page:

```text
/dashboard
```

MVP KPIs:

```text
Orders Today
Paid Orders
Cancelled Orders
Packed Orders
Dispatched Orders
Delivered Orders
Returns
RTO
Refunds
Open Exceptions
```

Financial summary:

```text
Gross Sales
Discounts
Tax
Shipping
Refunds
Net Sales
```

Use database queries instead of calculating financial summaries only on the frontend.

---

# 29. Search Requirements

User should be able to search by:

```text
Shopify order number
Internal order ID
Parcel ID
Barcode
Customer name
Customer phone
SKU
Tracking number
```

Barcode should give the fastest lookup.

---

# 30. Excel Export

Do not produce one giant flat sheet only.

Generate workbook:

```text
ecommerce_reconciliation_2026-09-27.xlsx
```

Sheets:

```text
Orders
Order_Items
Payments
Returns
Refunds
Scan_Events
Reconciliation
Tally_Export
Summary
```

---

# 31. Orders Excel Columns

```text
Internal Order ID
Shopify Order ID
Order Number
Order Date
Customer Name
Customer Phone
Subtotal
Discount
Shipping
Tax
Total
Payment Status
Fulfillment Status
Operational Status
Cancelled At
Cancellation Reason
Parcel ID
Created At
Updated At
```

---

# 32. Scan Events Excel Columns

```text
Event ID
Order ID
Parcel ID
Event Type
Employee
Device
Date
Time
Timestamp
```

---

# 33. Payment Excel Columns

```text
Order ID
Transaction ID
Payment Method
Transaction Type
Amount
Currency
Status
Processed At
```

---

# 34. Return Excel Columns

```text
Return ID
Order ID
Parcel ID
Return Type
Reason
Condition
Returned Quantity
Received At
Inspected At
Status
```

---

# 35. Reconciliation Excel Columns

```text
Order ID
Issue Code
Severity
Issue Message
Detected At
Resolved
Resolved By
Resolved At
```

---

# 36. Excel Formatting

Excel should be business-readable.

Use:

- Freeze header rows
- Auto filters
- Correct number formats
- Date/time formats
- Currency formatting
- Column widths
- Excel tables
- Conditional formatting for exceptions
- Summary totals

Do not put formulas in critical accounting fields when values are available from the backend. Generate final values server-side so exports are reproducible.

---

# 37. Tally Export Architecture

Do not hard-code one company's ledger structure.

Create a mapping screen:

```text
Transaction              Tally Voucher
----------------------------------------
Sale                     Sales
Sales Return             Sales Return
Refund                   Credit Note
Payment                  Receipt
Shipping Expense         Expense
```

Ledger mapping:

```text
Razorpay
    -> Razorpay Settlement

COD
    -> Cash / COD Receivable

Sales
    -> Sales Account

CGST
    -> Output CGST

SGST
    -> Output SGST

IGST
    -> Output IGST
```

The exact accounting treatment must be configured with the business/accountant.

---

# 38. Tally Mapping UI

Page:

```text
/settings/tally
```

Sections:

### Voucher mappings

```text
Sale                 [Sales]
Sales Return         [Sales Return]
Refund               [Credit Note]
```

### Payment mappings

```text
Razorpay             [Razorpay Settlement]
COD                  [COD Receivable]
```

### Tax mappings

```text
CGST                 [Output CGST]
SGST                 [Output SGST]
IGST                 [Output IGST]
```

---

# 39. Tally Validation

Before generating file:

```text
Validate:
- Voucher type exists
- Ledger mapping exists
- Date exists
- Amount > 0
- Debit/credit totals balance
- Required account names present
- No duplicate export key
```

If validation fails:

```text
Cannot export.

5 orders have missing ledger mappings.
```

Do not generate partially valid accounting exports without a clear warning.

---

# 40. Tally Export Idempotency

Critical.

If accountant exports the same day twice, do not accidentally create duplicate accounting transactions.

Generate:

```text
export_batch_id
```

Example:

```text
TALLY-2026-09-27-0007
```

Store:

```text
export_batches
```

with:

```text
id
business_id
date_from
date_to
generated_at
generated_by
record_count
file_hash
status
```

Use a unique accounting reference for exported transactions.

---

# 41. Export Strategy

MVP:

```text
Your System
   |
   v
Tally-compatible Excel
   |
   v
User imports into TallyPrime
```

Later:

```text
Direct Tally integration
```

Do not make direct integration a blocker for MVP.

---

# 42. API Design

Base path:

```text
/api/v1
```

## Authentication

```http
POST /auth/login
POST /auth/logout
GET  /auth/me
```

## Shopify

```http
GET  /shopify/connect
GET  /shopify/callback
POST /shopify/sync
GET  /shopify/status
DELETE /shopify/disconnect
```

## Orders

```http
GET /orders
GET /orders/{id}
GET /orders/{id}/timeline
GET /orders/{id}/reconciliation
```

Query params:

```text
?search=
?status=
?payment_status=
?date_from=
?date_to=
?page=
?page_size=
```

## Parcels

```http
GET /parcels/{barcode}
POST /parcels/{id}/label
```

## Scanning

```http
POST /scan/dispatch
POST /scan/return
POST /scan/rto
```

Example request:

```json
{
  "barcode": "P00001452"
}
```

Return scan:

```json
{
  "barcode": "P00001452",
  "return_type": "CUSTOMER_RETURN",
  "condition": "GOOD"
}
```

## Reconciliation

```http
POST /reconciliation/order/{id}
POST /reconciliation/run
GET  /reconciliation/issues
POST /reconciliation/issues/{id}/resolve
```

## Reports

```http
GET /reports/dashboard
GET /reports/orders
GET /reports/returns
GET /reports/payments
```

## Excel

```http
POST /exports/excel
GET  /exports/{id}
```

## Tally

```http
GET  /tally/mappings
PUT  /tally/mappings
POST /tally/validate
POST /tally/export
GET  /tally/exports
```

---

# 43. API Response Standard

Use consistent response formats.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "PARCEL_ALREADY_DISPATCHED",
    "message": "This parcel has already been dispatched."
  }
}
```

Do not make the frontend parse arbitrary backend error messages.

---

# 44. Backend Module Structure

Recommended:

```text
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   │
│   ├── models/
│   │   ├── business.py
│   │   ├── user.py
│   │   ├── shopify_store.py
│   │   ├── customer.py
│   │   ├── product.py
│   │   ├── order.py
│   │   ├── order_item.py
│   │   ├── parcel.py
│   │   ├── scan_event.py
│   │   ├── payment.py
│   │   ├── refund.py
│   │   ├── return.py
│   │   ├── reconciliation.py
│   │   ├── tally_mapping.py
│   │   └── audit_log.py
│   │
│   ├── schemas/
│   ├── api/
│   │   ├── auth.py
│   │   ├── shopify.py
│   │   ├── orders.py
│   │   ├── scanning.py
│   │   ├── reconciliation.py
│   │   ├── reports.py
│   │   ├── exports.py
│   │   └── tally.py
│   │
│   ├── services/
│   │   ├── shopify_service.py
│   │   ├── order_service.py
│   │   ├── barcode_service.py
│   │   ├── scanning_service.py
│   │   ├── reconciliation_service.py
│   │   ├── excel_service.py
│   │   └── tally_service.py
│   │
│   ├── workers/
│   └── utils/
│
├── migrations/
├── tests/
├── requirements.txt
└── Dockerfile
```

---

# 45. Frontend Structure

```text
frontend/
├── app/
│   ├── login/
│   ├── dashboard/
│   ├── orders/
│   ├── parcels/
│   ├── scan/
│   │   ├── dispatch/
│   │   └── return/
│   ├── returns/
│   ├── exceptions/
│   ├── reports/
│   └── settings/
│       ├── shopify/
│       └── tally/
│
├── components/
│   ├── ui/
│   ├── order/
│   ├── scan/
│   ├── dashboard/
│   └── reports/
│
├── lib/
│   ├── api.ts
│   ├── auth.ts
│   └── validations.ts
│
├── hooks/
└── types/
```

---

# 46. Scan UX Requirements

The scan page must optimize for warehouse speed.

Do:

- Large scanner input
- Automatically focus input
- Clear success/failure status
- Keyboard shortcut support
- Minimal clicks
- Large touch targets
- Recent scan history
- Sound feedback optionally
- Color-independent status icons/text
- Fast response

Avoid:

- Multi-step forms for normal dispatch
- Opening a modal for every scan
- Requiring mouse interaction after every scan
- Typing customer details

Ideal workflow:

```text
FOCUS INPUT
   ↓
SCAN
   ↓
VALIDATE
   ↓
SUCCESS/ERROR
   ↓
AUTO-FOCUS
   ↓
NEXT SCAN
```

---

# 47. Mobile Camera Scanning

For mobile:

```text
/scan/mobile
```

Flow:

```text
Open camera
   ↓
Detect barcode
   ↓
Pause scan
   ↓
Lookup parcel
   ↓
Show result
   ↓
Perform action
   ↓
Resume scanner
```

Do not require a native mobile app for MVP.

A responsive PWA is enough.

---

# 48. Authentication

MVP authentication:

```text
Email
Password
```

Password requirements:

- Strong password
- Hashed with Argon2id or bcrypt
- Never store plaintext password

Session:

- Secure HTTP-only cookies preferred

Add later:

- Google login
- Passkeys
- 2FA

---

# 49. Authorization

Permission examples:

## ADMIN

```text
Everything
```

## WAREHOUSE

```text
View order basic information
Scan dispatch
Scan return
Scan RTO
View parcel
```

No:

```text
Tally mapping
Financial configuration
Shopify credentials
```

## ACCOUNTANT

```text
View financial data
Reconciliation
Excel export
Tally export
```

## VIEWER

```text
Read-only dashboard
Orders
Reports
```

Always enforce permissions on the backend.

Frontend hiding buttons is not security.

---

# 50. Audit Requirements

Audit:

```text
Order status manual override
Return confirmation
Return condition
Reconciliation resolution
Tally mapping changes
User creation
Role changes
Shopify connection
Exports
Manual corrections
```

Do not audit every page visit.

Audit business-critical mutations.

---

# 51. Manual Override

Do not initially allow warehouse workers to override important states.

For MVP:

```text
Normal workers:
No status override

Admin:
Manual correction with mandatory reason
```

Example:

```text
Override:
CANCELLED -> READY_TO_PACK

Reason:
"Customer requested reactivation through WhatsApp."
```

Record the reason in audit logs.

---

# 52. Sync Reliability

Implement:

## Full sync

User clicks:

```text
Sync Now
```

Backend:

```text
Fetch Shopify data
Upsert
Reconcile
Update last_sync_at
```

## Incremental sync

Use:

```text
Shopify updated_at
```

to fetch changes since last successful sync where supported by the chosen API strategy.

## Retry

Retry transient failures using exponential backoff.

Do not retry permanent validation errors forever.

---

# 53. Rate Limiting and API Protection

Protect:

```text
/login
/scan/*
/exports/*
/shopify/sync
```

Example conceptual limits:

```text
Login: low rate
Sync: one active sync per store
Exports: limit concurrent jobs
Scan: high throughput
```

Scan endpoints must be fast enough for warehouse usage.

---

# 54. Transaction Safety for Scans

A scan operation should run inside a database transaction.

Example:

```text
BEGIN

Load parcel FOR UPDATE

Validate status

Create scan_event

Update parcel status

Update order operational status

Create/update reconciliation

COMMIT
```

This protects against two workers scanning the same parcel simultaneously.

---

# 55. Concurrency Test

Test:

```text
Worker A scans P001
Worker B scans P001
```

Expected:

```text
Only one DISPATCHED event
Second request:
PARCEL_ALREADY_DISPATCHED
```

This is a critical acceptance test.

---

# 56. Data Integrity Constraints

Add database constraints where possible.

Examples:

```text
parcel.barcode_value UNIQUE

business + shopify_order_id UNIQUE

business + shopify_refund_id UNIQUE

order_item.quantity >= 0

return_item.quantity >= 0

amount >= 0
```

Use foreign keys.

Use indexes on:

```text
orders.shopify_order_id
orders.order_date
orders.operational_status
orders.customer_id

parcels.barcode_value
parcels.order_id

scan_events.parcel_id
scan_events.created_at

reconciliations.resolved
reconciliations.issue_code
```

---

# 57. Search Performance

Barcode lookup must be indexed.

Primary query:

```sql
SELECT ...
FROM parcels
WHERE business_id = :business_id
AND barcode_value = :barcode;
```

Target practical response:

```text
< 300 ms
```

under normal MVP load.

---

# 58. Error Handling

Common scan errors:

```text
INVALID_BARCODE
PARCEL_NOT_FOUND
ORDER_CANCELLED
PARCEL_ALREADY_DISPATCHED
PARCEL_ALREADY_RETURNED
RETURN_NOT_ALLOWED
USER_NOT_AUTHORIZED
SHOPIFY_SYNC_PENDING
```

Messages should be actionable.

Bad:

```text
Error 400
```

Good:

```text
This parcel has already been dispatched at 10:42 AM by Raj.
```

---

# 59. Logging

Backend should log:

```text
request ID
user ID
business ID
endpoint
status
latency
error code
Shopify webhook ID
```

Do not log:

- Shopify access tokens
- Passwords
- Sensitive personal information unnecessarily

---

# 60. Observability

MVP minimum:

- Application logs
- Error monitoring
- Database health
- Shopify webhook processing errors
- Failed background jobs
- Sync timestamp

Later:

- Metrics
- Tracing
- Prometheus
- Grafana

---

# 61. Backup Strategy

Production PostgreSQL:

- Automated backups
- Point-in-time recovery if available
- Retention policy
- Restore test

A backup that has never been restored/tested should not be considered reliable.

---

# 62. Security Requirements

Mandatory:

```text
HTTPS
Secure cookies
Password hashing
Encrypted Shopify credentials
Server-side authorization
Input validation
SQL injection protection through ORM/parameterized queries
CSRF protection where applicable
Webhook authenticity verification
Rate limiting
Audit logs
Backups
```

Never send the Shopify access token to the browser.

---

# 63. Privacy

Customer data is business data.

Minimize what the app stores.

For MVP, store only what is necessary:

```text
Name
Phone
Email
Address
Order information
```

Implement deletion/retention strategy later according to business and legal requirements.

---

# 64. Testing Strategy

Testing is not optional because this system affects financial records.

Use four layers.

## Unit tests

Test:

```text
Barcode generation
Status transition rules
Reconciliation rules
Tally mappings
Excel generation
Amount calculations
```

## Integration tests

Test:

```text
API + PostgreSQL
Shopify webhook processing
Scan transaction
Return processing
Reconciliation pipeline
```

## End-to-end tests

Test complete user workflows:

```text
Shopify order
-> sync
-> barcode
-> dispatch
-> return
-> refund
-> reconciliation
-> Excel
-> Tally export
```

---

# 65. Required Test Cases

## Order tests

```text
Create order
Update order
Cancel order
Refund order
Fulfillment update
```

## Scan tests

```text
Valid dispatch
Invalid barcode
Duplicate dispatch
Cancelled order dispatch
Return scan
Duplicate return
RTO scan
Concurrent scans
```

## Reconciliation tests

```text
Cancelled + dispatched
Return + no refund
Refund + no return
Paid + missing transaction
Return quantity mismatch
No issues
```

## Export tests

```text
Correct Excel columns
Correct totals
Correct dates
Correct currency
Correct Tally mappings
Missing mapping validation
Duplicate export protection
```

---

# 66. Seed Test Dataset

Create at least 15 synthetic orders covering:

```text
1 Normal delivered order
2 Cancelled before packing
3 Cancelled after packing
4 Cancelled after dispatch
5 Prepaid delivered
6 COD delivered
7 Full return + refund
8 Return + refund pending
9 RTO
10 Partial return
11 Partial refund
12 Refund without return
13 Duplicate scan
14 Missing Shopify transaction
15 Completely reconciled order
```

This dataset becomes the regression suite.

---

# 67. MVP Acceptance Criteria

The MVP is acceptable only when all of the following work:

### Shopify

```text
Connect store
Import orders
Receive changes
Handle cancellation
Handle refund
Handle fulfillment
```

### Barcode

```text
Generate unique barcode
Print barcode
Scan barcode
Lookup order
```

### Dispatch

```text
Valid order -> dispatch
Cancelled order -> blocked
Duplicate dispatch -> blocked
```

### Return

```text
Scan return
Select reason
Record condition
Update parcel
Update order
```

### Reconciliation

```text
Automatically detect mismatches
Display exception
Resolve exception
Maintain history
```

### Reporting

```text
Orders report
Returns report
Scan report
Exception report
```

### Excel

```text
Generate workbook
Correct totals
Readable formatting
```

### Tally

```text
Configure mappings
Validate export
Generate Tally-compatible file
Prevent duplicate export
```

---

# 68. Development Phases

## Phase 1 — Project Foundation

Tasks:

```text
Create Git repository
Create backend
Create frontend
Create PostgreSQL database
Configure environment variables
Configure migrations
Configure linting
Configure formatting
Configure testing
Configure Docker
```

Deliverable:

```text
Frontend + Backend + DB running locally
```

---

# 69. Phase 2 — Authentication and Tenant Model

Build:

```text
businesses
users
roles
login
session
authorization
```

Deliverable:

```text
Admin can log in
Create warehouse user
Create accountant user
```

---

# 70. Phase 3 — Shopify Connection

Build:

```text
Shopify OAuth
Store token storage
Store verification
Initial sync
Order mapping
Customer mapping
Product mapping
```

Deliverable:

```text
Shopify orders appear inside the app
```

---

# 71. Phase 4 — Order and Parcel Core

Build:

```text
orders
order_items
parcels
barcode generation
label generation
```

Deliverable:

```text
Every eligible order gets a parcel ID and barcode
```

---

# 72. Phase 5 — Dispatch Scanner

Build:

```text
dispatch scan page
barcode lookup
validation rules
scan event creation
order status update
audit trail
```

Deliverable:

```text
Warehouse staff can scan parcels for dispatch
```

---

# 73. Phase 6 — Return/RTO Scanner

Build:

```text
return page
RTO workflow
condition
reason
return items
scan events
```

Deliverable:

```text
Returned parcels are attached to original orders
```

---

# 74. Phase 7 — Webhooks

Build:

```text
webhook endpoint
signature validation
webhook event storage
async processing
idempotency
retry
```

Deliverable:

```text
Shopify cancellations/refunds/updates automatically reach the application
```

---

# 75. Phase 8 — Reconciliation Engine

Build:

```text
reconciliation_service.py
```

Implement:

```text
R001
R002
R003
R004
R005
R006
R007
R008
```

Deliverable:

```text
System identifies mismatches without manual checking
```

---

# 76. Phase 9 — Dashboard and Exceptions

Build:

```text
dashboard
order detail
timeline
exceptions page
filters
resolve action
```

Deliverable:

```text
Owner can understand what went wrong without opening multiple systems
```

---

# 77. Phase 10 — Excel Export

Build:

```text
orders export
payments export
returns export
scan logs
reconciliation
summary
```

Deliverable:

```text
One-click daily workbook generation
```

---

# 78. Phase 11 — Tally Export

Build:

```text
mapping UI
voucher mapping
ledger mapping
validation
export batch
Tally Excel generation
```

Deliverable:

```text
Accountant can download a Tally-ready workbook
```

---

# 79. Phase 12 — Testing and Hardening

Run:

```text
Unit tests
Integration tests
E2E tests
Concurrency tests
Webhook retries
Large export tests
Security tests
```

Deliverable:

```text
Production candidate
```

---

# 80. Phase 13 — Deployment

## Frontend

```text
Vercel
```

## Backend

```text
Render / AWS
```

## Database

```text
Managed PostgreSQL
```

## Redis

Only if needed:

```text
Managed Redis
```

## Domain

Example:

```text
app.yourdomain.com
api.yourdomain.com
```

---

# 81. Environment Variables

Example:

```env
DATABASE_URL=
REDIS_URL=

JWT_SECRET=
ENCRYPTION_KEY=

SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_API_VERSION=

NEXT_PUBLIC_API_URL=
```

Never commit `.env`.

Provide:

```text
.env.example
```

---

# 82. Docker

Backend Docker container should support:

```text
uvicorn app.main:app
```

Use a multi-stage build if image size becomes important.

Local development:

```text
docker compose
   |
   +-- postgres
   +-- redis
   +-- backend
```

Frontend can run separately with Next.js.

---

# 83. CI/CD

GitHub Actions:

```text
Push
 |
 +-- frontend lint
 +-- frontend tests
 +-- backend lint
 +-- backend tests
 +-- migration check
 |
 v
Deploy
```

Block deployment when tests fail.

---

# 84. Git Branching

Simple MVP approach:

```text
main
develop
feature/*
```

Examples:

```text
feature/shopify-sync
feature/dispatch-scanner
feature/reconciliation
feature/tally-export
```

Use pull requests even if you are working alone.

It makes changes easier to review and revert.

---

# 85. Recommended Development Order

Do not build the UI first and invent the backend later.

Build in this order:

```text
1. Database schema
2. Domain/status model
3. Backend services
4. Shopify sync
5. Parcel/barcode
6. Scan transactions
7. Reconciliation
8. Reports/exports
9. UI polish
```

This prevents the frontend from being built around incorrect assumptions.

---

# 86. First Database Migration

Create:

```text
businesses
users
shopify_stores
customers
products
orders
order_items
parcels
scan_events
payments
refunds
returns
return_items
reconciliations
tally_mappings
audit_logs
```

Add indexes before performance problems appear.

---

# 87. Domain Service Boundaries

Avoid putting all business logic inside API route handlers.

Bad:

```python
@app.post("/scan/dispatch")
def dispatch():
    # 300 lines of business logic
```

Better:

```python
@app.post("/scan/dispatch")
def dispatch(request):
    return scanning_service.dispatch_parcel(request)
```

Then:

```text
services/scanning_service.py
```

contains business rules.

---

# 88. Transaction Example

Conceptual service:

```python
def dispatch_parcel(business_id, barcode, user_id):
    with db.transaction():
        parcel = get_parcel_for_update(business_id, barcode)

        if not parcel:
            raise ParcelNotFound()

        if parcel.order.cancelled_at:
            raise OrderCancelled()

        if already_dispatched(parcel):
            raise AlreadyDispatched()

        create_scan_event(
            parcel=parcel,
            event_type="DISPATCHED",
            user_id=user_id,
        )

        parcel.status = "DISPATCHED"
        parcel.order.operational_status = "DISPATCHED"

        create_audit_log(...)
```

This pattern should be used for important state transitions.

---

# 89. Reconciliation Service Design

Use separate rule functions.

```python
def check_cancelled_but_dispatched(order):
    ...

def check_return_without_refund(order):
    ...

def check_refund_without_return(order):
    ...

def check_missing_payment(order):
    ...

def check_duplicate_dispatch(order):
    ...

def check_return_quantity(order):
    ...
```

Then:

```python
def reconcile_order(order):
    issues = []

    issues += check_cancelled_but_dispatched(order)
    issues += check_return_without_refund(order)
    issues += check_refund_without_return(order)
    issues += check_missing_payment(order)
    issues += check_duplicate_dispatch(order)
    issues += check_return_quantity(order)

    save_issues(issues)

    return issues
```

This is much easier to test than one giant function.

---

# 90. Event-Driven Mental Model

Treat important activities as events:

```text
ORDER_CREATED
PAYMENT_RECEIVED
ORDER_CANCELLED
PARCEL_CREATED
PARCEL_PACKED
PARCEL_DISPATCHED
RETURN_RECEIVED
REFUND_CREATED
REFUND_COMPLETED
```

The database stores the current state AND event history.

This gives you:

```text
Current state
+
Historical truth
```

---

# 91. Accounting Principle for MVP

Your system should not claim:

> “We are replacing Tally.”

Instead:

> “We prepare reconciled operational/accounting data for Tally.”

Tally remains the accounting system of record for the business unless/until you deliberately build a complete accounting system.

This keeps the MVP realistic.

---

# 92. Tally Data Pipeline

```text
Shopify
   |
   v
Order Ledger
   |
   v
Physical Scan Events
   |
   v
Reconciliation
   |
   v
Accounting Transaction Builder
   |
   v
Tally Mapping
   |
   v
Validation
   |
   v
Tally Excel
```

Never skip reconciliation before accounting export.

---

# 93. Important Financial Safeguard

The system should never silently create accounting transactions from an unresolved exception.

Example:

```text
Returned
Refund status unclear
```

Do not automatically finalize accounting as if everything is complete.

Instead:

```text
ACCOUNTING REVIEW REQUIRED
```

This prevents bad operational data from becoming bad accounting data.

---

# 94. Daily Workflow

A realistic business workflow:

## Morning

```text
Shopify sync
     |
     v
Orders dashboard
     |
     v
Print parcel labels
```

## Packing

```text
Pack parcel
     |
     v
Label attached
```

## Dispatch

```text
Scan barcode
     |
     v
Dispatch confirmed
```

## Returns

```text
Return arrives
     |
     v
Scan barcode
     |
     v
Inspection
     |
     v
Return recorded
```

## Evening

```text
Shopify sync
     |
     v
Reconciliation
     |
     v
Exceptions
     |
     v
Excel / Tally export
```

---

# 95. MVP UI Pages

Minimum pages:

```text
/login

/dashboard

/orders
/orders/:id

/scan/dispatch
/scan/return

/returns

/exceptions

/reports

/exports

/settings/shopify
/settings/tally
/settings/users
```

---

# 96. Navigation

Recommended:

```text
Dashboard
Orders
Scan
Returns
Exceptions
Reports
Exports

Settings
  Shopify
  Tally
  Users
```

Keep scanning one click away from the main navigation.

---

# 97. Dashboard Color Semantics

Do not rely only on color.

Use:

```text
✅ Reconciled
⚠ Review
❌ Exception
```

And also explicit labels:

```text
RECONCILED
REVIEW REQUIRED
EXCEPTION
```

This improves accessibility.

---

# 98. Excel Reconciliation Use Case

Suppose there are 500 orders.

Without the system:

```text
Shopify
+
Excel
+
Courier list
+
Tally
```

Someone manually compares rows.

With the system:

```text
500 orders
       |
       v
reconciliation engine
       |
       +-- 485 RECONCILED
       |
       +-- 10 REVIEW
       |
       +-- 5 EXCEPTION
```

The accountant/owner focuses on 15 records instead of manually checking 500.

That is the real productivity value.

---

# 99. Success Metrics for MVP

Measure:

### Operational

```text
Average scan time
Dispatch scans per minute
Return processing time
Duplicate scan rate
```

### Reconciliation

```text
Percentage automatically reconciled
Number of exceptions
Average time to resolve exceptions
```

### Accounting

```text
Number of exported transactions
Export validation failure rate
Duplicate export count
```

### Reliability

```text
Webhook failure rate
Sync failure rate
API error rate
```

---

# 100. Customer Pilot Plan

Do not launch directly to many stores.

Pilot with 1 real e-commerce business.

Start with:

```text
1 Shopify store
1 warehouse
2-5 staff
1 accountant
7-14 days of operational data
```

Observe:

```text
Where workers make mistakes
Which status rules differ
How they currently use Excel
How accountant structures Tally
What return scenarios occur
```

Only after this should you generalize the product.

---

# 101. Critical Business Questions During Pilot

Before finalizing accounting rules, collect:

```text
Which payment gateways?
COD or prepaid?
Which courier?
How are RTOs handled?
When is refund issued?
Do they refund shipping?
How are partial returns handled?
How are discounts allocated?
How is GST recorded?
What Tally ledgers already exist?
Which voucher types are used?
How are payment gateway settlements booked?
```

These should be configuration, not assumptions.

---

# 102. MVP Deliverable Checklist

## Backend

```text
[ ] FastAPI application
[ ] PostgreSQL
[ ] Alembic
[ ] Authentication
[ ] Authorization
[ ] Shopify service
[ ] Order service
[ ] Parcel service
[ ] Scan service
[ ] Return service
[ ] Reconciliation service
[ ] Excel service
[ ] Tally service
[ ] Audit logs
```

## Frontend

```text
[ ] Login
[ ] Dashboard
[ ] Orders
[ ] Order detail
[ ] Dispatch scanner
[ ] Return scanner
[ ] Exceptions
[ ] Reports
[ ] Excel export
[ ] Shopify settings
[ ] Tally settings
[ ] User management
```

## Data

```text
[ ] Migrations
[ ] Indexes
[ ] Constraints
[ ] Seed data
[ ] Test data
```

## Testing

```text
[ ] Unit tests
[ ] Integration tests
[ ] E2E tests
[ ] Concurrency tests
[ ] Export tests
[ ] Webhook retry tests
```

## Deployment

```text
[ ] Production DB
[ ] Backend
[ ] Frontend
[ ] HTTPS
[ ] Domain
[ ] Environment secrets
[ ] Backups
[ ] Monitoring
```

---

# 103. Definition of Done

The MVP should not be considered finished merely because the pages work.

It is done when this entire scenario works:

```text
1. Customer places Shopify order
2. Application receives/syncs order
3. Parcel is generated
4. Barcode label is printed
5. Warehouse scans parcel
6. System records dispatch
7. Shopify later cancels/updates/refunds the order
8. Webhook updates local state
9. Return is physically received
10. Worker scans barcode
11. System records return
12. Reconciliation runs
13. System identifies any mismatch
14. Owner sees exception
15. Accountant resolves/configures accounting treatment
16. Excel is generated
17. Tally export is generated
18. Duplicate export is prevented
19. Audit trail remains intact
```

---

# 104. Recommended MVP Timeline

For one capable developer working full-time, a realistic implementation sequence is approximately:

```text
Week 1
Foundation + DB + Auth

Week 2
Shopify integration + initial sync

Week 3
Orders + parcels + barcode + labels

Week 4
Dispatch scanner

Week 5
Returns/RTO + event timeline

Week 6
Shopify webhooks + sync reliability

Week 7
Reconciliation engine + exceptions

Week 8
Dashboard + reports

Week 9
Excel export + Tally mapping

Week 10
Testing + security + deployment + pilot fixes
```

Treat this as an engineering planning estimate, not a guarantee. The hardest part is usually integration edge cases and accounting rules, not creating the UI.

---

# 105. Recommended First Coding Sprint

Do not start by creating the dashboard.

Start with this exact sequence:

```text
DAY 1
Create Git repository
Set up monorepo
Set up Next.js
Set up FastAPI
Set up PostgreSQL
Set up Docker
Set up .env

DAY 2
Create database models
Run Alembic
Create business/user tables
Create auth

DAY 3
Create order/order_item/customer/product models
Create CRUD APIs

DAY 4
Implement Shopify store connection
Store credentials securely

DAY 5
Implement initial Shopify order sync
Create test orders
```

At the end of Sprint 1:

```text
Shopify
   ↓
FastAPI
   ↓
PostgreSQL
   ↓
Orders visible in Next.js
```

That is the first real milestone.

---

# 106. Recommended Coding Sprint 2

```text
DAY 6
Parcel model
Barcode generation

DAY 7
Label generation
Print layout

DAY 8
Dispatch scanner API

DAY 9
Dispatch scanner UI

DAY 10
Duplicate/concurrency tests
```

Milestone:

```text
Scan barcode
   ↓
Correct order found
   ↓
Dispatch recorded
```

---

# 107. Recommended Coding Sprint 3

```text
Return model
Return items
RTO workflow
Return scanner
Timeline
Audit logs
```

Milestone:

```text
Dispatch
   ↓
Return
   ↓
Same parcel/order history
```

---

# 108. Recommended Coding Sprint 4

```text
Shopify webhooks
Webhook persistence
Idempotency
Retry
Reconciliation rules
Exceptions page
```

Milestone:

```text
Shopify changes
      +
Physical events
      |
      v
Automatic mismatch detection
```

---

# 109. Recommended Coding Sprint 5

```text
Dashboard
Reports
Excel export
Tally mapping
Tally validation
Tally export
```

Milestone:

```text
Operational data
    ↓
Reconciled report
    ↓
Tally-ready file
```

---

# 110. Final MVP Architecture

```text
                      ┌───────────────────────┐
                      │       SHOPIFY         │
                      │                       │
                      │ Orders                │
                      │ Payments              │
                      │ Cancellations         │
                      │ Refunds               │
                      │ Fulfillment           │
                      │ Returns               │
                      └──────────┬────────────┘
                                 │
                         API + Webhooks
                                 │
                                 v
                   ┌───────────────────────────┐
                   │          FASTAPI          │
                   │                           │
                   │ Order Service             │
                   │ Parcel Service            │
                   │ Scan Service              │
                   │ Return Service             │
                   │ Reconciliation Service    │
                   │ Export Service             │
                   │ Tally Service              │
                   └─────────────┬─────────────┘
                                 │
                                 v
                   ┌───────────────────────────┐
                   │       POSTGRESQL          │
                   │                           │
                   │ Orders                    │
                   │ Parcels                   │
                   │ Scan Events               │
                   │ Payments                  │
                   │ Returns                   │
                   │ Refunds                   │
                   │ Reconciliations           │
                   │ Audit Logs                │
                   └─────────────┬─────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │                           │
                   v                           v
          ┌─────────────────┐       ┌──────────────────┐
          │ Reconciliation  │       │ Export Generator │
          │ Engine          │       │                  │
          └────────┬────────┘       └────────┬─────────┘
                   │                         │
                   v                         v
          ┌─────────────────┐       ┌──────────────────┐
          │ Exception       │       │ Excel / Tally    │
          │ Dashboard       │       │ Export           │
          └─────────────────┘       └──────────────────┘
```

---

# 111. The Most Important Product Principle

The MVP should not be:

```text
Shopify -> Excel
```

It should be:

```text
Shopify
   +
Physical parcel scans
   +
Payment/refund state
   +
Return state
   +
Audit history
   |
   v
Single reconciled order ledger
   |
   +--> Exceptions
   +--> Excel
   +--> Tally export
```

The barcode is only the mechanism that connects the **physical parcel** to the **digital order**.

The actual product value is:

> **Every order has one traceable digital identity from creation to dispatch/return/refund/accounting, and the system automatically surfaces cases where those records disagree.**

---

# 112. Important Product Constraint

Do not promise customers that the software can “fix Shopify.”

Shopify remains the commerce system.

Your application becomes the operational reconciliation layer between:

```text
Shopify
Warehouse reality
Accounting
```

That distinction will keep the architecture, sales pitch, and product requirements much more realistic.

