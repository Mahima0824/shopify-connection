# Sprint 2 Spec — Parcels, Barcodes, Dispatch Scanner — 2026-09-27

Source plan: `ecommerce_order_reconciliation_mvp_implementation_plan.md` (§8.8–8.9, §15–18, §54–55, §71–72, Sprint 2 §106).
Builds on: Sprint 1 spec (`2026-09-27-sprint1-foundation-design.md`) — auth, orders, Shopify sync all DONE, 8/8 pytest green.

## 1. Goal
`Scan barcode -> correct order found -> dispatch recorded`, duplicates/cancelled blocked.
Covers plan Day 6–10 milestone exactly.

## 2. Data (new tables)
`parcels`: `id UUID PK, business_id FK, order_id FK, parcel_code UNIQUE (P00000001 per-business sequence), barcode_value UNIQUE, status (CREATED/PACKED/DISPATCHED/RETURN_RECEIVED), created_at, updated_at`.
`scan_events`: append-only (§8.9 — never overwrite): `id, business_id, parcel_id, order_id, event_type (PACKED/DISPATCHED/RETURN_RECEIVED/RTO_RECEIVED/INSPECTED/REFUND_VERIFIED), performed_by FK users, device_id NULL, metadata JSONB NULL, created_at`.
Assumption: 1 order = 1 parcel now; schema allows 1:N (parcel holds order_id, not vice versa).
Indexes: `parcels(barcode_value)`, `parcels(order_id)`, `scan_events(parcel_id, created_at)`.
Unique: `(business_id, barcode_value)`.

## 3. Barcode service (§15)
Format `P00000001` — per-business zero-padded sequence, Code 128 (`python-barcode` + Pillow for PNG; SVG string for HTML labels). No customer/phone/amount encoded. `generate_barcode(db, business_id) -> str` with DB-backed counter (MAX+1 in transaction, or per-business sequence table — MAX+1 acceptable Sprint 2, single worker assumption documented).
Auto-create parcel for every order lacking one: on Shopify sync (extend `upsert_order` post-commit hook) + backfill endpoint `POST /api/v1/parcels/backfill`.

## 4. Labels (§16)
`GET /parcels/{barcode}` returns parcel+order+customer+item-count JSON.
`GET /parcels/{id}/label` returns browser-printable HTML: business name, order name, parcel code, customer, item count, Code128 SVG + human-readable code. A4 CSS (`@media print`, multi-label grid). Thermal sizes deferred.

## 5. Dispatch API (§17–18, §54, §88)
`POST /api/v1/scan/dispatch {barcode, device_id?}` authed (WAREHOUSE+ADMIN).
Transaction: `BEGIN; SELECT parcel FOR UPDATE; validate; INSERT scan_event; UPDATE parcel.status=DISPATCHED; UPDATE order.operational_status=DISPATCHED; COMMIT`.
Rules → error codes (§43 envelope + §58): cancelled → `ORDER_CANCELLED` (block); already dispatched → `PARCEL_ALREADY_DISPATCHED`; unknown → `INVALID_BARCODE`; inactive user → 401/403 `USER_NOT_AUTHORIZED`; refunded/void → `DISPATCH_NOT_ALLOWED` unless `override=true` + ADMIN + reason (audit stub → metadata).
Success message actionable: order name, total, by whom/at (§58 good-example).
`GET /api/v1/parcels/{barcode}` for pre-scan lookup (scanner UI uses it for confirm screen).

## 6. Scanner UI (§46)
`/scan/dispatch`: giant autofocus input, USB-wedge friendly (Enter submits), keyboard shortcut (`/` refocus), success/error banner with text+icon (not color-only §97), last-scan card (order/total/payment/status), recent-scan list (local state), auto-refocus after each scan. No modal per scan, no mouse required. Confirm step only when validation warns (e.g. already dispatched shows who/when).

## 7. Testing (§55, §65)
`tests/test_dispatch.py`: valid dispatch (status flips + event row), invalid barcode 404, duplicate dispatch blocked, cancelled order blocked, concurrent double-scan (threads, one wins + `PARCEL_ALREADY_DISPATCHED`), parcel auto-created on sync. Target scan lookup <300ms indexed (§57).

## 8. Out of scope (Sprint 3+)
Return/RTO scans (§19 — table ready, no API/UI), webhooks (§74), reconciliation R001–R008 (§75), Excel/Tally, mobile camera PWA (§47), multi-parcel split UI.

## 9. Acceptance
- Every order (existing + newly synced) has exactly 1 parcel + unique barcode.
- Label prints and Code128 scans via USB wedge or typed code.
- Duplicate/cancelled/invalid scans blocked with actionable messages.
- Concurrent double-scan yields exactly 1 DISPATCHED event.
- Backend suite stays green (8 existing + new dispatch tests).
