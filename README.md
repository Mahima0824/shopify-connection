# Recon MVP - Supabase + FastAPI + React (Vite)

Monorepo delivering **Shopify -> FastAPI -> Supabase (PostgreSQL) -> React**, with email+password auth (JWT), idempotent Shopify sync, barcode dispatch, returns, reconciliation engine, executive dashboard, and Tally export.

- `backend/` - FastAPI + SQLAlchemy 2.0 + Alembic (thin routes in `app/api/`, business logic in `app/services/`).
- `frontend/` - Vite + React 18 + react-router login / dashboard / scan / exceptions / tally.
- `docs/superpowers/` - design specs and implementation plans.

## Project structure

```
|-- backend/                  # FastAPI service (port 8000)
|   |-- app/
|   |   |-- api/              # 22 routers: accounting, audit, auth, carriers,
|   |   |                     # shipments, shipsagar, sla, statements, reports,
|   |   |                     # ledger, reconciliation, dashboard, export, imports,
|   |   |                     # orders, parcels, scanning, returns, shopify,
|   |   |                     # webhooks, tally
|   |   |-- services/         # Business logic per domain (ledger, bank-recon,
|   |   |                     # tally, shipsagar, accounting, report, money, ...)
|   |   |-- carriers/         # Courier provider integrations
|   |   |-- models/ + schemas/# SQLAlchemy models + Pydantic schemas
|   |   |-- config.py / database.py / main.py
|   |-- alembic/              # DB migrations 0001-0018 (head: gst_report_fields)
|   |-- tests/                # Backend suite: 43 pytest files
|-- frontend/                 # Vite + React 18 SPA (dev port 5173)
|   |-- src/
|   |   |-- pages/            # 29 routes: Landing, Login, Dashboard, Orders,
|   |   |                     # OrderDetail, Parcels (+Labels/TestSheet/Detail),
|   |   |                     # ScanHub, Dispatch, ReturnScan, RtoScan,
|   |   |                     # Shipments (+Outstanding/Tracking/Detail),
|   |   |                     # StatementList (+Detail), MonthlyReport,
|   |   |                     # FinanceClose/Ledger, Tracking, Exceptions,
|   |   |                     # Tally/Costs/Carriers/Sla settings, NotFound
|   |   |-- components/       # TopNav, Footer, MetricCard, OrderTable,
|   |   |                     # Timeline, ScanBanner, SeverityBadge,
|   |   |                     # EmptyState, Reveal, Loading, icons,
|   |   |                     # scanner/ (camera + manual input),
|   |   |                     # barcode/ (labels + preview)
|   |   |-- lib/              # api client, nav, barcode, scan utils, sla
|   |   |-- styles/           # Design tokens + responsive CSS
|   |   |-- App.tsx           # Route table + app shell
|   |   |-- main.tsx          # Entry point
|   |-- tests/                # 26 vitest suites
|   |-- dist/                 # Production build output (`npm run build`)
|-- docs/superpowers/         # specs/ (design) + plans/ (implementation)
|-- .env / .env.example       # Backend + shared secrets (never commit .env)
|-- frontend/.env             # Web keys VITE_API_URL, VITE_SUPABASE_* (gitignored)
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
| `DATABASE_URL` | Yes | Supabase PostgreSQL Connection String (Direct on 5432 or Pooler on 6543) |
| `SUPABASE_URL` | Yes | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `VITE_SUPABASE_URL` | Yes | Web Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Web Supabase Anon Key |
| `VITE_API_URL` | Yes | Backend base URL, e.g. `http://localhost:8000` |
| `JWT_SECRET` | Yes | Secret for signing auth JWTs (32+ chars) |
| `ENCRYPTION_KEY` | Yes (prod) | Fernet 32-byte base64 key for access tokens |
| `SHOPIFY_SHOP_DOMAIN` | For live sync | e.g. `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | For live sync | Shopify Admin API access token |
| `SHOPIFY_API_VERSION` | No | Defaults to `2026-01` |
| `SHOPIFY_CLIENT_SECRET` | For webhooks | Shopify HMAC secret |
| `INDIA_POST_*` / `DTDC_*` | For live tracking | Courier API creds (see .env.example) |
| `SHIPSAGAR_TOKEN` / `SHIPSAGAR_CLIENT_CODE` | For live ShipSagar | "api key" and "client code" from the ShipSagar client profile page |

If Shopify creds are missing, the backend seeds from `backend/tests/fixtures/shopify_orders.json` so the orders API stays demonstrable.

## Run (local)

```powershell
# 1. Migrate the database (from inside backend/)
Set-Location backend; python -m alembic upgrade head; Set-Location ..

# 2. Backend server (python -m avoids blocked exe launchers)
Set-Location backend; python -m uvicorn app.main:app --reload; Set-Location ..

# 3. Web server (separate shell)
Set-Location web; npm install; npm run dev; Set-Location ..
```

Backend: http://localhost:8000 (`/health`, `/docs`).
Web: http://localhost:5173 (`/login`, `/dashboard`, `/finance/ledger`, `/finance/close`, `/statements`, `/settings/tally`).

## Tests

Backend tests **must run with working directory `backend/`**:

```powershell
Set-Location backend; python -m pytest tests -v; Set-Location ..
```

Web tests (from `frontend/`): `npm test`. Typecheck+build: `npm run build` (outputs static `dist/`).

## API contract

All endpoints use the envelope `{success: true, data}` / `{success: false, error: {code, message}}`:

- `POST /api/v1/auth/login` with email+password returns token+user
- `GET /api/v1/auth/me` (Bearer token)
- `POST /api/v1/shopify/sync?days=30`
- `GET /api/v1/orders`, `GET /api/v1/orders/{id}`
- `POST /api/v1/scan/dispatch`, `POST /api/v1/scan/return`
- `POST /api/v1/shopify/webhooks`
- `GET /api/v1/reconciliation/issues` + resolve, plus `bank-summary` and `bank-mismatches`
- `GET /api/v1/ledger`, `GET /api/v1/ledger/summary`, `POST /api/v1/ledger/backfill`
- `GET /api/v1/reports/monthly`, `gst/validate`, `presets`, plus CSV/XLSX exports
- `POST /api/v1/tally/validate`, `POST /api/v1/tally/export`, `GET /api/v1/tally/exports`
- `GET /api/v1/accounting/periods`, close/reopen per month
- `POST /api/v1/shipments` + `/api/v1/shipsagar/*` (register, webhook, retry-drain, health)
- `GET /api/v1/shipments/outstanding`, `GET /api/v1/dashboard/summary`
- `GET /api/v1/export/excel`

## What is built
- **Foundation**: Auth (JWT), Orders, Shopify sync (idempotent) + CSV import endpoint.
- **Dispatch**: Barcode generator, lookup, label printer, dispatch transaction.
- **Returns**: Customer returns, RTO, partial quantities, order timeline, audit logs.
- **Webhooks and reconciliation**: HMAC-verified webhooks, auto-reconciliation engine, Exceptions queue.
- **Dashboard, reports, Excel and Tally**: Executive dashboard, Excel export, Tally mappings + validation + idempotent batching.
- **Shipments, SLA, statements, PnL**: Shipments + outstanding/money-at-risk, statement upload + dry-run, monthly reports + versioned costs, ESTIMATED P&L.
- **Financial ledger**: Immutable financial_transactions (11 types), double-entry transform, revenue/profit/COGS engine.
- **Bank reconciliation**: L1-L4 matching (never amount-alone), mismatch board, idempotent import.
- **Tally hardening**: 14-check validation gate, 7-sheet workbook (numeric cells), duplicate prevention, batch lifecycle.
- **ShipSagar**: `PushShipment` + `TrackShipment` clients, provider adapter, idempotent webhook (tenant-scoped, stale-guard), retry queue + drain, health.
- **Accounting controls**: Month close (fail-closed, 5 gates), FY config (Apr-Mar default), closed-period guard, RBAC gate.
- **Finance UI**: Ledger explorer, mismatch board, Tally validate/export, month close, GST/profit cards, ShipSagar bits.

## Ops notes (production)
- APP_ENV defaults to `production` (dev opt-in seeds demo users + wildcard CORS; never set `dev` in prod).
- JWT secret: 48+ random chars; ENCRYPTION_KEY: Fernet key. Generate with Python secrets/Fernet helpers.
- Supabase backups: enable PITR and periodically test a restore.
- Never commit `.env`; run `python -m alembic upgrade head` against real Postgres before deploy (SQLite cannot run the full chain).
- GST and voucher treatment needs CA review before statutory filing; unknown-jurisdiction IGST is flagged IGST_UNVERIFIED.

## ShipSagar

ShipSagar aggregates courier tracking. Three endpoints are integrated: `PushShipment`
(register a shipment), `TrackShipment` (poll history) and `GetCourier` (the
account's courier catalogue, which backs the **Add Shipment** dropdown). Credentials
come from the ShipSagar client profile page and are sent in the request body:

- `SHIPSAGAR_API_BASE_URL` - defaults to `https://app.shipsagar.com/api/Web`
- `SHIPSAGAR_TOKEN` - the "api key" from the client profile page
- `SHIPSAGAR_CLIENT_CODE` - the "client code" from the client profile page
- `SHIPSAGAR_WEBHOOK_SECRET` - HMAC secret for the inbound webhook

With no credentials set, pushes fall back to a deterministic
`SS-STUB-<COURIER>-<AWB>` identifier and tracking stays offline, so local
development works without a ShipSagar account.

### ShipSagar environment

| Variable | Purpose |
| --- | --- |
| `SHIPSAGAR_TOKEN` | "api key" from the ShipSagar client profile page |
| `SHIPSAGAR_CLIENT_CODE` | "client code" from the client profile page |
| `SHIPSAGAR_EMAIL` | constant `EmailID` sent on every shipment |
| `SHIPSAGAR_COMPANY` | constant `CompanyName` sent on every shipment |
| `SHIPSAGAR_API_BASE_URL` | defaults to `https://app.shipsagar.com/api/Web` |
| `SHIPSAGAR_WEBHOOK_SECRET` | HMAC secret for the inbound webhook |

Only `SHIPSAGAR_TOKEN` and `SHIPSAGAR_CLIENT_CODE` are required to talk to
ShipSagar. `SHIPSAGAR_EMAIL` and `SHIPSAGAR_COMPANY` are optional account
constants: when either is unset or blank that one field falls back to the
order's own `receiver_email` / `receiver_company`, so a half-configured deploy
still sends a usable value. Set them if you want a single address and company on
every shipment.

The backend reads **two** env files, and the split is intentional:

| File | Holds |
| --- | --- |
| `backend/.env` | `SHIPSAGAR_TOKEN`, `SHIPSAGAR_CLIENT_CODE` — deployment secrets |
| `.env` (repo root) | `SHIPSAGAR_EMAIL`, `SHIPSAGAR_COMPANY` — shared account constants |

Both are resolved to absolute paths at import, so the start directory does not
matter: launching with `uvicorn` from the repo root and from `backend/` both
work. Where a variable appears in both files, `backend/.env` wins.

Set all of them in a **backend** env file — never in `frontend/.env`. Anything
prefixed `VITE_` is compiled into the browser bundle and visible to every
visitor.

Orders are the only entry point for shipments. A synced Shopify order starts in
`AWAITING_TRACKING`; open the Orders page and use **Add Shipment** to enter the
tracking number the India Post worker issued. Manual orders ask for the tracking
number immediately after they are created. Clicking a tracking number opens the
full scan history from ShipSagar's `TrackShipment`.
