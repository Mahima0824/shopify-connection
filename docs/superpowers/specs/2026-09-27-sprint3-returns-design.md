# Sprint 3 Spec — Returns/RTO, Timeline, Audit Logs — 2026-09-27

Source plan: `ecommerce_order_reconciliation_mvp_implementation_plan.md` (§8.12, §8.15, §19–20, §27, §50–51, §73).
Builds on: Sprint 1 (auth/orders/sync) + Sprint 2 (parcels, dispatch transactions, scanner UI). Backend 20/20 green.

## 1. Goal
`Return arrives -> scan barcode -> inspect -> return recorded against original order`, partial quantities supported, full order timeline visible, business-critical mutations audited.

## 2. Data (new tables, migration 0003)
`returns`: `id UUID PK, business_id FK, order_id FK, parcel_id FK, return_type (CUSTOMER_RETURN/RTO/PARTIAL_RETURN), reason NULL, condition NULL, received_at NULL, inspected_at NULL, status (RECEIVED/INSPECTED/CLOSED), created_by FK users, created_at, updated_at`.
`return_items`: `id UUID PK, return_id FK, order_item_id FK, quantity INT CHECK >= 0, condition NULL`. Enforced: per-item `SUM(returned) <= ordered_quantity`; whole-return `SUM > SUM(ordered)` rejected.
`audit_logs`: `id UUID PK, business_id FK, user_id NULL, entity_type, entity_id (String UUID — not FK, entities vary), action, old_data JSONB NULL, new_data JSONB NULL, created_at`. Append-only like scan_events.
Indexes: `returns(order_id)`, `returns(parcel_id)`, `return_items(return_id)`, `audit_logs(entity_type, entity_id)`, `audit_logs(business_id, created_at)`.
Note: `entity_id` String (not UUID FK) since audited entities span tables.

## 3. Return service
`record_return(db, business_id, barcode, user_id, return_type, condition, reason?, device_id?, items?[{order_item_id, quantity}]?) -> dict`.
Transaction: lock parcel FOR UPDATE → 404 `INVALID_BARCODE` if unknown → require existing DISPATCHED scan event else `RETURN_WITHOUT_DISPATCH` → duplicate check (existing non-closed return for parcel) → `RETURN_ALREADY_RECORDED` → validate items (unknown item → `INVALID_RETURN_ITEM`; qty over ordered → `RETURN_QUANTITY_MISMATCH`) → create return (status RECEIVED) + items + scan event (`RETURN_RECEIVED` or `RTO_RECEIVED` for RTO) + audit row (`RETURN_RECORDED`, old parcel/order statuses → new) → parcel.status=RETURN_RECEIVED → order.operational_status = RTO if RTO else RETURN_RECEIVED → commit.
Default items when omitted: full quantities of all order items (whole-order return).
Error codes: `INVALID_BARCODE, RETURN_WITHOUT_DISPATCH, RETURN_ALREADY_RECORDED, INVALID_RETURN_ITEM, RETURN_QUANTITY_MISMATCH, USER_NOT_AUTHORIZED`.

## 4. Return API
`POST /api/v1/scan/return` authed WAREHOUSE+ADMIN, thin handler over service, `X-Error-Code` header on ScanError (Sprint 2 convention).
`GET /api/v1/returns?order_id=&status=` list (envelope `{items,total,page}`), `GET /api/v1/returns/{id}` detail with items.
`GET /api/v1/orders/{id}/timeline` authed: ordered nodes built from order row + scan_events + payments/refunds (empty in Sprint 3, shape reserved) + audit_logs (override/resolution entries): `[{at, kind, label, detail}]` chronological, kinds `CREATED/PAYMENT/PARCEL/PACKED/DISPATCHED/RETURN/REFUND/AUDIT`.

## 5. Return scanner UI (§19 mock)
`/scan/return`: autofocus scan input → parcel lookup card (order name, customer, product summary, amount, original dispatch at) → return-type toggle [CUSTOMER RETURN|RTO] → condition buttons [GOOD|DAMAGED|USED|WRONG PRODUCT|MISSING ITEM] → reason text (optional) → per-item qty steppers (default full) → [CONFIRM RETURN] → success banner + auto-refocus. Reuses ScanBanner. After confirm, parcel lookup shows RETURN_RECEIVED.
Order detail page (`/orders/[id]`): add timeline section rendering `GET .../timeline` nodes (§27 ASCII-art as vertical list with ●/○ markers).

## 6. Audit wiring (Sprint 3 scope)
Write audit rows for: return recorded, dispatch admin override (extend Sprint 2 override path to write `DISPATCH_OVERRIDE` audit), manual parcel/order corrections if added. No separate audit UI in Sprint 3 (timeline surfaces entries); read API `GET /api/v1/audit?entity_type=&entity_id=` for debugging.

## 7. Testing
`tests/test_returns.py`: full return flips statuses + event + items; partial return (2 of 3 units) keeps parcel RETURN_RECEIVED with item rows; over-qty rejected; return-without-dispatch blocked; duplicate return blocked; RTO sets order RTO + RTO_RECEIVED event; timeline contains dispatch+return nodes in order; audit row written per return.
Concurrency: single-threaded duplicate guard suffices (same-transaction check); no thread test (dispatch Sprint 2 already proved pattern).

## 8. Out of scope (Sprint 4+)
Refund-vs-return reconciliation (R002/R003), Shopify return/refund webhooks, cancel-after-dispatch engine, Excel/Tally, RTO courier nuances, inspection→restock flows.

## 9. Acceptance
- Dispatched parcel scans into a recorded return with correct type/condition/items.
- Partial quantities enforced; over-returns impossible.
- Undispatched/cancelled-unknown/duplicate scans blocked with codes.
- Timeline shows full cradle-to-return history; every return has an audit row.
- Suite stays green (20 existing + new return tests).
