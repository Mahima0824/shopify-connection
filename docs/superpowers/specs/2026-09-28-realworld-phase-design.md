# Real-World Phase Spec — P0 + Courier Core + SLA + Statements + P&L — 2026-09-28

Source: `real_world_ecommerce_reconciliation_full_mvp_implementation_plan.md` (§124 work order STEPS 1, 8–10, 12, 14–17).
P1 (STEPS 2–7) skipped: ~90% built (parcels P-format kept — NOT migrated to PKG-; existing barcodes stable).

## 1. Goal
Every dispatched parcel links to a courier AWB with tracking history; stuck parcels surface via SLA; uploaded settlement statements match against orders/shipments; monthly report + management P&L close the loop. Carrier live APIs plug in later without rework.

## 2. P0 hardening (code only; secrets/backups are user ops)
- `GET /tally/batches` returns dicts, not ORM objects (500 fix).
- Gate dev seed + open CORS behind `APP_ENV=dev` (prod defaults safe); document.
- `JWT_SECRET`/`ENCRYPTION_KEY`/backups remain user actions — checklist in README, not code.
- Webhook HMAC already verified (Sprint 4); no change.

## 3. Shipments + AWB (§22–24, §35)
New tables (migration 0006): `shipments` (business/order/parcel FKs, carrier_code, awb_number, tracking_status + carrier_status_raw, location/message/checkpoint times, tracking_url, eta, shipped/delivered/rto/returned_at, last_synced_at; UNIQUE(business, carrier, awb)), `shipment_events` (shipment FK, carrier_event_id UNIQUE per shipment, raw + normalized status, message/location/event_time/source/manual, raw JSON, received_at), `carrier_connections` (business, carrier_code UNIQUE per business, credentials_encrypted, environment, is_active, last success/error).
Dispatch flow extended: `POST /scan/dispatch {barcode, carrier_code?, awb_number?}` — when both given, create shipment (status BOOKED) in the same transaction; AWB correction endpoint (ADMIN, reason mandatory, audit, old AWB preserved in events, never silent overwrite §82).
Normalized statuses (§24 list); unknown raws → UNKNOWN + warning (never crash).

## 4. Carrier abstraction (§26–28, §32–33) — NO live keys in this phase
`backend/app/carriers/`: `base.py` (CarrierProvider: validate_credentials/get_tracking/normalize_status/build_tracking_url/capabilities), `registry.py` (DTDC/TIRUPATI/INDIA_POST/MANUAL + AGGREGATOR stub), `manual.py` (manual checkpoint entry = the working provider), `dtdc.py`/`tirupati.py`/`india_post.py` (stubs raising CARRIER_NOT_CONNECTED until credentials land).
Tracking sync: `POST /shipments/{id}/sync` pulls via provider (manual provider = no-op instructing manual entry); `POST /shipments/{id}/events` (WAREHOUSE+) records manual checkpoints (deduped by carrier_event_id); polling stops at DELIVERED/RETURNED/LOST/CLOSED. Carrier webhook route `POST /webhooks/{carrier}` persisted + HMAC-optional per provider.
When the user provides real API creds later: implement ONE adapter, no schema changes.

## 5. SLA + outstanding (§38–43)
`carrier_sla_rules` (business/carrier/event_type/start_event/allowed_days/warning_days/enabled). Calculator `sla_status(shipment, rules, now)` → NORMAL/APPROACHING/BREACHED/RESOLVED + days used. RTO clock starts at RTO_INITIATED (fallback: return event). `GET /shipments/outstanding` (filters status/carrier/SLA band) with age/deadline/amount/money-status; `shipment_cases` CRUD (RTO_DELAY/RETURN_DELAY/COD_SETTLEMENT_DELAY/LOST/DAMAGED/DELIVERY_EXCEPTION + follow-up dates + resolve). Money-at-risk = unsettled COD + pending refunds + breached-shipment value, computed once in `money_service` (no double-count: order counted in first matching bucket only).

## 6. Statements P4 (§48–58)
`statement_uploads` (type/provider/period/file SHA-256/row counts/status machine UPLOADED→READY→COMPLETED/FAILED, uploaded_by) + `statement_rows` (refs, dates, amounts, type/status, raw JSON, reconciliation_status MATCHED/.../IGNORED, matched ids). CSV via stdlib; XLSX via openpyxl (new dep). Flow: upload → column-map (per-type required columns + alias table) → dry-run counts → import (SHA dup → STATEMENT_ALREADY_IMPORTED; in-file dup rows → DUPLICATE) → match engine priority AWB→order-id→order-name→(date,amount) controlled → manual-match UI for UNMATCHED (user+reason+audit) → settlement records upserted into `shipment_financials` (expected/collected/settled/fee/deductions/net per §45 statuses). Types: COURIER_SETTLEMENT/BANK_STATEMENT/PAYMENT_GATEWAY_STATEMENT/COURIER_SHIPMENT_REPORT (+ SHOPIFY_ORDER_EXPORT reuses CSV-import path, not this module).

## 7. Monthly report + P&L P5 (§64–73)
`GET /reports/monthly?month=` (order/courier/return/money/exception/cost/profitability sections + generated-at metadata), `product_cost_history` + cost config (COGS/shipping/gateway/packaging/return/RTO/other with sources ACTUAL/MANUAL/DEFAULT/ESTIMATED), P&L builder labeled ESTIMATED unless inputs complete, monthly workbook export (Summary/Orders/Shipments/Money/Exceptions/Profitability sheets via openpyxl).
R009–R022 rules for shipments/SLA/settlement added to engine + exceptions filters (Courier/Money/SLA).

## 8. UI routes
`/shipments` (+ `/shipments/outstanding`, `/shipments/:id` with events + money + SLA + cases), `/statements` (+ `/:id` results + manual match), `/reports/monthly`, `/settings/carriers`, `/settings/sla`, `/settings/costs`. Order detail gains courier/AWB/tracking/money blocks.

## 9. Testing
Unit (normalize incl UNKNOWN, SLA boundaries, match priority incl amount-never-alone, P&L math), integration (AWB→shipment→event→sla, upload→map→match→settle, duplicate upload/file+row), e2e delivery + RTO scenarios (§101–102 adapted, manual provider), 30-case seed matrix extension. All green required.

## 10. Out of scope (needs user keys/ops)
Live carrier adapters + credentials, Redis workers (BackgroundTasks suffice), native apps, thermal printers, GST filing, notifications.
