# Sprint 1 Foundation Design — 2026-09-27

Source plan: `ecommerce_order_reconciliation_mvp_implementation_plan.md` (§68, §105 Day 1-5).
Scope approved: Sprint 1 foundation (Approach A).

## 1. Goal
Deliver milestone: `Shopify -> FastAPI -> PostgreSQL -> Next.js orders visible`.
Greenfield in `A:\Shopify Connection\`. Toolchain verified: Python 3.14, Node 24, Docker 29+Compose v5, Postgres 18 running.

## 2. Architecture (plan §5)
```
Next.js (TS+Tailwind) -> /api/v1/* -> FastAPI services -> PostgreSQL (source of truth)
Shopify GraphQL/REST + webhooks (stub in Sprint 1, full in Sprint 4)
No Redis in Sprint 1 (FastAPI background jobs per §6)
```
Monorepo:
```
./backend/app/{main,config,database,models,schemas,api,services} + migrations + tests
./frontend/app/{login,dashboard,orders} + components + lib + types
./docker-compose.yml (postgres parity, backend service)
./.env.example (never commit .env per §81)
```

## 3. Data (plan §7-8, §86 partial)
Sprint 1 tables only:
`businesses, users, shopify_stores, customers, products, orders, order_items, payments, shopify_webhook_events`
- All business-owned rows carry `business_id` (SaaS-ready).
- UUID PKs, FKs, unique `(business_id, shopify_order_id)`, `(business_id, shopify_transaction_id)`, `(business_id, webhook_id)`.
- Separate dimensions: `financial_status / fulfillment_status / operational_status` (§9). No single status column.
- Indexes: `orders(shopify_order_id, order_date, operational_status)`, `parcels deferred to Sprint 2`.

## 4. Services & API (plan §42-43)
Base `/api/v1`, envelope `{success, data}` / `{success:false, error:{code,message}}`.
- `POST /auth/login, POST /auth/logout, GET /auth/me`
- `GET /shopify/status, POST /shopify/sync?days=30, GET /shopify/callback (scaffold), DELETE /shopify/disconnect`
- `GET /orders?search=&status=&payment_status=&date_from=&date_to=&page=&page_size=, GET /orders/{id}`
- Rules: route handlers thin, logic in `services/shopify_service.py`, `order_service.py` (§87).

## 5. Auth (plan §48-49)
Email+password, bcrypt, HTTP-only cookie JWT. Roles ADMIN/WAREHOUSE/ACCOUNTANT/VIEWER, enforced server-side.

## 6. Shopify sync (plan §10-11, §14)
1. Store token encrypted with Fernet (`access_token_encrypted`), never to frontend (§8.3, §62).
2. Initial sync last-30-days: upsert customers/products/orders/items/payments, update `last_sync_at`.
3. UPSERT idempotency, exponential-backoff retry for transient errors (§52). Webhook persistence table created now, processing in Sprint 4.

## 7. Frontend (minimal Sprint 1)
`/login, /dashboard (counts via DB queries §28), /orders, /orders/:id (customer/financial/Shopify sections)`. shadcn/ui, TanStack Query, Zod+React Hook Form.

## 8. Testing & quality (plan §64-65 partial)
pytest: auth login, order upsert idempotency, amount totals. Ruff+Black+mypy, ESLint+Prettier. CI scaffold (lint+test+block deploy §83).

## 9. Env required (user provides)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/recon_mvp
JWT_SECRET=
ENCRYPTION_KEY=
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-01
NEXT_PUBLIC_API_URL=http://localhost:8000
```
If missing Shopify creds, backend seeds from `backend/tests/fixtures/shopify_orders.json` (15 orders covering normal/cancelled/refund per plan §66 subset) so orders API still demonstrable. JWT_SECRET and ENCRYPTION_KEY (Fernet 32-byte base64) are auto-generated into `.env` on first scaffold if not provided.

## 10. Out of scope (deferred)
Parcels/barcodes (§15-16), scanners (§17-19), reconciliation R001-R008 (§24), Excel/Tally (§30-40), dashboard KPIs full, Redis/Celery, mobile PWA camera.

## 11. Acceptance (Sprint 1)
- `docker compose up` or local run: frontend+backend+DB healthy.
- Admin login, create warehouse/accountant users.
- Real or mock Shopify sync populates orders visible in Next.js.
- Duplicate sync produces no duplicates.
