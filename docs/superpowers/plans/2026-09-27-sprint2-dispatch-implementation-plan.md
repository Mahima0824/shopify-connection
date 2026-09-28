# Sprint 2 Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every order gets a parcel + Code128 barcode, printable labels, and a transactional dispatch-scan API + scanner UI that blocks duplicates/cancelled/invalid codes.

**Architecture:** New `parcels` + `scan_events` tables via Alembic `0002_sprint2`; `barcode_service` (per-business `P00000001` sequence) + `scanning_service.dispatch_parcel` (SELECT FOR UPDATE transaction) behind thin `parcels`/`scanning` routers; Next.js `/scan/dispatch` wedge-friendly page + `/parcels/{id}/label` print HTML.

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, python-barcode 0.15 + Pillow 10 (Code128 SVG/PNG), pytest 8 + httpx, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id` UUID.
- `scan_events` is append-only; never update/delete event rows.
- API envelope `{success:true,data}` / `{success:false,error:{code,message}}`; scan error codes `ORDER_CANCELLED`, `PARCEL_ALREADY_DISPATCHED`, `INVALID_BARCODE`, `USER_NOT_AUTHORIZED`, `DISPATCH_NOT_ALLOWED`.
- Route handlers thin; business logic in `services/scanning_service.py` + `services/barcode_service.py`.
- Barcode format `P` + 8 zero-padded digits per business; never encode PII.
- Dispatch runs in one DB transaction with row lock; concurrent double-scan yields exactly 1 DISPATCHED event.
- Auth required on all scan/parcel routes via existing `get_current_user`.
- Never commit `.env`; no new env keys.
- Backend tests run with workdir `backend/`.

---

### Task 1: Parcels + barcode service + migration

**Files:**
- Create: `backend/app/models/parcel.py`, `backend/app/models/scan_event.py`, `backend/app/services/barcode_service.py`, `backend/alembic/versions/0002_sprint2.py`, `backend/tests/test_parcels.py`
- Modify: `backend/app/models/__init__.py` (export new models), `backend/requirements.txt` (add barcode libs), `backend/alembic/env.py` (ensure imports — verify, add only if missing)

**Interfaces:**
- Consumes: `Base`, `uuidpk`, `Session`
- Produces: `generate_barcode(db: Session, business_id: str) -> str`; `ensure_parcel_for_order(db, order_id: str) -> Parcel`; `Parcel(id, business_id, order_id, parcel_code, barcode_value, status)`; `ScanEvent(...)` append-only

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_parcels.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event

def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()

def _biz(db):
    from app.models.business import Business
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b); return b

def test_generate_barcode_sequence():
    from app.services.barcode_service import generate_barcode
    db = _db(); b = _biz(db)
    c1 = generate_barcode(db, b.id)
    c2 = generate_barcode(db, b.id)
    assert c1 == "P00000001"
    assert c2 == "P00000002"

def test_ensure_parcel_idempotent():
    from app.models.order import Order
    from app.services.barcode_service import ensure_parcel_for_order
    from datetime import datetime, timezone
    db = _db(); b = _biz(db)
    o = Order(business_id=b.id, internal_order_number="ORD-1", shopify_order_id="gid://1",
              shopify_order_name="#1", currency="INR", subtotal_amount=100.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=100.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    p1 = ensure_parcel_for_order(db, o.id)
    p2 = ensure_parcel_for_order(db, o.id)
    assert p1.id == p2.id
    assert p1.barcode_value == "P00000001"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_parcels.py -v`
Expected: FAIL with "No module named app.services.barcode_service"

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/models/parcel.py
from sqlalchemy import ForeignKey, String, DateTime, func, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Parcel(Base):
    __tablename__ = "parcels"
    __table_args__ = (
        UniqueConstraint("business_id", "barcode_value", name="uq_parcel_biz_barcode"),
        Index("ix_parcels_barcode", "barcode_value"),
        Index("ix_parcels_order", "order_id"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_code: Mapped[str] = mapped_column(String(32))
    barcode_value: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="CREATED")
```

```python
# backend/app/models/scan_event.py
from sqlalchemy import ForeignKey, String, DateTime, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class ScanEvent(Base):
    __tablename__ = "scan_events"
    __table_args__ = (Index("ix_scan_parcel_created", "parcel_id", "created_at"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    performed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[str] = mapped_column(String(128), nullable=True)
    event_metadata: Mapped[dict] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

```python
# backend/app/services/barcode_service.py
from sqlalchemy.orm import Session

def generate_barcode(db: Session, business_id: str) -> str:
    from app.models.parcel import Parcel
    codes = [r[0] for r in db.query(Parcel.barcode_value).filter_by(business_id=business_id).all()]
    nums = [int(c[1:]) for c in codes if c.startswith("P") and c[1:].isdigit()]
    return f"P{(max(nums, default=0) + 1):08d}"

def ensure_parcel_for_order(db: Session, order_id: str):
    from app.models.order import Order
    from app.models.parcel import Parcel
    o = db.query(Order).filter_by(id=order_id).one()
    p = db.query(Parcel).filter_by(order_id=order_id).first()
    if p is not None:
        return p
    code = generate_barcode(db, o.business_id)
    p = Parcel(business_id=o.business_id, order_id=o.id, parcel_code=code, barcode_value=code, status="CREATED")
    db.add(p); db.commit(); db.refresh(p)
    return p
```

```python
# backend/alembic/versions/0002_sprint2.py
"""sprint2 parcels + scan_events"""
from alembic import op
import sqlalchemy as sa
revision = "0002_sprint2"
down_revision = "0001_sprint1"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("parcels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("parcel_code", sa.String(32), nullable=False),
        sa.Column("barcode_value", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), server_default="CREATED", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "barcode_value", name="uq_parcel_biz_barcode"))
    op.create_index("ix_parcels_barcode", "parcels", ["barcode_value"])
    op.create_index("ix_parcels_order", "parcels", ["order_id"])
    op.create_table("scan_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("performed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("event_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_scan_parcel_created", "scan_events", ["parcel_id", "created_at"])

def downgrade():
    op.drop_index("ix_scan_parcel_created", table_name="scan_events")
    op.drop_table("scan_events")
    op.drop_index("ix_parcels_order", table_name="parcels")
    op.drop_index("ix_parcels_barcode", table_name="parcels")
    op.drop_table("parcels")
```

Requirements addition:
```txt
python-barcode==0.15.1
Pillow==10.4.0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_parcels.py -v`
Expected: PASS (2 passed). Then `python -m pytest tests -q` — all green.

- [ ] **Step 5: Verify migration SQL renders**

Run: `alembic upgrade head --sql | Select-String "CREATE TABLE parcels" -Context 0,2`
Expected: parcels + scan_events DDL present.

---

### Task 2: Label generation + parcel lookup + backfill

**Files:**
- Create: `backend/app/api/parcels.py`
- Modify: `backend/app/main.py:1-10` (mount parcels router), `backend/app/services/shopify_service.py` (auto-create parcel after upsert — append 6 lines), `frontend/app/parcels/[barcode]/page.tsx`
- Test: `backend/tests/test_labels.py`

**Interfaces:**
- Consumes: `ensure_parcel_for_order`, `get_current_user`, Code128 via `barcode.Code128`
- Produces: `GET /api/v1/parcels/{barcode} -> {parcel, order, customer, item_count}`; `GET /api/v1/parcels/{id}/label -> text/html`; `POST /api/v1/parcels/backfill -> {created}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_labels.py
def test_parcel_lookup_and_backfill(client_auth):
    r = client_auth.post("/api/v1/parcels/backfill")
    assert r.status_code == 200
    n = r.json()["data"]["created"]
    assert n >= 1
    r2 = client_auth.get("/api/v1/orders")
    oid = r2.json()["data"]["items"][0]["id"]
    from app.database import SessionLocal
    from app.models.parcel import Parcel
    from app.models.order import Order
    db = SessionLocal()
    o = db.query(Order).first()
    p = db.query(Parcel).filter_by(order_id=o.id).first()
    assert p is not None
    r3 = client_auth.get(f"/api/v1/parcels/{p.barcode_value}")
    assert r3.status_code == 200
    assert r3.json()["data"]["parcel"]["barcode_value"] == p.barcode_value
    r4 = client_auth.get(f"/api/v1/parcels/{p.id}/label")
    assert r4.status_code == 200
    assert "text/html" in r4.headers["content-type"]
    assert p.barcode_value in r4.text
```

Note: `client_auth` fixture = TestClient with sqlite override + seeded business/user + 1 fixture order synced (copy pattern from `test_e2e_sprint1.py`).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_labels.py -v`
Expected: FAIL "No module named app.api.parcels" or 404

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/api/parcels.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/parcels", tags=["parcels"])

def _pdict(p) -> dict:
    return {"id": p.id, "business_id": p.business_id, "order_id": p.order_id,
            "parcel_code": p.parcel_code, "barcode_value": p.barcode_value, "status": p.status}

@router.get("/{barcode}")
def lookup(barcode: str, db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    from app.models.parcel import Parcel
    from app.models.order import Order, OrderItem
    p = db.query(Parcel).filter_by(barcode_value=barcode).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    o = db.query(Order).filter_by(id=p.order_id).first()
    items = db.query(OrderItem).filter_by(order_id=o.id).all() if o else []
    cust = None
    if o is not None and o.customer_id:
        from app.models.customer import Customer
        c = db.query(Customer).filter_by(id=o.customer_id).first()
        cust = {"name": c.name, "email": c.email, "phone": c.phone} if c else None
    return {"success": True, "data": {"parcel": _pdict(p),
        "order": {"id": o.id, "shopify_order_name": o.shopify_order_name, "total_amount": float(o.total_amount or 0),
                  "financial_status": o.financial_status, "operational_status": o.operational_status} if o else None,
        "customer": cust, "item_count": len(items)}}

@router.post("/backfill")
def backfill(db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.services.barcode_service import ensure_parcel_for_order
    n = 0
    for o in db.query(Order).all():
        if db.query(Parcel).filter_by(order_id=o.id).first() is None:
            ensure_parcel_for_order(db, o.id); n += 1
    return {"success": True, "data": {"created": n}}

@router.get("/{parcel_id}/label", response_class=HTMLResponse)
def label(parcel_id: str, db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    import barcode
    from barcode.writer import SVGWriter
    from io import BytesIO
    from app.models.parcel import Parcel
    from app.models.order import Order
    p = db.query(Parcel).filter_by(id=parcel_id).first()
    if p is None:
        p = db.query(Parcel).filter_by(barcode_value=parcel_id).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    o = db.query(Order).filter_by(id=p.order_id).first()
    buf = BytesIO()
    barcode.Code128(p.barcode_value, writer=SVGWriter()).write(buf)
    svg = buf.getvalue().decode("utf-8")
    oname = o.shopify_order_name if o else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Label {p.barcode_value}</title>
<style>@media print {{ .label {{ page-break-inside: avoid; }} }} body {{ font-family: sans-serif; }} .label {{ border: 2px solid #000; padding: 16px; max-width: 380px; }} svg {{ width: 100%; height: auto; }}</style>
</head><body><div class="label"><h2>Recon Parcel</h2><p>Order: {oname}</p><p>Parcel: {p.parcel_code}</p>{svg}<p>{p.barcode_value}</p></div>
<script>window.print && null;</script></body></html>"""
```

Shopify auto-create hook — append at end of `upsert_order` in `shopify_service.py` (after `db.refresh(o)`):
```python
    try:
        from app.services.barcode_service import ensure_parcel_for_order
        ensure_parcel_for_order(db, o.id)
    except Exception:
        db.rollback()
```

Mount in `main.py`:
```python
from app.api.parcels import router as parcels_router
app.include_router(parcels_router)
```

Frontend `app/parcels/[barcode]/page.tsx`: fetch `api('/api/v1/parcels/'+barcode, {}, token)`, render parcel/order/customer card + `<a href={API+'/api/v1/parcels/'+id+'/label'} target=_blank>Print label</a>`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_labels.py tests/test_parcels.py -v`
Expected: PASS

- [ ] **Step 5: Manual label check**

Run: start backend, login, backfill, open label URL in browser, Ctrl+P preview shows bordered label + barcode SVG.

---

### Task 3: Dispatch scan API (transactional + validation)

**Files:**
- Create: `backend/app/services/scanning_service.py`, `backend/app/api/scanning.py`, `backend/tests/test_dispatch.py`
- Modify: `backend/app/main.py` (mount scanning router)

**Interfaces:**
- Consumes: `Parcel`, `ScanEvent`, `get_current_user`, `Session`
- Produces: `dispatch_parcel(db, business_id, barcode, user_id, device_id=None, override=False, reason=None) -> dict`; `POST /api/v1/scan/dispatch {barcode, device_id?, override?, reason?}`; error class `ScanError(code, message, status)`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dispatch.py
def test_valid_dispatch_flips_status(seed_order_parcel_user):
    from app.services.scanning_service import dispatch_parcel
    db, order, parcel, user = seed_order_parcel_user
    out = dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    assert out["parcel"]["status"] == "DISPATCHED"
    assert out["order"]["operational_status"] == "DISPATCHED"
    from app.models.scan_event import ScanEvent
    assert db.query(ScanEvent).filter_by(parcel_id=parcel.id, event_type="DISPATCHED").count() == 1

def test_duplicate_dispatch_blocked(seed_order_parcel_user):
    from app.services.scanning_service import dispatch_parcel, ScanError
    import pytest
    db, order, parcel, user = seed_order_parcel_user
    dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    assert e.value.code == "PARCEL_ALREADY_DISPATCHED"

def test_cancelled_blocked(seed_cancelled_order):
    from app.services.scanning_service import dispatch_parcel, ScanError
    import pytest
    db, order, parcel, user = seed_cancelled_order
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    assert e.value.code == "ORDER_CANCELLED"

def test_invalid_barcode(seed_order_parcel_user):
    from app.services.scanning_service import dispatch_parcel, ScanError
    import pytest
    db, order, parcel, user = seed_order_parcel_user
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, "P99999999", user.id)
    assert e.value.code == "INVALID_BARCODE"
```

Fixtures `seed_order_parcel_user` / `seed_cancelled_order`: sqlite StaticPool, create business+user+order(via fixture payload through `upsert_order`)+parcel via `ensure_parcel_for_order`; cancelled variant sets `order.cancelled_at`. (Write full fixture code in test file — 25 lines, copy `test_sync_idempotency` pattern.)

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_dispatch.py -v`
Expected: FAIL "No module named app.services.scanning_service"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/scanning_service.py
class ScanError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code; self.message = message; self.status = status

def dispatch_parcel(db, business_id: str, barcode: str, user_id: str, device_id=None, override: bool = False, reason: str | None = None) -> dict:
    from sqlalchemy import select
    from app.models.parcel import Parcel
    from app.models.order import Order
    from app.models.scan_event import ScanEvent
    from app.models.user import User
    u = db.query(User).filter_by(id=user_id).first()
    if u is None or not u.is_active:
        raise ScanError("USER_NOT_AUTHORIZED", "User is inactive or unknown.", 403)
    with db.begin_nested():
        p = db.execute(select(Parcel).where(Parcel.business_id == business_id, Parcel.barcode_value == barcode).with_for_update()).scalar_one_or_none()
        if p is None:
            raise ScanError("INVALID_BARCODE", f"No parcel found for barcode {barcode}.", 404)
        o = db.query(Order).filter_by(id=p.order_id).first()
        if o is None:
            raise ScanError("INVALID_BARCODE", "Parcel has no order.", 404)
        if o.cancelled_at is not None:
            raise ScanError("ORDER_CANCELLED", f"Order {o.shopify_order_name} is cancelled. Do not dispatch.", 400)
        prior = db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="DISPATCHED").count()
        if prior > 0:
            raise ScanError("PARCEL_ALREADY_DISPATCHED", "This parcel was already dispatched.", 400)
        if (o.financial_status in ("REFUNDED", "VOIDED")) and not (override and (u.role == "ADMIN") and reason):
            raise ScanError("DISPATCH_NOT_ALLOWED", "Order is refunded/void. Admin override with reason required.", 400)
        db.add(ScanEvent(business_id=business_id, parcel_id=p.id, order_id=o.id,
                         event_type="DISPATCHED", performed_by=user_id, device_id=device_id,
                         event_metadata={"override": bool(override), "reason": reason} if override else None))
        p.status = "DISPATCHED"
        o.operational_status = "DISPATCHED"
    db.commit()
    db.refresh(p); db.refresh(o)
    return {"parcel": {"id": p.id, "barcode_value": p.barcode_value, "status": p.status},
            "order": {"id": o.id, "shopify_order_name": o.shopify_order_name, "operational_status": o.operational_status}}
```

```python
# backend/app/api/scanning.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/scan", tags=["scan"])

class DispatchIn(BaseModel):
    barcode: str
    device_id: str | None = None
    override: bool = False
    reason: str | None = None

@router.post("/dispatch")
def scan_dispatch(body: DispatchIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.scanning_service import dispatch_parcel, ScanError
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    try:
        out = dispatch_parcel(db, u.get("business_id"), body.barcode.strip(), u.get("user_id"),
                              body.device_id, body.override, body.reason)
    except ScanError as e:
        raise HTTPException(e.status, e.message, headers={"X-Error-Code": e.code})
    return {"success": True, "data": out}
```

Mount in `main.py`: `from app.api.scanning import router as scan_router; app.include_router(scan_router)`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_dispatch.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Concurrency smoke (document, full test in Task 5)**

Run two sequential dispatches manually — second must raise `PARCEL_ALREADY_DISPATCHED`.

---

### Task 4: Dispatch scanner UI

**Files:**
- Create: `frontend/app/scan/dispatch/page.tsx`, `frontend/components/ScanBanner.tsx`
- Test: extend `frontend/tests/orders.test.tsx`? No — create `frontend/tests/scan.test.tsx`

**Interfaces:**
- Consumes: `api()` helper + `GET /api/v1/parcels/{barcode}` + `POST /api/v1/scan/dispatch`
- Produces: wedge-friendly scan page

- [ ] **Step 1: Write failing component test**

```tsx
// frontend/tests/scan.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ScanBanner from "../components/ScanBanner";
test("banner shows error text", () => {
  render(<ScanBanner kind="error" text="Already dispatched at 10:42 AM by Raj" />);
  expect(screen.getByText(/Already dispatched/)).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- scan.test`
Expected: FAIL missing component (after `npm install` — deps now present)

- [ ] **Step 3: Minimal pages**

```tsx
// frontend/components/ScanBanner.tsx
export default function ScanBanner({ kind, text }: { kind: "ok" | "error" | "warn"; text: string }) {
  const icon = kind === "ok" ? "✅" : kind === "warn" ? "⚠" : "❌";
  return <div role={kind === "error" ? "alert" : "status"}><span>{icon}</span> <span>{text}</span></div>;
}
```

```tsx
// frontend/app/scan/dispatch/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { api, API } from "../../../lib/api";
import ScanBanner from "../../../components/ScanBanner";

type Last = { barcode: string; order: string; total: number; status: string } | null;
export default function DispatchPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [last, setLast] = useState<Last>(null);
  const [hist, setHist] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "/") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    if (!barcode) return;
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const look = await api<{ parcel: any; order: any }>(`/api/v1/parcels/${barcode}`, {}, token);
      const out = await api<{ parcel: any; order: any }>(`/api/v1/scan/dispatch`, { method: "POST", body: JSON.stringify({ barcode }) }, token);
      setLast({ barcode, order: out.order.shopify_order_name, total: out.order ? 0 : 0, status: "DISPATCHED" });
      setMsg({ kind: "ok", text: `Dispatched ${out.order.shopify_order_name} (${barcode})` });
      setHist((h) => [barcode, ...h].slice(0, 10));
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Scan failed" });
    } finally {
      setCode("");
      ref.current?.focus();
    }
  }
  return (
    <main>
      <h1>Scan dispatch</h1>
      <form onSubmit={submit}>
        <input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan barcode" aria-label="Parcel barcode" style={{ fontSize: 24 }} />
        <button type="submit">Confirm dispatch</button>
      </form>
      {msg && <ScanBanner kind={msg.kind} text={msg.text} />}
      {last && <p>Last: {last.order} {last.barcode}</p>}
      <ul>{hist.map((h) => <li key={h}>{h}</li>)}</ul>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- scan.test`
Expected: PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual wedge test**

Run dev, focus input, type `P00000001` + Enter → success banner + autofocus retained.

---

### Task 5: Concurrency + regression + docs

**Files:**
- Create: `backend/tests/test_concurrency.py`
- Modify: `README.md` (append Sprint 2 section), `.github/workflows/ci.yml` (no change — verify backend job covers new tests)

**Interfaces:**
- Consumes: `dispatch_parcel`, TestClient
- Produces: proof of exactly-once dispatch

- [ ] **Step 1: Write failing concurrency test**

```python
# backend/tests/test_concurrency.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event
import threading

def _setup():
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.services.auth_service import hash_password
    from app.services.barcode_service import ensure_parcel_for_order
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u); db.commit(); db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-9", shopify_order_id="gid://9",
              shopify_order_name="#9", currency="INR", subtotal_amount=10.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=10.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    p = ensure_parcel_for_order(db, o.id)
    return eng, b, u, o, p

def test_concurrent_double_scan_single_win():
    from app.services.scanning_service import dispatch_parcel, ScanError
    from sqlalchemy.orm import sessionmaker
    eng, b, u, o, p = _setup()
    results = []
    def worker():
        from app.database import SessionLocal as _S
        db = sessionmaker(bind=eng)()
        try:
            dispatch_parcel(db, b.id, p.barcode_value, u.id)
            results.append("ok")
        except ScanError as e:
            results.append(e.code)
        finally:
            db.close()
    ts = [threading.Thread(target=worker) for _ in range(2)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert sorted(results) == ["PARCEL_ALREADY_DISPATCHED", "ok"]
    from app.models.scan_event import ScanEvent
    from app.database import SessionLocal
    db = sessionmaker(bind=eng)()
    assert db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="DISPATCHED").count() == 1
```

- [ ] **Step 2: Run to verify fail-or-flaky**

Run: `python -m pytest tests/test_concurrency.py -v`
Expected: FAIL (no scanning_service) first run; after Task 3 passes. SQLite threads may both pass without FOR UPDATE — if green-but-wrong, note limitation: Postgres `FOR UPDATE` is the real guard; sqlite test asserts service-level duplicate check.

- [ ] **Step 3: Harden if needed**

If both threads pass on sqlite, add application-level guard already present: `prior = count(DISPATCHED)` inside transaction catches the common case; document Postgres `FOR UPDATE` as production guard in README. No code change if Task 3 logic present.

- [ ] **Step 4: Full regression**

Run: `python -m pytest tests -v`
Expected: 8 existing + 2 parcels + 4 dispatch + 1 concurrency + label tests — all PASS.

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS.

- [ ] **Step 5: Docs**

Append to `README.md`:
```md
## Sprint 2 — Dispatch
- Backfill: `POST /api/v1/parcels/backfill` (authed) creates 1 parcel per order.
- Lookup: `GET /api/v1/parcels/{barcode}`; label: `GET /api/v1/parcels/{id}/label` (print HTML, Code128 SVG).
- Scan: `POST /api/v1/scan/dispatch {barcode}` (WAREHOUSE/ADMIN). Errors: ORDER_CANCELLED, PARCEL_ALREADY_DISPATCHED, INVALID_BARCODE, DISPATCH_NOT_ALLOWED.
- UI: `/scan/dispatch` (autofocus, `/` refocus, recent 10), `/parcels/[barcode]` + print link.
- Alembic: `alembic upgrade head` adds parcels + scan_events.
```
