# CSV Import Spec — No-Connection Onboarding — 2026-09-28

Source: user request + real sample `orders_export_1.csv` (4 orders #1001–#1004, single-item rows, USD, one refunded row with Refunded Amount 1025.00).
Complements Sprint 4 webhooks: same orders, same downstream (parcels, scans, reconciliation).

## 1. Goal
Merchant downloads Shopify Orders → Export → uploads CSV → preview → confirm → orders listed, parcelled, scannable, reconcilable. No Shopify credentials needed.

## 2. Format (Shopify orders-export CSV, verified against sample)
Header columns used: `Name, Email, Financial Status, Paid at, Fulfillment Status, Fulfilled at, Currency, Subtotal, Shipping, Taxes, Total, Discount Code, Discount Amount, Created at, Lineitem quantity, Lineitem name, Lineitem price, Lineitem sku, Cancelled at, Payment Method, Refunded Amount, Id, Phone`.
Rules:
- Group rows by `Name` (multi-item orders span rows; sample has 1 row/order but parser must group).
- `Id` (e.g. 7193174442228) → `shopify_order_id = "gid://shopify/Order/<Id>"` — real IDs, so a later webhook/sync for the same order upserts instead of duplicating. Fallback if Id empty: `"csv:<Name>"`.
- `Created at` format `2026-09-28 07:03:27 -0400` → parse with `%Y-%m-%d %H:%M:%S %z`, store UTC.
- Financial map: paid→PAID, refunded→REFUNDED (+ create Refund row for Refunded Amount if > 0), pending→PENDING, voided→VOIDED, authorized→AUTHORIZED; unknown → PENDING + warning.
- Fulfillment map: unfulfilled→UNFULFILLED, fulfilled→FULFILLED, partial→PARTIALLY_FULFILLED; unknown → UNFULFILLED + warning.
- `Cancelled at` non-empty → set cancelled_at (+ cancel_reason "imported cancelled").
- Customer: Email/Phone may be empty (sample has none) → create customer with name from Billing/Shipping Name or "Unknown", email/phone nullable.
- Line items: quantity/price/sku/title per row; empty item rows (Name-only continuation lines Shopify sometimes emits) skipped silently.
- Amounts: float-parse with comma tolerance; unparseable numeric → row error (skip whole order? No — skip the ITEM, keep order, record warning; order-level fatal only on missing Name/Id-less identity or bad Created at → default now + warning, never fatal except missing Name).

## 3. Import service
`parse_shopify_csv(content: bytes) -> (orders: list[dict], errors: list[dict{row, reason}])` — pure function, no DB. Decodes utf-8-sig (Shopify exports BOM). Cap: 5MB / 5,000 rows (else 400 `FILE_TOO_LARGE`).
`import_orders(db, business_id, user_id, orders) -> {created, updated, skipped, order_ids}` — upsert by (business_id, shopify_order_id) reusing normalize shape + ensure_parcel_for_order + reconcile_order best-effort per order. Refund rows: upsert Refund by (business, shopify_refund_id=`csv:<orderid>:refund`).
Preview mode (`?dry_run=true`): parse + validate only, no writes, returns counts + first 10 errors.

## 4. API (ADMIN/ACCOUNTANT only)
`POST /api/v1/imports/shopify-csv` multipart field `file` (.csv only, 415 otherwise) → runs import (MVP: direct, no preview round-trip — response includes full errors list; UI shows confirm-by-uploading). Response envelope `{parsed, created, updated, skipped, errors[{row, name, reason}], order_ids}`.
`GET /api/v1/imports` → list past import batches? No batch table in MVP — skip; response summary suffices (UI shows it).

## 5. Upload UI (`/import`)
File picker (.csv) → upload → progress → result card (created/updated/skipped counts + error table row/reason) + link to /orders. Reuses content-card styles. Nav: add "Import" next to sync button on /orders page too.

## 6. Testing
`tests/test_csv_import.py` using committed fixture copy of the sample (first 4 data rows verbatim): parse groups/ids/amounts/dates; refunded row yields Refund; re-import same file → 0 created, 4 updated; malformed row (missing Name) → skipped with reason; dry-run writes nothing.
Fixture: `backend/tests/fixtures/orders_export_1.csv` (copy of user sample). NOTE: sample has no PII (emails/phones empty) — safe to commit.

## 7. Out of scope
Auto-recurring import, refunds detail lines, non-Shopify formats, >5k rows, batch history table.

## 8. Acceptance
Upload sample → 4 orders listed with correct totals/statuses (#1004 REFUNDED + refund row) → parcels exist → dispatch/return scans work → reconciliation flags nothing new (or PAYMENT_DATA_MISSING only where true) → re-upload → zero duplicates.
