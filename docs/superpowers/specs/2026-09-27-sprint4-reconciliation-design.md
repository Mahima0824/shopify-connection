# Sprint 4 Spec — Webhooks, Reconciliation Engine, Exceptions — 2026-09-27

Source plan: `ecommerce_order_reconciliation_mvp_implementation_plan.md` (§8.11, §8.13, §12–14, §21–25, §52, §74–75, §89, §108).
Builds on: Sprints 1–3 (auth/orders/sync/parcels/dispatch/returns/timeline/audit). Backend 27/27 green.

## 1. Goal
`Shopify change + physical events -> automatic mismatch detection`, surfaced as an actionable exception queue: the owner reviews ~15 rows, not 500 (§98).

## 2. Webhooks (§12–14, §52, §74)
`POST /api/v1/shopify/webhooks` (NO auth — Shopify signs with HMAC-SHA256 over raw body using client secret; verify `X-Shopify-Hmac-Sha256`, compare with `hmac.compare_digest`; 401 on mismatch).
Flow: read raw body → verify → parse topic (`X-Shopify-Topic`), shop domain (`X-Shopify-Shop-Domain`), webhook id (`X-Shopify-Webhook-Id`) → upsert `shopify_webhook_events` by `webhook_id` (duplicates return 200 without requeue) → BackgroundTasks.process → immediate 200.
Topics handled: `orders/create|updated|cancelled`, `refunds/create`, `fulfillments/create|update`. Unknown topics: stored + marked processed (no-op).
Responses are plain `200`/`401` (Shopify protocol, not the app envelope — Shopify ignores bodies).
Processing: resolve business by shop_domain → upsert order state (financial/fulfillment/cancelled_at), upsert payments (by transaction id), upsert refunds (by refund id), update last_sync_at → `reconcile_order`. Transient exceptions → `processing_status=FAILED`, `error_message` set, retry with backoff up to 3 attempts (next webhook/sync re-picks FAILED rows); permanent validation errors marked `SKIPPED`, never retried forever.
Migration 0004 alters `shopify_webhook_events`: add `processing_status (RECEIVED/PROCESSING/DONE/FAILED/SKIPPED)`, `error_message NULL`, `received_at`, `processed_at NULL`, `attempts INT default 0`. Existing `webhook_id unique` + `processed bool` stay (processed mirrors DONE).
New `refunds` table (§8.11): `id, business_id, order_id, shopify_refund_id UNIQUE per business, amount, currency, status, created_at, updated_at`.
New env: `SHOPIFY_CLIENT_SECRET` (HMAC verify; never logged, never exposed). Add to `.env.example`.

## 3. Reconciliation engine (§23–24, §89)
`reconcile_order(db, order_id) -> {status: RECONCILED|EXCEPTION, issues[]}`. One rule function each (`check_r001...check_r008`), all scoped by business, reading order + payments + refunds + returns + scan_events:
- R001 cancelled + DISPATCHED event → CRITICAL `CANCELLED_BUT_DISPATCHED` (§21–22: cancelled-after-pack vs after-dispatch severity: pack-only → HIGH `CANCELLED_AFTER_PACK`, dispatched → CRITICAL).
- R002 return RECEIVED + `refund_expected` + no refund → HIGH `RETURN_WITHOUT_REFUND`. `refund_expected`: order-level flag — prepaid/paid orders default true; COD-unpaid default false (review-required). Stored on returns row? No schema change: derive from `Order.financial_status == PAID`.
- R003 refund exists + no return → MEDIUM `REFUND_WITHOUT_RETURN` (legitimate possible → REVIEW semantics via severity).
- R004 financial PAID + zero payment rows → HIGH `PAYMENT_DATA_MISSING`.
- R005 >1 DISPATCHED events → HIGH `DUPLICATE_DISPATCH_SCAN`.
- R006 return/RTO event + zero DISPATCHED events → HIGH `RETURN_WITHOUT_DISPATCH`.
- R007 SUM(return_items.qty) > SUM(order_items.quantity) → HIGH `RETURN_QUANTITY_MISMATCH`.
- R008 Shopify `shopify_updated_at` > local max processed event AND older than 15-min grace → MEDIUM `SYNC_DELAY`.
Clean → delete resolved-open rows? No: mark existing open rows resolved=False→ keep history; upsert by (order_id, issue_code): open row persists, new runs update `updated_at`; fixed issues auto-resolve (resolved=True, resolved_by NULL, note `auto-resolved` in message? No — set resolved_at, resolved_by NULL meaning system).
`reconciliations` table (§8.13): `id, business_id, order_id, reconciliation_status, severity, issue_code, issue_message, resolved, resolved_by NULL, resolved_at NULL, created_at, updated_at`. Unique `(order_id, issue_code)` partial? Use UniqueConstraint(order_id, issue_code) with resolve-reopen semantics (resolved rows updated, not duplicated).
Auto-triggers: after dispatch scan, after return scan, after sync upsert, after webhook processing.

## 4. Exceptions API + UI (§25)
`GET /api/v1/reconciliation/issues?status=OPEN|RESOLVED|ALL&severity=&issue_code=&date_from=&date_to=&page=` authed (all roles read) envelope `{items,total,page}` with order names joined.
`POST /api/v1/reconciliation/order/{id}` (re-run, authed) → returns status+issues.
`POST /api/v1/reconciliation/run` (ADMIN/ACCOUNTANT, optional `business_id`) → reconciles all open orders, returns counts.
`POST /api/v1/reconciliation/issues/{id}/resolve {reason}` ADMIN/ACCOUNTANT only, reason mandatory non-empty → resolved=True/by/at + audit `EXCEPTION_RESOLVED`. Resolve already-resolved → 400 `ALREADY_RESOLVED`.
UI: `/exceptions` table (Order, Issue, Severity, Detected At, Status, View) + filters (OPEN/RESOLVED, severity, type) + resolve modal with reason + link to order. Order detail: reconciliation block (RECONCILED ✅ / issues ⚠❌) above timeline.
Severity display: CRITICAL/HIGH/MEDIUM/LOW text + icon, never color-only (§97).

## 5. Testing (§65–66 seed matrix)
`tests/test_reconciliation.py`: one fixture order per rule (R001 pack-only HIGH + dispatched CRITICAL, R002, R003, R004, R005, R006, R007, R008 stale, clean) asserting codes+severities+auto-resolve on fix; `tests/test_webhooks.py`: HMAC accept/reject, duplicate delivery single-processing, cancelled webhook stamps cancelled_at + raises R001 on dispatched order, refund webhook clears R002.
Seed matrix doubles as regression suite (§66 subset).

## 6. Out of scope (Sprint 5)
Excel/Tally, dashboard KPIs, notifications, auto-remediation actions, multi-store.

## 7. Acceptance (§67 reconciliation + webhooks rows)
Connect→import→cancel/refund/fulfillment webhooks update state; dispatch→cancel webhook→CRITICAL exception visible; return→refund webhook→R002 clears; duplicate delivery harmless; resolve requires reason + audit; suite green (27 + new).
