# Recon MVP — Supabase + FastAPI + Next.js

Monorepo delivering **Shopify → FastAPI → Supabase (PostgreSQL) → Next.js**, with email+password auth (JWT), idempotent Shopify sync, barcode dispatch, returns, reconciliation engine, executive dashboard, and Tally export.

- `backend/` — FastAPI + SQLAlchemy 2.0 + Alembic (thin routes in `app/api/`, business logic in `app/services/`).
- `frontend/` — Next.js 14 (App Router) login / dashboard / scan / exceptions / tally.

## Prerequisites

- Python 3.14, Node 24.
- A Supabase Project (Database URL + API keys).

## Environment Setup (Supabase)

Copy the example file and fill in your Supabase connection credentials in `.env`:

```powershell
Copy-Item .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase PostgreSQL Connection String (e.g. `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres` or Pooler on 6543) |
| `SUPABASE_URL` | Yes | Supabase Project URL (`https://[PROJECT-REF].supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Frontend Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Frontend Supabase Anon Key |
| `JWT_SECRET` | Yes | Secret for signing auth JWTs (32+ chars) |
| `ENCRYPTION_KEY` | Yes (prod) | Fernet 32-byte base64 key for access tokens |
| `SHOPIFY_SHOP_DOMAIN` | For live sync | e.g. `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | For live sync | Shopify Admin API access token |
| `SHOPIFY_API_VERSION` | No | Defaults to `2026-01` |
| `SHOPIFY_CLIENT_SECRET` | For webhooks | Shopify Client Secret for HMAC signature verification |
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL, e.g. `http://localhost:8000` |

If Shopify creds are missing, the backend seeds from `backend/tests/fixtures/shopify_orders.json` so the orders API stays demonstrable.

## Run (local)

```powershell
# 1. Migrate Supabase Database (from inside backend/)
Set-Location backend; alembic upgrade head; Set-Location ..

# 2. Backend Server
Set-Location backend; uvicorn app.main:app --reload; Set-Location ..

# 3. Frontend Server (separate shell)
Set-Location frontend; npm install; npm run dev; Set-Location ..
```

Backend: http://localhost:8000 (`/health`, `/docs`).
Frontend: http://localhost:3000 (`/login`, `/dashboard`, `/orders`, `/scan/dispatch`, `/scan/return`, `/exceptions`, `/settings/tally`).

## Tests

Backend tests **must run with working directory `backend/`**:

```powershell
Set-Location backend; python -m pytest tests -v; Set-Location ..
```

Frontend tests (from `frontend/`): `npm test`. Build check: `npm run build`.

## API contract

All endpoints use the envelope `{success: true, data}` / `{success: false, error: {code, message}}`:

- `POST /api/v1/auth/login {email, password} → {token, user}`
- `GET /api/v1/auth/me` (Bearer token)
- `POST /api/v1/shopify/sync?days=30`
- `GET /api/v1/orders`, `GET /api/v1/orders/{id}`
- `POST /api/v1/scan/dispatch`, `POST /api/v1/scan/return`
- `POST /api/v1/shopify/webhooks`
- `GET /api/v1/reconciliation/issues`, `POST /api/v1/reconciliation/issues/{id}/resolve`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/export/excel`
- `GET/PUT /api/v1/tally/mapping`, `POST /api/v1/tally/export`, `GET /api/v1/tally/batches`

## Sprints Completed
- **Sprint 1 — Foundation**: Auth, Orders, Shopify Sync.
- **Sprint 2 — Dispatch**: Barcode generator, lookup, label printer, dispatch transaction.
- **Sprint 3 — Returns**: Customer Returns, RTO, partial quantities, vertical order timeline, audit logs.
- **Sprint 4 — Webhooks & Reconciliation**: HMAC-verified Shopify webhooks, 8-rule auto-reconciliation engine (R001–R008), Exceptions queue.
- **Sprint 5 — Dashboard, Reports, Excel & Tally**: Executive Dashboard, Excel export generator, Tally ERP/Prime ledger mappings, validation, idempotent Tally export batching.

## CSV import (no-connection onboarding)
- Export: Shopify admin → Orders → Export → CSV.
- Upload: `/import` page or `POST /api/v1/imports/shopify-csv` (multipart `file`, ADMIN/ACCOUNTANT, `?dry_run=true` for validation-only).
- Identity: real Shopify `Id` reused (`gid://shopify/Order/<Id>`), so later webhooks/sync upsert instead of duplicating. Caps: 5MB / 5,000 rows. Refunded Amount > 0 creates a refund row.
