# Recon MVP â€” Supabase + FastAPI + React (Vite)

Monorepo delivering **Shopify â†’ FastAPI â†’ Supabase (PostgreSQL) â†’ React**, with email+password auth (JWT), idempotent Shopify sync, barcode dispatch, returns, reconciliation engine, executive dashboard, and Tally export.

- `backend/` â€” FastAPI + SQLAlchemy 2.0 + Alembic (thin routes in `app/api/`, business logic in `app/services/`).
- `web/` â€” Vite + React 18 + react-router login / dashboard / scan / exceptions / tally.
- `docs/superpowers/` â€” design specs and implementation plans.

## Project structure

```
â”œâ”€â”€ backend/                  # FastAPI service (port 8000)
â”‚   â”œâ”€â”€ app/
â”‚   â”‚   â”œâ”€â”€ api/              # Route modules: auth, orders, parcels, scanning,
â”‚   â”‚   â”‚                     # returns, shipments (+carriers/sla/shipsagar),
â”‚   â”‚   â”‚                     # statements, reports, ledger, accounting,
â”‚   â”‚   â”‚                     # reconciliation, dashboard, export, imports,
â”‚   â”‚   â”‚                     # shopify, webhooks, tally, audit
â”‚   â”‚   â”œâ”€â”€ services/         # Business logic per domain (order, scanning,
â”‚   â”‚   â”‚                     # reconciliation, tally, report, money, â€¦)
â”‚   â”‚   â”œâ”€â”€ carriers/         # Courier provider integrations
â”‚   â”‚   â”œâ”€â”€ models/ + schemas/# SQLAlchemy models + Pydantic schemas
â”‚   â”‚   â”œâ”€â”€ config.py / database.py / main.py
â”‚   â”œâ”€â”€ alembic/              # DB migrations
â”‚   â””â”€â”€ tests/                # Backend test suite (pytest)
â”œâ”€â”€ web/                      # Vite + React 18 SPA (dev port 5173)
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ pages/            # 29 routes: Landing, Login, Dashboard, Orders,
â”‚   â”‚   â”‚                     # OrderDetail, Parcels (+Labels/TestSheet/Detail),
â”‚   â”‚   â”‚                     # ScanHub, Dispatch, ReturnScan, RtoScan,
â”‚   â”‚   â”‚                     # Shipments (+Outstanding/Tracking/Detail),
â”‚   â”‚   â”‚                     # Statements (+Detail), MonthlyReport,
â”‚   â”‚   â”‚                     # FinanceClose/Ledger, Tracking, Exceptions,
â”‚   â”‚   â”‚                     # Tally/Costs/Carriers/Sla settings, NotFound
â”‚   â”‚   â”œâ”€â”€ components/       # TopNav, Footer, MetricCard, OrderTable,
â”‚   â”‚   â”‚                     # Timeline, ScanBanner, SeverityBadge,
â”‚   â”‚   â”‚                     # EmptyState, Reveal, Loading, icons
â”‚   â”‚   â”‚                     # scanner/ (camera + manual input),
â”‚   â”‚   â”‚                     # barcode/ (labels + preview)
â”‚   â”‚   â”œâ”€â”€ lib/              # api client, nav, barcode, scan utils, sla
â”‚   â”‚   â”œâ”€â”€ styles/           # Design tokens + responsive CSS
â”‚   â”‚   â”œâ”€â”€ App.tsx           # Route table + app shell
â”‚   â”‚   â””â”€â”€ main.tsx          # Entry point
â”‚   â”œâ”€â”€ tests/                # 26 vitest suites
â”‚   â””â”€â”€ dist/                 # Production build output (`npm run build`)
â”œâ”€â”€ docs/superpowers/         # specs/ (design) + plans/ (implementation)
â”œâ”€â”€ .env / .env.example       # Backend + shared secrets (never commit .env)
â””â”€â”€ web/.env                  # Web keys VITE_API_URL, VITE_SUPABASE_* (gitignored)
```

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
| `VITE_SUPABASE_URL` | Yes | Web Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Web Supabase Anon Key |
| `JWT_SECRET` | Yes | Secret for signing auth JWTs (32+ chars) |
| `ENCRYPTION_KEY` | Yes (prod) | Fernet 32-byte base64 key for access tokens |
| `SHOPIFY_SHOP_DOMAIN` | For live sync | e.g. `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | For live sync | Shopify Admin API access token |
| `SHOPIFY_API_VERSION` | No | Defaults to `2026-01` |
| `SHOPIFY_CLIENT_SECRET` | For webhooks | Shopify Client Secret for HMAC signature verification |
| `VITE_API_URL` | Yes | Backend base URL, e.g. `http://localhost:8000` |

If Shopify creds are missing, the backend seeds from `backend/tests/fixtures/shopify_orders.json` so the orders API stays demonstrable.

## Run (local)

```powershell
# 1. Migrate Supabase Database (from inside backend/)
Set-Location backend; alembic upgrade head; Set-Location ..

# 2. Backend Server
Set-Location backend; uvicorn app.main:app --reload; Set-Location ..

# 3. Web Server (separate shell)
Set-Location web; npm install; npm run dev; Set-Location ..
```

Backend: http://localhost:8000 (`/health`, `/docs`).
Web: http://localhost:5173 (`/login`, `/dashboard`, `/orders`, `/scan/dispatch`, `/scan/return`, `/exceptions`, `/settings/tally`).

## Tests

Backend tests **must run with working directory `backend/`**:

```powershell
Set-Location backend; python -m pytest tests -v; Set-Location ..
```

Web tests (from `web/`): `npm test`. Build check: `npm run build` (outputs static `dist/`).

## API contract

All endpoints use the envelope `{success: true, data}` / `{success: false, error: {code, message}}`:

- `POST /api/v1/auth/login {email, password} â†’ {token, user}`
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
- **Sprint 1 â€” Foundation**: Auth, Orders, Shopify Sync.
- **Sprint 2 â€” Dispatch**: Barcode generator, lookup, label printer, dispatch transaction.
- **Sprint 3 â€” Returns**: Customer Returns, RTO, partial quantities, vertical order timeline, audit logs.
- **Sprint 4 â€” Webhooks & Reconciliation**: HMAC-verified Shopify webhooks, 8-rule auto-reconciliation engine (R001â€“R008), Exceptions queue.
- **Sprint 5 â€” Dashboard, Reports, Excel & Tally**: Executive Dashboard, Excel export generator, Tally ERP/Prime ledger mappings, validation, idempotent Tally export batching.

## CSV import (no-connection onboarding)
- Export: Shopify admin â†’ Orders â†’ Export â†’ CSV.
- Upload: `/import` page or `POST /api/v1/imports/shopify-csv` (multipart `file`, ADMIN/ACCOUNTANT, `?dry_run=true` for validation-only).
- Identity: real Shopify `Id` reused (`gid://shopify/Order/<Id>`), so later webhooks/sync upsert instead of duplicating. Caps: 5MB / 5,000 rows. Refunded Amount > 0 creates a refund row.

## P0 ops checklist (production)
- APP_ENV defaults to `production` (dev opt-in: `APP_ENV=dev` seeds demo users and enables wildcard CORS; never set `dev` in prod).
- JWT secret: use a strong random value (>=48 chars), e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`, via `JWT_SECRET`.
- ENCRYPTION_KEY: generate a Fernet key via `python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`. Token encryption at rest is Fernet-stubbed; rotate by re-encrypting stored credentials with the new key.
- Supabase backups: enable PITR and periodically test a restore.
- No secrets in git: verified via `git grep -E \"supabase|shopy_|sk-|Bearer \" -- .env.example` and never commit `.env`.


## Real-world phase ï¿½ shipments, SLA, statements, P&L
- Shipments: dispatch with carrier_code + wb_number creates a BOOKED shipment; GET /api/v1/shipments, detail, manual checkpoints, AWB correction (ADMIN + reason, audited).
- Tracking: POST /shipments/{id}/sync (live provider or terminal-stop); carrier webhooks POST /api/v1/webhooks/{carrier} (X-Business-Id). MANUAL provider works now; DTDC/Tirupati/India Post raise CARRIER_NOT_CONNECTED until real creds land.
- SLA: GET/POST /sla/rules (ADMIN), outstanding board GET /shipments/outstanding, cases, money-at-risk GET /money/at-risk.
- Statements: upload CSV/XLSX POST /statements/upload, dry-run, process (AWB > order > controlled match; never amount-alone), manual match with audit, settlement records.
- Reports: GET /reports/monthly?month=YYYY-MM + Excel export; costs GET/PUT /reports/costs (versioned, past months frozen); P&L labeled ESTIMATED unless all-actual.
- Reconciliation R009ï¿½R022 + ?category=courier|money|returns|sla filter; UI at /shipments, /statements, /reports/monthly, /settings/{carriers,sla,costs}.
- Alembic  006_shipments,  007_sla,  008_statements,  009_costs (live DB at head).

