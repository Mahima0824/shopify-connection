# Courier Booking+NDR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Book courier shipments explicitly with failure records, handle NDR/reattempt/RTO_DELIVERED as first-class states, drive normalization from DB mappings, and expose worker sweep endpoints plus a tracking command center.

**Architecture:** Migration `0012` (booking idempotency, attempts, status mappings, feature flags; RTO_DELIVERED joins TERMINAL); booking/cancel/NDR routes on shipments router; DB-first normalizer with keyword fallback; sweeps as ADMIN endpoints (cron-ready, no scheduler); tracking page + dispatch booking states + health cards.

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, pytest 8, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id`; all queries scoped by JWT `business_id`.
- Append-only events/audit; AWB corrections audit-only (existing); no silent overwrites.
- API envelope; scan/booking writes ADMIN/WAREHOUSE; resolve-financial ADMIN/ACCOUNTANT; config ADMIN; reads all authed roles.
- No guessed provider literals: mapping table seeds ZERO rows; keyword fallback serves until real contracts land.
- `RTO_DELIVERED` is terminal (stop polling) alongside DELIVERED/RETURNED/LOST/CLOSED.
- Customer model has name/email/phone only (no address/pincode/weight columns) — booking validates phone + COD amount, nothing else.
- Never commit `.env`; no new env keys.
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React`.

---

### Task 1: Schema (idempotency, attempts, mappings, flags) + TERMINAL

**Files:**
- Create: `backend/app/models/courier_meta.py`, `backend/alembic/versions/0012_courier.py`, `backend/tests/test_courier_schema.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/services/shipment_service.py` (TERMINAL += RTO_DELIVERED)

**Interfaces:**
- Consumes: `Base`, `uuidpk`
- Produces: `BookingIdempotency`, `ShipmentAttempt`, `CourierStatusMapping`, `CarrierFeature` models

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_courier_schema.py
def test_idempotency_unique():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.exc import IntegrityError
    import pytest
    from app.database import Base
    import app.models.business, app.models.courier_meta
    from app.models.business import Business
    from app.models.courier_meta import BookingIdempotency
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    db.add(BookingIdempotency(business_id=b.id, key="k1", shipment_id="s1"))
    db.commit()
    db.add(BookingIdempotency(business_id=b.id, key="k1", shipment_id="s2"))
    with pytest.raises(IntegrityError):
        db.commit()

def test_rto_delivered_terminal():
    from app.services.shipment_service import TERMINAL
    assert "RTO_DELIVERED" in TERMINAL
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_courier_schema.py -v`
Expected: FAIL "No module named app.models.courier_meta".

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/models/courier_meta.py
from sqlalchemy import ForeignKey, String, Integer, Text, DateTime, func, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class BookingIdempotency(Base):
    __tablename__ = "booking_idempotency"
    __table_args__ = (UniqueConstraint("business_id", "key", name="uq_bookidem_biz_key"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    key: Mapped[str] = mapped_column(String(64))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class ShipmentAttempt(Base):
    __tablename__ = "shipment_attempts"
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str | None] = mapped_column(ForeignKey("parcels.id"), nullable=True)
    carrier_code: Mapped[str] = mapped_column(String(32), default="")
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    occurred_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CourierStatusMapping(Base):
    __tablename__ = "courier_status_mappings"
    __table_args__ = (UniqueConstraint("provider", "provider_status_code", name="uq_csmap_prov_code"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    provider: Mapped[str] = mapped_column(String(32))
    provider_status_code: Mapped[str] = mapped_column(String(128))
    normalized_status: Mapped[str] = mapped_column(String(32))
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False)
    is_delivered: Mapped[bool] = mapped_column(Boolean, default=False)
    is_ndr: Mapped[bool] = mapped_column(Boolean, default=False)
    is_rto: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hub_event: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CarrierFeature(Base):
    __tablename__ = "carrier_features"
    __table_args__ = (UniqueConstraint("business_id", "provider", "capability", name="uq_cfeat_biz_prov_cap"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    provider: Mapped[str] = mapped_column(String(32))
    capability: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

`shipment_service.py`: `TERMINAL = ("DELIVERED", "RETURNED", "RTO_DELIVERED", "LOST", "CLOSED")`.
Migration `0012_courier.py` (down `0011_parcel_status`): 4 tables; downgrade drops reverse.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_courier_schema.py -v` → PASS (2 passed); SQL renders; full suite green.

- [ ] **Step 5: Check RTO_DELIVERED fallout**

Run full suite — RTO tests asserting stop-polling on old TERMINAL must still pass (superset only adds).

---

### Task 2: Booking + cancel + NDR endpoints

**Files:**
- Modify: `backend/app/api/shipments.py` (+book/cancel/ndr routes), `backend/app/services/shipment_service.py` (+book_shipment helper)
- Test: `backend/tests/test_booking.py`

**Interfaces:**
- Consumes: `Parcel`, `Order`, `Customer`, `Payment`, `Shipment`, `BookingIdempotency`, `ShipmentAttempt`, `get_provider`, `log_audit`
- Produces: `POST /shipments/{parcel_id}/book`; `POST /shipments/{id}/cancel`; `POST /shipments/{id}/ndr`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_booking.py
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.user
import app.models.order
import app.models.customer
import app.models.payment
import app.models.parcel
import app.models.shipment
from app.main import app
from app.database import get_db


def _env(phone="+91-900000001"):
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.customer import Customer
    from app.models.payment import Payment
    from app.models.parcel import Parcel
    from app.services.auth_service import hash_password
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u)
    db.commit()
    db.refresh(u)
    c = Customer(business_id=b.id, first_name="R", phone=phone)
    db.add(c)
    db.commit()
    db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-BK1", shopify_order_id="gid://bk1",
              shopify_order_name="#BK1", currency="INR", total_amount=500.0, financial_status="PAID",
              operational_status="NEW", customer_id=c.id, order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    db.add(Payment(business_id=b.id, order_id=o.id, amount=500.0, payment_status="PAID", method="COD"))
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="CREATED")
    db.add(p)
    db.commit()
    db.refresh(p)
    pid = p.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    t = TestClient(app)
    tok = t.post("/api/v1/auth/login", json={"email": "w@t.in", "password": "x"}).json()["data"]["token"]
    return t, {"Authorization": f"Bearer {tok}"}, pid


def test_book_validates_then_idempotent():
    c, h, pid = _env(phone=None)
    r = c.post(f"/api/v1/shipments/{pid}/book", json={"carrier_code": "MANUAL"}, headers=h)
    assert r.status_code == 400 and "phone" in r.text
    c2, h2, pid2 = _env(phone="+91-900000002")
    r = c2.post(f"/api/v1/shipments/{pid2}/book",
                json={"carrier_code": "MANUAL", "awb_number": "M100"},
                headers={**h2, "Idempotency-Key": "k-1"})
    assert r.status_code == 200, r.text
    sid = r.json()["data"]["id"]
    r2 = c2.post(f"/api/v1/shipments/{pid2}/book",
                 json={"carrier_code": "MANUAL", "awb_number": "M100"},
                 headers={**h2, "Idempotency-Key": "k-1"})
    assert r2.json()["data"]["id"] == sid


def test_book_uncredentialed_provider_fails_clean():
    c, h, pid = _env()
    r = c.post(f"/api/v1/shipments/{pid}/book", json={"carrier_code": "DTDC"}, headers=h)
    assert r.status_code == 400
    assert "CARRIER_NOT_CONNECTED" in r.text


def test_cancel_and_ndr():
    c, h, pid = _env()
    sid = c.post(f"/api/v1/shipments/{pid}/book",
                 json={"carrier_code": "MANUAL", "awb_number": "M200"}, headers=h).json()["data"]["id"]
    r = c.post(f"/api/v1/shipments/{sid}/cancel", json={"reason": "wrong carrier"}, headers=h)
    assert r.status_code == 200
    assert c.post(f"/api/v1/shipments/{sid}/cancel", json={"reason": "x"}, headers=h).status_code == 400
    c2, h2, pid2 = _env()
    sid2 = c2.post(f"/api/v1/shipments/{pid2}/book",
                   json={"carrier_code": "MANUAL", "awb_number": "M201"}, headers=h2).json()["data"]["id"]
    n = c2.post(f"/api/v1/shipments/{sid2}/ndr", json={"action": "reattempt", "reason": "door locked"}, headers=h2)
    assert n.status_code == 200
    assert n.json()["data"]["tracking_status"] == "NDR_REATTEMPT"
    t = c2.post(f"/api/v1/shipments/{sid2}/ndr", json={"action": "return"}, headers=h2)
    assert t.json()["data"]["tracking_status"] == "RTO_INITIATED"
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_booking.py -v`
Expected: FAIL 404 (no routes).

- [ ] **Step 3: Minimal implementation**

```python
class BookIn(BaseModel):
    carrier_code: str
    service: str | None = None
    awb_number: str | None = None

@router.post("/{parcel_id}/book")
def book(parcel_id: str, body: BookIn, request: Request, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from sqlalchemy.exc import IntegrityError
    from app.models.parcel import Parcel
    from app.models.order import Order
    from app.models.customer import Customer
    from app.models.payment import Payment
    from app.models.shipment import Shipment
    from app.models.courier_meta import BookingIdempotency, ShipmentAttempt
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    bid = u.get("business_id")
    key = request.headers.get("Idempotency-Key", "").strip() or None
    if key:
        hit = db.query(BookingIdempotency).filter_by(business_id=bid, key=key).first()
        if hit is not None:
            s = db.query(Shipment).filter_by(id=hit.shipment_id).first()
            return {"success": True, "data": {**_sdict(s), "deduped": True}}
    p = db.query(Parcel).filter_by(id=parcel_id, business_id=bid).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    if (p.status or "CREATED") in ("CLOSED", "RETURN_RECEIVED", "RTO", "DELIVERED", "DISPATCHED"):
        raise HTTPException(400, "Parcel not dispatchable")
    o = db.query(Order).filter_by(id=p.order_id).first()
    if o is None or o.cancelled_at is not None:
        raise HTTPException(400, "Order not bookable")
    if db.query(Shipment).filter_by(parcel_id=p.id).count() > 0:
        raise HTTPException(400, "Shipment already exists for parcel")
    missing = []
    cust = db.query(Customer).filter_by(id=o.customer_id).first() if o.customer_id else None
    if not (cust and cust.phone):
        missing.append("customer phone")
    cod = db.query(Payment).filter_by(business_id=bid, order_id=o.id, method="COD").first()
    carrier = (body.carrier_code or "").upper()
    if carrier not in ("MANUAL", "DTDC", "INDIA_POST"):
        raise HTTPException(400, "Unknown carrier")
    awb = (body.awb_number or "").strip()
    if carrier == "MANUAL" and not awb:
        missing.append("awb_number (manual carrier)")
    if missing:
        db.add(ShipmentAttempt(business_id=bid, parcel_id=p.id, carrier_code=carrier,
                               provider_message="; ".join(f"missing {m}" for m in missing)))
        db.commit()
        raise HTTPException(400, f"Cannot book: missing {', '.join(missing)}")
    if carrier != "MANUAL":
        db.add(ShipmentAttempt(business_id=bid, parcel_id=p.id, carrier_code=carrier,
                               provider_message="CARRIER_NOT_CONNECTED"))
        db.commit()
        raise HTTPException(400, "CARRIER_NOT_CONNECTED: save provider credentials first")
    s = Shipment(business_id=bid, order_id=o.id, parcel_id=p.id, carrier_code=carrier,
                 awb_number=awb, tracking_status="BOOKED", shipped_at=datetime.now(timezone.utc))
    db.add(s)
    db.flush()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "AWB already linked")
    db.refresh(s)
    if key:
        db.add(BookingIdempotency(business_id=bid, key=key, shipment_id=s.id))
        db.commit()
    log_audit(db, bid, u.get("user_id"), "shipment", s.id, "SHIPMENT_BOOKED",
              {"parcel": p.barcode_value}, {"carrier": carrier, "awb": awb})
    db.commit()
    return {"success": True, "data": _sdict(s)}
```

Cancel: ADMIN, pre-PICKED_UP only (BOOKED), else 400; status CANCELLED + audit SHIPMENT_CANCELLED. NDR: body {action: reattempt|return, reason?}: reattempt → NDR_REATTEMPT event + case DELIVERY_EXCEPTION; return → RTO_INITIATED + rto_at + event + reconcile best-effort. Both WAREHOUSE+.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_booking.py -v` → PASS; full suite green.

- [ ] **Step 5: Manual drill**: book → duplicate key → same id; book DTDC → clean 400 + attempt row visible.

---

### Task 3: DB-first normalizer + sweeps + health + cooldown

**Files:**
- Modify: `backend/app/carriers/registry.py` (+db_normalize), `backend/app/api/shipments.py` (+poll-sweep), `backend/app/api/sla.py` or new `backend/app/api/workers.py` (+sla/evaluate), `backend/app/api/carriers.py` (+health, refresh cooldown in sync route)
- Test: `backend/tests/test_normalizer_sweep.py`

**Interfaces:**
- Consumes: `CourierStatusMapping`, `TERMINAL`, `sla_status`, `RTO_DELAY`/`SHIPMENT_STUCK` open rows
- Produces: `db_normalize(db, bid, provider, raw)`; `POST /shipments/poll-sweep`; `POST /sla/evaluate`; `GET /carriers/health`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_normalizer_sweep.py
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.user
import app.models.order
import app.models.parcel
import app.models.shipment
import app.models.sla
from app.main import app
from app.database import get_db


def _env(awb="D800", status="RTO_IN_TRANSIT", days_old=50):
    from datetime import datetime, timedelta, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services.auth_service import hash_password
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    o = Order(business_id=b.id, internal_order_number="ORD-N1", shopify_order_id="gid://n1",
              shopify_order_name="#N1", currency="INR", total_amount=900.0, operational_status="DISPATCHED",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="DISPATCHED")
    db.add(p)
    db.commit()
    db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=awb, tracking_status=status,
                 rto_at=datetime.now(timezone.utc) - timedelta(days=days_old))
    db.add(s)
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}


def test_db_mapping_beats_keyword():
    from sqlalchemy import create_engine as _e
    from sqlalchemy.orm import sessionmaker as _mk
    from sqlalchemy.pool import StaticPool as _SP
    from app.database import Base as _B
    import app.models.business as _bb
    from app.models.business import Business
    from app.models.courier_meta import CourierStatusMapping
    from app.carriers.registry import db_normalize
    eng = _e("sqlite://", connect_args={"check_same_thread": False}, poolclass=_SP)
    _B.metadata.create_all(eng)
    mk = _mk(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    db.add(CourierStatusMapping(business_id=b.id, provider="DTDC", provider_status_code="Stuck at hub",
                                normalized_status="AT_HUB"))
    db.commit()
    assert db_normalize(db, b.id, "DTDC", "Stuck at hub") == "AT_HUB"
    assert db_normalize(db, b.id, "DTDC", "total gibberish xyz") is None
    db.close()


def test_evaluate_idempotent():
    c, h = _env()
    r1 = c.post("/api/v1/sla/evaluate", headers=h)
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["opened"] >= 1
    r2 = c.post("/api/v1/sla/evaluate", headers=h)
    assert r2.json()["data"]["opened"] == 0


def test_refresh_cooldown():
    c, h = _env()
    sid = c.get("/api/v1/shipments", headers=h).json()["data"]["items"][0]["id"]
    c.post(f"/api/v1/shipments/{sid}/events",
           json={"carrier_status_raw": "picked up"}, headers=h)
    c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
    r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
    assert r.status_code == 429
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_normalizer_sweep.py -v`
Expected: FAIL (no functions/routes).

- [ ] **Step 3: Minimal implementation**

```python
# registry.py addition
def db_normalize(db, business_id: str, provider: str, raw: str) -> str | None:
    from app.models.courier_meta import CourierStatusMapping
    code = (raw or "").strip()
    if not code:
        return None
    for bid in (business_id, None):
        m = db.query(CourierStatusMapping).filter_by(provider=provider.upper(), provider_status_code=code).filter(
            CourierStatusMapping.business_id == bid if bid else CourierStatusMapping.business_id.is_(None)).first()
        if m is not None:
            return m.normalized_status
    return None
```

`normalize_status` in manual.py stays (fallback); `_ingest` in shipment_service: try db mapping first — needs db + business: ingest_event already receives db + shipment (has business_id). Edit: `norm = db_normalize(...) or normalize_status(...)`. Careful with circular imports (carriers←? registry imports nothing from services — safe; shipment_service imports registry already? It calls normalize_status from registry — yes per Task 4. Add db_normalize import same place.)
Poll-sweep (ADMIN): non-terminal shipments ordered by oldest checkpoint, limit param default 100: MANUAL → skipped++; else provider.get_tracking (stubs raise → errors++ with code, attempts row? No — record last_error on connection row if exists). Returns counts. Never raises 500 on provider errors (caught per shipment).
Evaluate (ADMIN): for active shipments: RTO-old per rules → _open RTO_DELAY (reuse pattern: import _open? It's private in reconciliation_service — replicate minimal upsert via Reconciliation model directly in sla.py? Better: call reconcile_order(db, order_id) per active order (it already covers R012/R022/R011) + additionally open WAREHOUSE_DELAY/TRACKING_STALE per plan codes: hub-status + >24h idle → WAREHOUSE_DELAY HIGH; UNKNOWN + >24h unsynced → TRACKING_STALE MEDIUM. Implement small local _open_like helper (copy 12-line pattern, renamed). Idempotent by (order, code) unique constraint.
Cooldown: in sync_shipment, if last_synced_at within 60s → 429 with X-Error-Code REFRESH_COOLDOWN + {"retry_after": secs}.
Health: GET /carriers/health → per provider {configured (connection row exists+active), capabilities, last_success, last_error} (never credentials).

- [ ] **Step 4: Run to verify pass**

Run: new tests → PASS; full suite green.

- [ ] **Step 5: Manual sweep**: seed old RTO → evaluate → WAREHOUSE_DELAY/RTO_DELAY rows → again → no dupes.

---

### Task 4: Tracking UI + dispatch booking states + health cards

**Files:**
- Create: `frontend/app/shipments/tracking/page.tsx`, `frontend/tests/tracking.test.tsx`
- Modify: `frontend/app/scan/dispatch/page.tsx` (booking states), `frontend/app/settings/carriers/page.tsx` (health cards), `frontend/app/shipments/[id]/page.tsx` (refresh button w/ cooldown message)

**Interfaces:**
- Consumes: booking/sync/health APIs, `api()`
- Produces: command-center page + booking UX states

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/tracking.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { bandTone } from "../lib/tracking";
test("delay band tones", () => {
  expect(bandTone("WAREHOUSE_DELAY")).toBe("warn");
  expect(bandTone("DELIVERED")).toBe("ok");
  expect(bandTone("NDR")).toBe("critical");
});
```

```ts
// frontend/lib/tracking.ts
export function bandTone(status: string): "ok" | "warn" | "critical" {
  if (["NDR", "LOST", "DAMAGED", "RTO_DELAY"].includes(status)) return "critical";
  if (["WAREHOUSE_DELAY", "TRACKING_STALE", "DELIVERY_EXCEPTION", "RTO_INITIATED"].includes(status)) return "warn";
  return "ok";
}
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- tracking.test`
Expected: FAIL missing modules.

- [ ] **Step 3: Minimal implementation**

Tracking page: summary cards (counts by band via /shipments/outstanding + /shipments lists — compute client-side from outstanding rows + status filter), search (AWB/order/barcode/phone — phone needs customer join: backend lacks it; search AWB/order/barcode client-side, phone documented as backend-todo? No — add `?q=` to list_shipments searching awb_number/order name/barcode via parcel join. Implementer: extend list route with q filter (ilike on awb + order name + parcel barcode). Note in code.), filters carrier/status/exception-band, manual refresh per row (shows cooldown message on 429).
Dispatch page: after lookup, if no shipment → courier select + [Book shipment] → states IDLE→BOOKING→BOOKED/BOOKING_ERROR (isSubmitting guard, Idempotency-Key header uuid per click); if shipment exists → show AWB + skip booking (plan §60).
Settings carriers: health cards per provider from GET /carriers/health (no secrets rendered).
Shipment detail: Refresh button calling sync with cooldown error display.

- [ ] **Step 4: Verify**

Run: `npm test -- tracking.test` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual command center**: seed mixed states → cards + search + refresh cooldown message visible.
