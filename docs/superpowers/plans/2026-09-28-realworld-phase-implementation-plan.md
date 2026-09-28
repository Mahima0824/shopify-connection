# Real-World Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link every dispatched parcel to a courier AWB with tracking history, catch stuck parcels via SLA, match settlement statements to orders, and report monthly P&L — with carrier live APIs left as credential-gated stubs.

**Architecture:** New `shipments`/`shipment_events`/`carrier_connections`/`carrier_sla_rules`/`shipment_cases`/`shipment_financials`/`statement_uploads`/`statement_rows`/`product_cost_history` tables (migrations 0006–0008); `app/carriers/` provider abstraction (manual working, DTDC/Tirupati/India Post stubs); dispatch extended with optional AWB; SLA calculator + money service as single-source functions; statements engine with SHA dedupe + priority matching.

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, openpyxl 3.1 (new pin), pytest 8, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id` UUID; all new queries scoped by JWT `business_id`.
- Append-only: `shipment_events`, `audit_logs`, `scan_events` — never update/delete; AWB corrections append events + audit, never overwrite history.
- API envelope everywhere except Shopify-protocol endpoints; new error codes `SHIPMENT_MISSING`, `AWB_REQUIRED`, `CARRIER_NOT_CONNECTED`, `AWB_NOT_FOUND`, `TRACKING_PROVIDER_ERROR`, `STATEMENT_ALREADY_IMPORTED`, `INVALID_STATEMENT`, `MISSING_REQUIRED_COLUMN`, `DUPLICATE_STATEMENT_ROW`.
- `openpyxl==3.1.5` pinned in requirements (XLSX + workbook export).
- Auth via `get_current_user` → {"user_id","business_id","role"}; scan writes ADMIN/WAREHOUSE; money/config writes ADMIN/ACCOUNTANT; reads all authed roles.
- Money never double-counted: `money_service` owns bucketing; P&L labeled ESTIMATED unless inputs complete.
- Never commit `.env`; no live carrier keys in this phase (stubs raise `CARRIER_NOT_CONNECTED`).
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React`.

---

### Task 1: P0 hardening + tally batches fix

**Files:**
- Modify: `backend/app/api/tally.py:50-53` (batches dicts), `backend/app/main.py` (APP_ENV gate), `backend/app/config.py` (add `app_env`), `README.md` (P0 ops checklist), `.env.example` (`APP_ENV=`)
- Test: `backend/tests/test_p0.py`

**Interfaces:**
- Consumes: `ExportBatch`, `settings`
- Produces: `GET /tally/batches -> list[dict]`; seed/CORS active only when `APP_ENV=dev`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_p0.py
def test_batches_serializable(auth_client):
    r = auth_client.get("/api/v1/tally/batches")
    assert r.status_code == 200
    import json
    json.dumps(r.json())  # must not raise
    assert isinstance(r.json()["data"], list)

def test_prod_defaults_safe():
    from app import config
    assert config.Settings().app_env == "production"
```

Implementer: build `auth_client` on the TestClient+login pattern from `test_e2e_sprint1.py`; `Settings()` default must be production (plan: prod-safe defaults, dev opt-in).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_p0.py -v`
Expected: FAIL (500 on batches and/or app_env missing).

- [ ] **Step 3: Minimal implementation**

```python
# tally.py list_batches body
batches = db.query(ExportBatch).filter_by(business_id=u.get("business_id")).order_by(ExportBatch.created_at.desc()).all()
return {"success": True, "data": [{"id": b.id, "batch_reference": b.batch_reference, "record_count": b.record_count,
                                   "status": b.status, "created_at": b.created_at.isoformat() if b.created_at else None} for b in batches]}
```

```python
# config.py addition
app_env: str = "production"
```

```python
# main.py gate (wrap existing seed call + CORSMiddleware)
if settings.app_env == "dev":
    seed_initial_data()  # inside lifespan
# CORS: allow_origins=["*"] only in dev else explicit frontend origin
```

`.env.example`: `APP_ENV=dev  # local only; production default when unset` — wait, default must be production when UNSET, so example documents dev opt-in. Exact line: `APP_ENV=production`.

README append P0 ops checklist (strong JWT ≥48 chars, ENCRYPTION_KEY Fernet generate command, token encryption at rest already Fernet-stubbed — note rotation, Supabase backups PITR enable + restore test, no secrets in git verified via `git grep`).

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_p0.py -v` → PASS; full suite green.

- [ ] **Step 5: Manual check**

`APP_ENV=dev uvicorn` seeds demo users; without it, no seed rows created.

---

### Task 2: Shipment models + migration 0006

**Files:**
- Create: `backend/app/models/shipment.py` (Shipment, ShipmentEvent, CarrierConnection), `backend/alembic/versions/0006_shipments.py`, `backend/tests/test_shipment_models.py`
- Modify: `backend/app/models/__init__.py` (exports)

**Interfaces:**
- Consumes: `Base`, `uuidpk`
- Produces: models + `normalize_status(raw: str) -> str` location TBD Task 4 (note: normalization lives in carriers/, NOT here)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_shipment_models.py
def test_awb_unique_per_business():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.exc import IntegrityError
    from app.database import Base
    import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.shipment
    import pytest
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    from app.models.business import Business
    from app.models.shipment import Shipment
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    db.add(Shipment(business_id=b.id, order_id="o1", parcel_id="p1", carrier_code="DTDC", awb_number="D1", tracking_status="BOOKED"))
    db.commit()
    db.add(Shipment(business_id=b.id, order_id="o2", parcel_id="p2", carrier_code="DTDC", awb_number="D1", tracking_status="BOOKED"))
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_shipment_models.py -v`
Expected: FAIL "No module named app.models.shipment".

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/models/shipment.py
from sqlalchemy import ForeignKey, String, Text, DateTime, func, UniqueConstraint, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Shipment(Base):
    __tablename__ = "shipments"
    __table_args__ = (
        UniqueConstraint("business_id", "carrier_code", "awb_number", name="uq_ship_biz_carrier_awb"),
        Index("ix_ship_status", "business_id", "tracking_status"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    carrier_code: Mapped[str] = mapped_column(String(32))
    awb_number: Mapped[str] = mapped_column(String(64))
    tracking_status: Mapped[str] = mapped_column(String(32), default="BOOKED")
    carrier_status_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_checkpoint_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_checkpoint_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    tracking_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_delivery_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    shipped_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    rto_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ShipmentEvent(Base):
    __tablename__ = "shipment_events"
    __table_args__ = (
        UniqueConstraint("shipment_id", "carrier_event_id", name="uq_shipev_ship_event"),
        Index("ix_shipev_time", "shipment_id", "event_time"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"))
    carrier_event_id: Mapped[str] = mapped_column(String(128), default="")
    carrier_status_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    normalized_status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_time: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String(16), default="MANUAL")
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CarrierConnection(Base):
    __tablename__ = "carrier_connections"
    __table_args__ = (UniqueConstraint("business_id", "carrier_code", name="uq_carrier_biz_code"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    carrier_code: Mapped[str] = mapped_column(String(32))
    credentials_encrypted: Mapped[str] = mapped_column(Text, default="")
    environment: Mapped[str] = mapped_column(String(16), default="LIVE")
    is_active: Mapped[bool] = mapped_column(default=True)
    last_success_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

Migration `0006_shipments.py` (down `0005_sprint5`): create the 3 tables per models; downgrade drops in reverse.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_shipment_models.py -v` → PASS; `alembic upgrade head --sql` shows 3 tables.

- [ ] **Step 5: Full suite green.**

---

### Task 3: Carrier abstraction + AWB in dispatch + correction

**Files:**
- Create: `backend/app/carriers/__init__.py`, `backend/app/carriers/base.py`, `backend/app/carriers/registry.py`, `backend/app/carriers/manual.py`, `backend/app/carriers/dtdc.py`, `backend/app/carriers/tirupati.py`, `backend/app/carriers/india_post.py`, `backend/app/api/shipments.py`, `backend/tests/test_carriers.py`
- Modify: `backend/app/api/scanning.py` (DispatchIn += carrier_code/awb_number; create shipment post-commit), `backend/app/main.py` (mount), `backend/requirements.txt` (no new deps — stdlib only)

**Interfaces:**
- Consumes: `Shipment`, `get_current_user`, `dispatch_parcel`
- Produces: `get_provider(code) -> CarrierProvider`; `POST /shipments` (manual create); `POST /scan/dispatch` extended; `POST /shipments/{id}/correct-awb {awb_number, reason}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_carriers.py
def test_normalize_unknown():
    from app.carriers.registry import normalize_status
    assert normalize_status("DTDC", "Arrived at Ahmedabad DC") in ("AT_HUB", "UNKNOWN")

def test_stubs_raise_not_connected():
    from app.carriers.registry import get_provider
    import pytest
    with pytest.raises(Exception) as e:
        get_provider("DTDC").get_tracking("D1")
    assert "CARRIER_NOT_CONNECTED" in str(e.value)

def test_manual_capabilities():
    from app.carriers.registry import get_provider
    assert "TRACKING" in get_provider("MANUAL").capabilities()
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_carriers.py -v`
Expected: FAIL "No module named app.carriers".

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/carriers/base.py
class CarrierError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

class CarrierProvider:
    code: str = ""
    name: str = ""
    def capabilities(self) -> list[str]:
        return []
    def validate_credentials(self, creds: dict) -> bool:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"{self.code} is not connected.")
    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"{self.code} is not connected.")
    def normalize_status(self, raw: str) -> str:
        return "UNKNOWN"
    def build_tracking_url(self, awb: str) -> str | None:
        return None
```

```python
# backend/app/carriers/manual.py
from .base import CarrierProvider

KEYWORDS = [("deliver", "DELIVERED"), ("out for delivery", "OUT_FOR_DELIVERY"), ("ofd", "OUT_FOR_DELIVERY"),
            ("rto", "RTO_INITIATED"), ("return", "RETURN_AT_HUB"), ("pickup", "PICKED_UP"), ("picked", "PICKED_UP"),
            ("transit", "IN_TRANSIT"), ("hub", "AT_HUB"), ("hub", "AT_HUB"), ("book", "BOOKED"),
            ("lost", "LOST"), ("damage", "DAMAGED"), ("exception", "DELIVERY_EXCEPTION"), ("fail", "DELIVERY_EXCEPTION")]

class ManualProvider(CarrierProvider):
    code = "MANUAL"
    name = "Manual entry"
    def capabilities(self):
        return ["TRACKING"]
    def get_tracking(self, awb, creds=None):
        raise CarrierError("TRACKING_PROVIDER_ERROR", "Manual provider has no live tracking; record checkpoints via events API.")
    def normalize_status(self, raw: str) -> str:
        r = (raw or "").lower()
        for kw, norm in KEYWORDS:
            if kw in r:
                return norm
        return "UNKNOWN"
```

Add `from .base import CarrierError` to manual.py imports. dtdc/tirupati/india_post: subclass with code/name/capabilities (TRACKING per plan §28 minus unconfirmed ones: DTDC ["TRACKING"], Tirupati ["TRACKING"], IndiaPost ["TRACKING"]) + build_tracking_url real public patterns? No — return None until verified (plan: don't promise unverified). registry.py: `PROVIDERS = {...}; def get_provider(code) -> CarrierProvider (unknown → CarrierError CARRIER_NOT_CONNECTED); def normalize_status(code, raw)` delegating with UNKNOWN fallback.

Shipments API (tenant-scoped, auth; create ADMIN/WAREHOUSE; correct-awb ADMIN + reason + audit + event row preserving old AWB in message):
```python
@router.post("")
def create_shipment(body: ShipmentIn, ...):
    # validate parcel belongs to business; enforce UNIQUE via try/except IntegrityError → 400 AWB already linked
    # shipment tracking_status BOOKED, shipped_at=now
@router.get("")  # list w/ status + carrier filters, envelope {items,total,page}
@router.get("/{sid}")  # detail + financial summary placeholder + SLA placeholder (Tasks 5-6 fill)
@router.get("/{sid}/events")
@router.post("/{sid}/correct-awb")  # {awb_number, reason!}: audit AWB_CORRECTED old→new + ShipmentEvent note
```

Dispatch extension in scanning.py: `DispatchIn += carrier_code: str|None, awb_number: str|None`; after successful dispatch_parcel + commit: if both present → create Shipment(BOOKED) best-effort (duplicate AWB → skip with warning in metadata? No — raise ScanError? Plan §16 rule 7: AWB workflow satisfied if configured. MVP: attempt create; IntegrityError → proceed dispatch success but include "shipment_warning": "AWB already linked" in response data. Implement exactly that.)

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_carriers.py -v` → PASS (3 passed); full suite green.

- [ ] **Step 5: Manual dispatch-with-AWB via /docs**: dispatch with carrier DTDC + AWB → shipment row BOOKED; repeat AWB on another parcel → success + shipment_warning.

---

### Task 4: Tracking sync + manual checkpoints + carrier webhooks

**Files:**
- Create: `backend/app/api/carrier_webhooks.py`, `backend/tests/test_tracking.py`
- Modify: `backend/app/api/shipments.py` (add `POST /{id}/sync`, `POST /{id}/events`)

**Interfaces:**
- Consumes: `get_provider`, `normalize_status`, `ShipmentEvent`, `reconcile_order` (extend to shipment-touching? No — call reconcile on order after event ingest, best-effort)
- Produces: `POST /shipments/{id}/sync`; `POST /shipments/{id}/events`; `POST /webhooks/{carrier}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tracking.py
def test_manual_checkpoint_dedupes(seed_shipment):
    # POST second identical carrier_event_id → 200 but single event row
def test_unknown_status_stored():
    # checkpoint with gibberish raw → normalized UNKNOWN, row stored, shipment unchanged status
def test_terminal_stops_sync():
    # shipment DELIVERED → POST /sync returns {"synced": False, "reason": "terminal"}
```

Implementer: build `seed_shipment` on StaticPool pattern (business+user+order+parcel+shipment BOOKED); drive via TestClient with login headers (e2e pattern) OR service-level calls — service-level preferred (import route helpers? No — test through HTTP for dedupe + terminal logic).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_tracking.py -v`
Expected: FAIL 404 (no routes).

- [ ] **Step 3: Minimal implementation**

Sync route: load shipment (tenant-scoped, 404 AWB_NOT_FOUND if missing); if tracking_status in (DELIVERED, RETURNED, LOST, CLOSED) → `{"synced": False, "reason": "terminal"}`; else provider = get_provider(carrier) → try get_tracking → on CarrierError return `{"synced": False, "reason": code}` (TRACKING_PROVIDER_ERROR for manual); on success ingest each event via shared `_ingest(db, shipment, raw_event_dict, source)` then update shipment fields + last_synced_at + reconcile best-effort.
Events route: body `{carrier_event_id?, carrier_status_raw, message?, location?, event_time?}` → normalize → `_ingest` (duplicate carrier_event_id per shipment → return existing, no dup) → update shipment (status/location/checkpoint; delivered_at/rto_at/returned_at on terminal transitions) → reconcile.
`_ingest` shared helper in `app/services/shipment_service.py` (create it): upsert event + shipment field updates + returns event row.
Carrier webhook route: `POST /api/v1/webhooks/{carrier}` — verify provider signature ONLY if provider declares (manual: none → require query `?business_id` + admin token? No — simplest MVP: accept raw JSON `{awb_number, status_raw, message, location, event_id?}`, resolve shipment by (carrier, awb) across businesses? Tenant ambiguity — require header `X-Business-Id` matching an existing business, else 401. Store raw, 200 fast, process inline (BackgroundTasks optional — do inline, small). Unknown carrier → 404. Duplicate event id → dedupe.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_tracking.py -v` → PASS (3 passed); full suite green.

- [ ] **Step 5: Manual drill**: create shipment → manual checkpoint "Arrived at Ahmedabad DC" → status AT_HUB → duplicate POST → still 1 event row.

---

### Task 5: SLA + outstanding + cases + money-at-risk

**Files:**
- Create: `backend/app/models/sla.py` (SLARule, ShipmentCase, ShipmentFinancial), `backend/app/services/sla_service.py`, `backend/app/services/money_service.py`, `backend/app/api/sla.py`, `backend/alembic/versions/0007_sla.py`, `backend/tests/test_sla.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `Shipment`, `ShipmentEvent`, `Refund`, `Order`
- Produces: `sla_status(shipment, rules, now) -> {status, days_used, deadline}`; `money_at_risk(db, business_id) -> {total, buckets[]}`; `GET /shipments/outstanding`; CRUD `/sla/rules`, `/cases`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sla.py
def test_sla_bands():
    from app.services.sla_service import sla_status
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    mk = lambda start, allowed, warn: {"start": start, "allowed_days": allowed, "warning_days": warn}
    assert sla_status(mk(now - timedelta(days=1), 45, 7), now)["status"] == "NORMAL"
    assert sla_status(mk(now - timedelta(days=40), 45, 7), now)["status"] == "APPROACHING"
    assert sla_status(mk(now - timedelta(days=46), 45, 7), now)["status"] == "BREACHED"

def test_money_no_double_count():
    # order both unsettled-COD-eligible and breached → counted once (first bucket wins)
```

Implementer: second test needs money_service + seeded rows (order COD PAID? payment model has no COD flag — COD-eligibility derives from payment method == "COD"; seed Payment(method="COD")). Write full fixture in test.

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_sla.py -v`
Expected: FAIL "No module named app.services.sla_service".

- [ ] **Step 3: Minimal implementation**

Models: SLARule(business, carrier_code, event_type, start_event, allowed_days, warning_days, enabled); ShipmentCase(business, shipment_id, case_type, priority, complaint_reference NULL, status OPEN/IN_PROGRESS/RESOLVED, opened/next_followup/last_followup/resolved_at, notes, created_by, resolved_by); ShipmentFinancial(business, shipment_id UNIQUE, order_id, expected_cod/collected/settled/fee/other/net, reference/date/status per §45 enum).
`sla_status`: days_used = (now - start).days; BREACHED if >= allowed; APPROACHING if >= allowed - warning; else NORMAL; RESOLVED handled by caller (case/shipment terminal).
Clock start: RTO rules → shipment.rto_at or first RTO_INITIATED event time; delivery rules → shipped_at; settlement rules → delivered_at. No start → {"status": "NORMAL", "days_used": 0, "deadline": None} (never false-breach).
`money_at_risk`: buckets in order [unsettled COD (financial PAID + method COD + no settlement SETTLED), pending refunds (returns RECEIVED without refund), breached shipment value (order totals of BREACHED non-terminal shipments not already counted)]; each order id counted once.
Routes: `GET /shipments/outstanding?status=&carrier=&sla=` (age/deadline/amount/money-status computed per row), `GET/POST /sla/rules`, `PUT /sla/rules/{id}`, cases `GET/POST /cases`, `POST /cases/{id}/resolve`, `GET /money/at-risk`. Roles: config writes ADMIN; cases WAREHOUSE+; reads all.
Migration 0007 for the 4 tables.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_sla.py -v` → PASS; full suite green.

- [ ] **Step 5: Manual outstanding**: seed RTO-old shipment → appears BREACHED with age.

---

### Task 6: Statements upload → match → settle

**Files:**
- Create: `backend/app/models/statement.py` (StatementUpload, StatementRow), `backend/app/services/statement_service.py`, `backend/app/api/statements.py`, `backend/alembic/versions/0008_statements.py`, `backend/tests/test_statements.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py`, `backend/requirements.txt` (+= `openpyxl==3.1.5`)

**Interfaces:**
- Consumes: `Shipment`, `ShipmentFinancial`, `Order`, `log_audit`
- Produces: upload/dry-run/import/results/manual-match API; `match_row(db, business_id, row) -> {result, shipment_id?}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_statements.py
def test_duplicate_upload_blocked(auth_env):
    # upload CSV twice (same bytes) → second returns 400 STATEMENT_ALREADY_IMPORTED
def test_match_priority_awb_over_amount(auth_env):
    # two shipments same amount; row with AWB of second → matches second (never amount-alone)
def test_manual_match_audited(auth_env):
    # UNMATCHED row + POST manual match → MATCHED + audit row exists
```

Implementer: `auth_env` = TestClient + login + seeded shipment w/ AWB (copy e2e fixture style); CSV bytes inline (`AWB No,COD Amount,Settlement Date,Net Remittance\nD1,1499,2026-09-01,1409\n`).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_statements.py -v`
Expected: FAIL "No module named app.services.statement_service".

- [ ] **Step 3: Minimal implementation**

Column map per type (COURIER_SETTLEMENT required: awb_number; aliases: "AWB No"→awb_number, "COD Amount"→gross/expected, "Settlement Date"→settlement_date, "Net Remittance"→net; BANK/GATEWAY: external_reference+amount+date aliases "Txn Ref/UTR"→reference, "Amount"→net). Missing required → MISSING_REQUIRED_COLUMN 400 listing absent columns.
Upload: SHA-256 of bytes → existing upload with same hash+business → 400 STATEMENT_ALREADY_IMPORTED; parse (csv stdlib; xlsx openpyxl first sheet, header row 1); persist upload (READY) + rows (status PENDING).
Dry-run: `POST /statements/{id}/dry-run` → counts valid/warnings/errors WITHOUT matching (validate only).
Process: `POST /statements/{id}/process` → for each row: in-file dup (same awb+amount+date twice) → DUPLICATE; match priority: internal ref (settlement_reference on financials) → exact AWB → shopify order id/name → controlled (date ±3d AND amount equal AND single candidate) → else UNMATCHED; amount-only multi-candidate → UNMATCHED (never guess). MATCHED settlement rows upsert ShipmentFinancial (collected/settled/fee/net per columns, status SETTLED/PARTIALLY_SETTLED). Results: `GET /statements/{id}/results` counts + rows.
Manual match: `POST /statements/rows/{id}/match {shipment_id, reason?}` (ACCOUNTANT/ADMIN) → MATCHED + audit MANUAL_MATCH.
Types enum enforced; unknown type → INVALID_STATEMENT.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_statements.py -v` → PASS (3 passed); full suite green.

- [ ] **Step 5: Manual drill**: upload 2-row CSV → dry-run counts → process → 1 MATCHED 1 UNMATCHED → manual match → MATCHED.

---

### Task 7: R009–R022 engine + exceptions filters

**Files:**
- Modify: `backend/app/services/reconciliation_service.py` (append check_r009..r022 + CHECKS), `backend/app/api/reconciliation.py` (category filter), `backend/tests/test_reconciliation.py` (append), `backend/tests/test_seed_matrix.py` (append shipment/SLA cases)

**Interfaces:**
- Consumes: `Shipment`, `ShipmentEvent`, `ShipmentFinancial`, `SLARule`, `sla_status`, `StatementRow`, `Refund`, `ReturnRecord`, `Payment`
- Produces: 14 new issue codes with severities; `GET /issues?category=courier|money|returns|sla`

- [ ] **Step 1: Write the failing tests**

```python
def test_r009_dispatched_without_shipment():
    # dispatched parcel, no shipment → DISPATCHED_WITHOUT_SHIPMENT HIGH
def test_r014_cod_not_settled():
    # DELIVERED shipment + COD payment + no SETTLED financial → DELIVERED_COD_NOT_SETTLED HIGH
def test_r021_courier_returned_no_scan():
    # shipment RETURNED + no warehouse RETURN event → COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED HIGH
def test_r022_sla_breach():
    # RTO 50d old + rule 45d → SLA_BREACHED CRITICAL
```

Implementer: seed via _mk-style + Shipment rows; COD via Payment(method="COD").

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_reconciliation.py -k "r009 or r014 or r021 or r022" -v`
Expected: FAIL (codes never emitted).

- [ ] **Step 3: Minimal implementation**

Checks (each returns [_open(...)] or []):
- r009: DISPATCHED scan exists + no Shipment for parcel → HIGH DISPATCHED_WITHOUT_SHIPMENT. (Note: pre-AWB-orders will trip this — intended; backfill shipments to clear.)
- r010: dispatched + (carrier required? MVP: shipment exists) + shipment.awb_number empty → HIGH AWB_MISSING. (Shipments always have AWB by constraint — fires only for legacy/partial rows; keep for completeness.)
- r011: active shipment (not DELIVERED/RETURNED/LOST/CLOSED) + last_checkpoint_at older than 7d → MEDIUM SHIPMENT_STUCK.
- r012: RTO_AT set + RTO older than rule(45d default when no rule row) → HIGH RTO_DELAY.
- r013: return RECEIVED + received_at older than 7d + no inspected → MEDIUM RETURN_DELAY. (ReturnRecord has no inspected flag — use status != INSPECTED? Model has status RECEIVED/INSPECTED/CLOSED per spec: RECEIVED older than 7d and no REFUND_VERIFIED scan event → fire.)
- r014: shipment DELIVERED + COD payment + no ShipmentFinancial status SETTLED → HIGH DELIVERED_COD_NOT_SETTLED.
- r015: financial SETTLED/PARTIALLY + abs(net - (expected - fee - other)) > 1.0 → HIGH SETTLEMENT_AMOUNT_MISMATCH.
- r016: return RECEIVED + no refund + 3d elapsed → HIGH RETURNED_REFUND_MISSING. (R002 covers no-refund regardless of time; R016 adds the aging dimension — both may fire; acceptable per plan.)
- r017: refund exists + no return (any kind incl warehouse scan) → MEDIUM REFUND_WITHOUT_RETURN. (Same code as R003 — implement as the SAME check (dedupe: keep R003, R017 satisfied by it; document).)
- r018: tracking UNKNOWN + last sync > 24h → MEDIUM COURIER_STATUS_UNKNOWN.
- r019: statement rows UNMATCHED older than upload + 3d → MEDIUM STATEMENT_ROW_UNMATCHED (per-order? No — per-row issues attach to matched-order or business-level? Reconciliations are per-order: attach to best-guess order if row has order_reference else skip (queue covers it). Implement: only rows with matched_order_id NULL but order_reference resolving to an order → issue on that order.)
- r020: two SETTLED financials same shipment different refs → HIGH DUPLICATE_SETTLEMENT.
- r021: shipment status RETURNED + no warehouse RETURN/RTO scan event → HIGH COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED.
- r022: sla_status BREACHED + no RESOLVED case → CRITICAL SLA_BREACHED.
Category map for filter: courier {R009,R010,R011,R012,R018,R021}, money {R014,R015,R016,R020}, returns {R013,R016,R021}, sla {R012,R022}. `GET /issues?category=` filters issue_code IN set.

- [ ] **Step 4: Run to verify pass**

Run: full reconciliation + matrix suites → green, zero regressions on R001–R008 tests.

- [ ] **Step 5: Exceptions UI filter check**: category dropdown values work (Task 8 wires UI; verify API only here).

---

### Task 8: Monthly report + costs + P&L + workbook

**Files:**
- Create: `backend/app/models/cost.py` (ProductCostHistory, CostRule), `backend/app/services/cost_service.py`, `backend/app/services/report_service.py`, `backend/app/api/reports.py`, `backend/alembic/versions/0009_costs.py`, `backend/tests/test_reports.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: all domain tables
- Produces: `GET /reports/monthly?month=YYYY-MM`; `GET/PUT /settings/costs` (use settings-style routes under reports router: `GET /reports/costs`, `PUT /reports/costs`); `GET /reports/monthly/export`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_reports.py
def test_monthly_sections(auth_env):
    # seeded month: 2 orders (1 delivered+settled, 1 RTO) → sections present with exact keys
def test_pnl_estimated_label(auth_env):
    # default costs (ESTIMATED sources) → profitability.label == "ESTIMATED OPERATING PROFIT"
def test_cost_history_freezes(auth_env):
    # set cost 100 → report → change to 200 → same-month report unchanged (effective_to versioning)
```

Implementer: seed via _mk ×2 + Shipment/Financial/CostRule rows; CostRule {key, amount, source, effective_from}.

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_reports.py -v`
Expected: FAIL "No module named app.services.report_service".

- [ ] **Step 3: Minimal implementation**

CostRule model (business, key enum COGS_DEFAULT/SHIPPING/GATEWAY_FEE/PACKAGING/RETURN_COST/RTO_COST/OTHER, amount, source, effective_from, effective_to NULL) + ProductCostHistory (business, product_id NULL=global default, cost_price, currency, effective_from, effective_to NULL, source). Cost lookup: product-specific else global default else 0, as-of month end (effective range contains month-end).
Report builder: month window [1st, 1st-next); sections orders (counts by status incl delivered/returned/RTO), courier (per-carrier counts + SLA bands), returns (type/condition/refund splits), money (gross/discount/refund/expected/collected/settled/pending/fees/net — reuse money_service where overlapping, extend), exceptions (open by severity), costs (per-key totals + sources), profitability {revenue lines, cost lines, profit, label}.
Workbook: openpyxl, sheets Summary/Orders/Shipments/Money/Exceptions/Profitability; freeze panes, autofilter, INR number format `#,##0.00`, date format, header fill, column autosize (max 40), summary totals row.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_reports.py -v` → PASS (3 passed); full suite green.

- [ ] **Step 5: Manual report**: seed demo month → download workbook → open in Excel (spot-check totals).

---

### Task 9: UI routes + order blocks + regression + docs

**Files:**
- Create: `frontend/app/shipments/page.tsx`, `frontend/app/shipments/outstanding/page.tsx`, `frontend/app/shipments/[id]/page.tsx`, `frontend/app/statements/page.tsx`, `frontend/app/statements/[id]/page.tsx`, `frontend/app/reports/monthly/page.tsx`, `frontend/app/settings/carriers/page.tsx`, `frontend/app/settings/sla/page.tsx`, `frontend/app/settings/costs/page.tsx`, `frontend/tests/shipments.test.tsx`, `frontend/tests/statements.test.tsx`
- Modify: `frontend/app/orders/[id]/page.tsx` (courier/AWB/tracking/money blocks), `frontend/app/exceptions/page.tsx` (category filter), `README.md` (phases section)

**Interfaces:**
- Consumes: all new APIs + `api()`, `SeverityBadge`, `Timeline`
- Produces: 9 pages

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/tests/shipments.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { slaTone } from "../app/shipments/outstanding/page";
test("breach tone is critical", () => {
  expect(slaTone("BREACHED")).toBe("critical");
});
```

Shipments outstanding page must export `slaTone(status: string): "ok" | "warn" | "critical"` (NORMAL→ok, APPROACHING→warn, BREACHED→critical, else ok). Statements test: manual-match dialog renders on UNMATCHED row (render component with fixture row, assert Match button).

- [ ] **Step 2: Run to fail**

Run: `npm test -- shipments.test`
Expected: FAIL missing page.

- [ ] **Step 3: Minimal pages**

Shipments list (filters status/carrier + search AWB), outstanding (SLA band filter + age/deadline/amount + case button), detail (events timeline + money + SLA + cases + correct-AWB form w/ reason), statements (upload + type/provider/period selects + dry-run counts + results + manual-match dialog), monthly (month picker + sections + Excel download link), settings carriers (list + connect form note "keys encrypted, never displayed" + test button), sla (rules table + add/edit), costs (per-key inputs + source labels).
Order detail: courier block (carrier/AWB/status/location/updated), money block (expected/collected/settled/pending from financials or FALLBACK text "No settlement yet"), above timeline.
Exceptions: category select (All/Courier/Money/Returns/SLA) appended to existing filters.

- [ ] **Step 4: Verify**

Run: `npm test -- shipments.test` → PASS; second test file → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Full regression + docs**

Run: `python -m pytest tests -q` (zero failures) + `npm test -- --run` (green). README append (P0 checklist results, carrier stub note + what creds to provide later, pilot onboarding §108 adapted). Manual click-through of all 9 pages against seeded backend.
