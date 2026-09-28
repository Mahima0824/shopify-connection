# Sprint 3 Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record customer returns and RTOs against dispatched parcels with partial quantities, show a full order timeline, and audit business-critical mutations.

**Architecture:** New `returns` + `return_items` + `audit_logs` tables via Alembic `0003_sprint3`; `return_service.record_return` (SELECT FOR UPDATE transaction, Sprint 2 dispatch pattern) behind thin `returns`/`scanning` additions; `timeline_service` composes order + scan_events + audit rows; Next.js `/scan/return` page + timeline section on order detail.

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, pytest 8 + StaticPool sqlite, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id` UUID; all return/parcel/order queries scoped by JWT `business_id`.
- `scan_events` and `audit_logs` are append-only; never update/delete rows.
- API envelope `{success:true,data}` / `{success:false,error:{code,message}}`; return error codes `INVALID_BARCODE`, `RETURN_WITHOUT_DISPATCH`, `RETURN_ALREADY_RECORDED`, `INVALID_RETURN_ITEM`, `RETURN_QUANTITY_MISMATCH`, `USER_NOT_AUTHORIZED`.
- Route handlers thin; business logic in `services/return_service.py` + `services/timeline_service.py` + `services/audit_service.py`.
- `OrderItem.quantity` is the ordered count (field name is `quantity`, not `ordered_quantity`); `Customer` has `first_name`/`last_name` (no `name` column — derive display name).
- Return requires a prior DISPATCHED scan event; duplicate non-closed returns blocked.
- Auth required on all return/timeline routes via existing `get_current_user`; scan writes require role ADMIN or WAREHOUSE (403 otherwise).
- Never commit `.env`; no new env keys.
- Backend tests run with workdir `backend/`; frontend `jsx: preserve` (Next-managed) so JSX files in vitest graph need `import React`.

---

### Task 1: Returns + return_items + audit_logs models + migration

**Files:**
- Create: `backend/app/models/return_record.py`, `backend/app/models/audit_log.py`, `backend/alembic/versions/0003_sprint3.py`, `backend/tests/test_return_models.py`
- Modify: `backend/app/models/__init__.py` (export new models), `backend/alembic/env.py` (add imports only if models not auto-imported — verify first)

**Interfaces:**
- Consumes: `Base`, `uuidpk`, `Session`
- Produces: `ReturnRecord`, `ReturnItem`, `AuditLog` models; `log_audit(db, business_id, user_id, entity_type, entity_id, action, old_data=None, new_data=None) -> AuditLog`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_return_models.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event
import app.models.return_record, app.models.audit_log

def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()

def test_audit_append():
    from app.models.business import Business
    from app.services.audit_service import log_audit
    db = _db()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    a = log_audit(db, b.id, None, "order", "oid-1", "TEST_ACTION", {"s": "NEW"}, {"s": "DISPATCHED"})
    assert a.id is not None
    assert a.action == "TEST_ACTION"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_return_models.py -v`
Expected: FAIL with "No module named app.services.audit_service"

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/models/return_record.py
from sqlalchemy import ForeignKey, String, Integer, DateTime, func, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class ReturnRecord(Base):
    __tablename__ = "returns"
    __table_args__ = (
        Index("ix_returns_order", "order_id"),
        Index("ix_returns_parcel", "parcel_id"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    return_type: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(32), nullable=True)
    received_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    inspected_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="RECEIVED")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))

class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_return_item_qty"),
        Index("ix_return_items_return", "return_id"),
    )
    id: Mapped[str] = uuidpk()
    return_id: Mapped[str] = mapped_column(ForeignKey("returns.id"))
    order_item_id: Mapped[str] = mapped_column(ForeignKey("order_items.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    condition: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

```python
# backend/app/models/audit_log.py
from sqlalchemy import ForeignKey, String, DateTime, func, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_biz_created", "business_id", "created_at"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(64))
    old_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

```python
# backend/app/services/audit_service.py
from sqlalchemy.orm import Session

def log_audit(db: Session, business_id: str, user_id: str | None, entity_type: str,
              entity_id: str, action: str, old_data: dict | None = None,
              new_data: dict | None = None):
    from app.models.audit_log import AuditLog
    a = AuditLog(business_id=business_id, user_id=user_id, entity_type=entity_type,
                 entity_id=entity_id, action=action, old_data=old_data, new_data=new_data)
    db.add(a)
    db.flush()
    return a
```

```python
# backend/alembic/versions/0003_sprint3.py
"""sprint3 returns + audit_logs"""
from alembic import op
import sqlalchemy as sa
revision = "0003_sprint3"
down_revision = "0002_sprint2"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("returns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("return_type", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("condition", sa.String(32), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), server_default="RECEIVED", nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_returns_order", "returns", ["order_id"])
    op.create_index("ix_returns_parcel", "returns", ["parcel_id"])
    op.create_table("return_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("return_id", sa.String(36), sa.ForeignKey("returns.id"), nullable=False),
        sa.Column("order_item_id", sa.String(36), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("condition", sa.String(32), nullable=True),
        sa.CheckConstraint("quantity >= 0", name="ck_return_item_qty"))
    op.create_index("ix_return_items_return", "return_items", ["return_id"])
    op.create_table("audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("old_data", sa.JSON(), nullable=True),
        sa.Column("new_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_audit_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_biz_created", "audit_logs", ["business_id", "created_at"])

def downgrade():
    op.drop_index("ix_audit_biz_created", table_name="audit_logs")
    op.drop_index("ix_audit_entity", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_return_items_return", table_name="return_items")
    op.drop_table("return_items")
    op.drop_index("ix_returns_parcel", table_name="returns")
    op.drop_index("ix_returns_order", table_name="returns")
    op.drop_table("returns")
```

Note: model file is `return_record.py` (class `ReturnRecord`) because `return` is a Python keyword — table stays `returns`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_return_models.py -v`
Expected: PASS. Then `python -m pytest tests -q` — all green (21 passed).

- [ ] **Step 5: Verify migration SQL renders**

Run: `alembic upgrade head --sql | Select-String "CREATE TABLE returns" -Context 0,1`
Expected: returns + return_items + audit_logs DDL present.

---

### Task 2: Return/RTO scan API (transactional, partial qty)

**Files:**
- Create: `backend/app/services/return_service.py`, `backend/app/api/returns.py`, `backend/tests/test_returns.py`
- Modify: `backend/app/api/scanning.py` (add `POST /return` route using return_service), `backend/app/main.py` (mount returns router), `backend/app/services/scanning_service.py` (write `DISPATCH_OVERRIDE` audit when override used — 6 lines)

**Interfaces:**
- Consumes: `ReturnRecord`, `ReturnItem`, `ScanEvent`, `log_audit`, `get_current_user`, `ScanError` (reuse from scanning_service)
- Produces: `record_return(db, business_id, barcode, user_id, return_type, condition, reason=None, device_id=None, items=None) -> dict`; `POST /api/v1/scan/return`; `GET /api/v1/returns`; `GET /api/v1/returns/{id}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_returns.py (fixtures first)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel
import app.models.scan_event, app.models.return_record, app.models.audit_log

def _mk():
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order, OrderItem
    from app.services.auth_service import hash_password
    from app.services.barcode_service import ensure_parcel_for_order
    from app.services.scanning_service import dispatch_parcel
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u); db.commit(); db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-R1", shopify_order_id="gid://r1",
              shopify_order_name="#R1", currency="INR", subtotal_amount=300.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=300.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    i = OrderItem(business_id=b.id, order_id=o.id, title="Shoes", sku="SH-1", quantity=3, price=100.0)
    db.add(i); db.commit(); db.refresh(i)
    p = ensure_parcel_for_order(db, o.id)
    dispatch_parcel(db, b.id, p.barcode_value, u.id)
    return db, b, u, o, i, p

def test_full_return():
    from app.services.return_service import record_return
    from app.models.scan_event import ScanEvent
    from app.models.audit_log import AuditLog
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert out["return"]["status"] == "RECEIVED"
    assert out["parcel"]["status"] == "RETURN_RECEIVED"
    assert out["order"]["operational_status"] == "RETURN_RECEIVED"
    assert len(out["items"]) == 1 and out["items"][0]["quantity"] == 3
    assert db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="RETURN_RECEIVED").count() == 1
    assert db.query(AuditLog).filter_by(entity_type="parcel", entity_id=p.id, action="RETURN_RECORDED").count() == 1

def test_partial_return():
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "PARTIAL_RETURN", "GOOD",
                        items=[{"order_item_id": i.id, "quantity": 2}])
    assert out["items"][0]["quantity"] == 2

def test_over_qty_rejected():
    from app.services.return_service import record_return, ReturnError
    import pytest
    db, b, u, o, i, p = _mk()
    with pytest.raises(ReturnError) as e:
        record_return(db, b.id, p.barcode_value, u.id, "PARTIAL_RETURN", "GOOD",
                      items=[{"order_item_id": i.id, "quantity": 5}])
    assert e.value.code == "RETURN_QUANTITY_MISMATCH"

def test_duplicate_blocked():
    from app.services.return_service import record_return, ReturnError
    import pytest
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    with pytest.raises(ReturnError) as e:
        record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert e.value.code == "RETURN_ALREADY_RECORDED"

def test_rto_sets_rto_status():
    from app.services.return_service import record_return
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "RTO", "USED")
    assert out["order"]["operational_status"] == "RTO"
    assert db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="RTO_RECEIVED").count() == 1
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_returns.py -v`
Expected: FAIL "No module named app.services.return_service"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/return_service.py
from app.services.scanning_service import ScanError as ReturnError

VALID_TYPES = ("CUSTOMER_RETURN", "RTO", "PARTIAL_RETURN")
VALID_CONDITIONS = ("GOOD", "DAMAGED", "USED", "WRONG_PRODUCT", "MISSING_ITEM")

def record_return(db, business_id: str, barcode: str, user_id: str, return_type: str,
                  condition: str | None, reason: str | None = None, device_id=None,
                  items: list[dict] | None = None) -> dict:
    from sqlalchemy import select
    from app.models.parcel import Parcel
    from app.models.order import Order, OrderItem
    from app.models.scan_event import ScanEvent
    from app.models.return_record import ReturnRecord, ReturnItem
    from app.models.user import User
    from app.services.audit_service import log_audit
    if return_type not in VALID_TYPES:
        raise ReturnError("INVALID_RETURN_ITEM", f"Unknown return_type {return_type}.", 400)
    if condition is not None and condition not in VALID_CONDITIONS:
        raise ReturnError("INVALID_RETURN_ITEM", f"Unknown condition {condition}.", 400)
    u = db.query(User).filter_by(id=user_id).first()
    if u is None or not u.is_active:
        raise ReturnError("USER_NOT_AUTHORIZED", "User is inactive or unknown.", 403)
    with db.begin_nested():
        p = db.execute(select(Parcel).where(
            Parcel.business_id == business_id,
            Parcel.barcode_value == barcode).with_for_update()).scalar_one_or_none()
        if p is None:
            raise ReturnError("INVALID_BARCODE", f"No parcel found for barcode {barcode}.", 404)
        o = db.query(Order).filter_by(id=p.order_id).first()
        if o is None:
            raise ReturnError("INVALID_BARCODE", "Parcel has no order.", 404)
        if db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="DISPATCHED").count() == 0:
            raise ReturnError("RETURN_WITHOUT_DISPATCH", "Parcel was never dispatched; cannot record return.", 400)
        if db.query(ReturnRecord).filter_by(parcel_id=p.id).filter(ReturnRecord.status != "CLOSED").count() > 0:
            raise ReturnError("RETURN_ALREADY_RECORDED", "A return is already recorded for this parcel.", 400)
        oitems = db.query(OrderItem).filter_by(order_id=o.id).all()
        by_id = {i.id: i for i in oitems}
        wanted = items if items is not None else [{"order_item_id": i.id, "quantity": i.quantity} for i in oitems]
        for w in wanted:
            oi = by_id.get(w["order_item_id"])
            if oi is None:
                raise ReturnError("INVALID_RETURN_ITEM", "Return item does not belong to this order.", 400)
            if int(w["quantity"]) < 0 or int(w["quantity"]) > oi.quantity:
                raise ReturnError("RETURN_QUANTITY_MISMATCH",
                                  f"Return qty {w['quantity']} exceeds ordered {oi.quantity} for {oi.title}.", 400)
        old_p, old_o = p.status, o.operational_status
        ret = ReturnRecord(business_id=business_id, order_id=o.id, parcel_id=p.id,
                           return_type=return_type, reason=reason, condition=condition,
                           status="RECEIVED", created_by=user_id)
        db.add(ret); db.flush()
        rows = []
        for w in wanted:
            ri = ReturnItem(return_id=ret.id, order_item_id=w["order_item_id"],
                            quantity=int(w["quantity"]), condition=condition)
            db.add(ri); db.flush()
            rows.append({"order_item_id": ri.order_item_id, "quantity": ri.quantity})
        ev = "RTO_RECEIVED" if return_type == "RTO" else "RETURN_RECEIVED"
        db.add(ScanEvent(business_id=business_id, parcel_id=p.id, order_id=o.id,
                         event_type=ev, performed_by=user_id, device_id=device_id))
        p.status = "RETURN_RECEIVED"
        o.operational_status = "RTO" if return_type == "RTO" else "RETURN_RECEIVED"
        log_audit(db, business_id, user_id, "parcel", p.id, "RETURN_RECORDED",
                  {"parcel": old_p, "order": old_o},
                  {"parcel": p.status, "order": o.operational_status, "return_id": ret.id})
    db.commit()
    db.refresh(ret); db.refresh(p); db.refresh(o)
    return {"return": {"id": ret.id, "return_type": ret.return_type, "status": ret.status},
            "items": rows,
            "parcel": {"id": p.id, "barcode_value": p.barcode_value, "status": p.status},
            "order": {"id": o.id, "shopify_order_name": o.shopify_order_name,
                      "operational_status": o.operational_status}}
```

```python
# backend/app/api/returns.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/returns", tags=["returns"])

@router.get("")
def list_returns(order_id: str | None = None, status: str | None = None,
                 page: int = 1, page_size: int = 20,
                 db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.return_record import ReturnRecord
    q = db.query(ReturnRecord).filter_by(business_id=u.get("business_id"))
    if order_id: q = q.filter_by(order_id=order_id)
    if status: q = q.filter_by(status=status)
    total = q.count()
    rows = q.offset((max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    return {"success": True, "data": {"items": [
        {"id": r.id, "order_id": r.order_id, "parcel_id": r.parcel_id, "return_type": r.return_type,
         "condition": r.condition, "status": r.status} for r in rows], "total": total, "page": max(int(page or 1), 1)}}

@router.get("/{return_id}")
def get_return(return_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.return_record import ReturnRecord, ReturnItem
    r = db.query(ReturnRecord).filter_by(id=return_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Return not found")
    items = db.query(ReturnItem).filter_by(return_id=r.id).all()
    return {"success": True, "data": {"id": r.id, "order_id": r.order_id, "return_type": r.return_type,
        "condition": r.condition, "reason": r.reason, "status": r.status,
        "items": [{"order_item_id": i.order_item_id, "quantity": i.quantity} for i in items]}}
```

Scanning route addition in `backend/app/api/scanning.py`:
```python
class ReturnIn(BaseModel):
    barcode: str
    return_type: str = "CUSTOMER_RETURN"
    condition: str | None = None
    reason: str | None = None
    device_id: str | None = None
    items: list[dict] | None = None

@router.post("/return")
def scan_return(body: ReturnIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.return_service import record_return
    from app.services.scanning_service import ScanError
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    try:
        out = record_return(db, u.get("business_id"), body.barcode.strip(), u.get("user_id"),
                            body.return_type, body.condition, body.reason, body.device_id, body.items)
    except ScanError as e:
        raise HTTPException(e.status, e.message, headers={"X-Error-Code": e.code})
    return {"success": True, "data": out}
```

Dispatch override audit — append inside `dispatch_parcel` after the override check passes (before `db.add(ScanEvent...)`):
```python
        if override:
            from app.services.audit_service import log_audit
            log_audit(db, business_id, user_id, "parcel", p.id, "DISPATCH_OVERRIDE",
                      {"financial_status": o.financial_status}, {"reason": reason})
```

Mount in `main.py`: `from app.api.returns import router as returns_router; app.include_router(returns_router)`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_returns.py -v`
Expected: PASS (5 passed). Then `python -m pytest tests -q` — all green.

- [ ] **Step 5: Manual API check**

Via `/docs`: login → dispatch a parcel → `POST /scan/return` → verify statuses + second return blocked.

---

### Task 3: Return scanner UI

**Files:**
- Create: `frontend/app/scan/return/page.tsx`, `frontend/tests/return.test.tsx`
- Modify: none (backend untouched)

**Interfaces:**
- Consumes: `api()` + `ScanBanner` + `GET /api/v1/parcels/{barcode}` + `POST /api/v1/scan/dispatch`-style return endpoint
- Produces: return workstation page

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/return.test.tsx
import React from "react";
import { expect, test } from "vitest";
import { CONDITIONS, RETURN_TYPES } from "../app/scan/return/page";
test("return options match plan", () => {
  expect(RETURN_TYPES).toEqual(["CUSTOMER_RETURN", "RTO"]);
  expect(CONDITIONS).toContain("MISSING_ITEM");
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- return.test`
Expected: FAIL "Cannot find module ../app/scan/return/page"

- [ ] **Step 3: Minimal page**

```tsx
// frontend/app/scan/return/page.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import ScanBanner from "../../../components/ScanBanner";

export const RETURN_TYPES = ["CUSTOMER_RETURN", "RTO"];
export const CONDITIONS = ["GOOD", "DAMAGED", "USED", "WRONG_PRODUCT", "MISSING_ITEM"];

type Info = { parcel: any; order: any; customer: any } | null;
export default function ReturnPage() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info>(null);
  const [rtype, setRtype] = useState("CUSTOMER_RETURN");
  const [cond, setCond] = useState("GOOD");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    if (!barcode) return;
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const data = await api<Info>(`/api/v1/parcels/${barcode}`, {}, token);
      setInfo(data);
      setMsg(null);
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Lookup failed" });
    }
  }
  async function confirm() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const out = await api<any>(`/api/v1/scan/return`,
        { method: "POST", body: JSON.stringify({ barcode: code.trim(), return_type: rtype, condition: cond, reason: reason || undefined }) }, token);
      setMsg({ kind: "ok", text: `Return recorded for ${out.order.shopify_order_name}` });
      setInfo(null); setCode(""); setReason("");
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message ?? "Return failed" });
    } finally {
      ref.current?.focus();
    }
  }
  return (
    <main>
      <h1>Scan return</h1>
      <form onSubmit={lookup}>
        <input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan barcode" aria-label="Parcel barcode" style={{ fontSize: 24 }} />
        <button type="submit">Lookup</button>
      </form>
      {info && (
        <section>
          <p>Order: {info.order?.shopify_order_name} Total: {info.order?.total_amount}</p>
          <p>Customer: {info.customer ? `${info.customer.first_name ?? ""} ${info.customer.last_name ?? ""}` : "-"}</p>
          <div>{RETURN_TYPES.map((t) => <button key={t} type="button" onClick={() => setRtype(t)} aria-pressed={rtype === t}>{t}</button>)}</div>
          <div>{CONDITIONS.map((c) => <button key={c} type="button" onClick={() => setCond(c)} aria-pressed={cond === c}>{c}</button>)}</div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" />
          <button type="button" onClick={confirm}>Confirm return</button>
        </section>
      )}
      {msg && <ScanBanner kind={msg.kind} text={msg.text} />}
    </main>
  );
}
```

Note: customer lookup returns `{name,email,phone}`? Backend `parcels.py` lookup returns `cust` built from Customer — verify actual key names when implementing (first_name/last_name vs name) and render defensively as above.

- [ ] **Step 4: Verify**

Run: `npm test -- return.test`
Expected: PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual flow**

Dev server: scan dispatched parcel → card appears → RTO + DAMAGED → confirm → success banner.

---

### Task 4: Timeline service + order detail UI + audit API

**Files:**
- Create: `backend/app/services/timeline_service.py`, `backend/app/api/audit.py`, `frontend/components/Timeline.tsx`, `frontend/tests/timeline.test.tsx`
- Modify: `backend/app/api/orders.py` (add `GET /{order_id}/timeline`), `backend/app/main.py` (mount audit router), `frontend/app/orders/[id]/page.tsx` (add timeline section)

**Interfaces:**
- Consumes: Order, ScanEvent, AuditLog rows
- Produces: `build_timeline(db, business_id, order_id) -> list[dict{at, kind, label, detail}]`; `GET /api/v1/orders/{id}/timeline`; `GET /api/v1/audit?entity_type=&entity_id=`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timeline.py
def test_timeline_ordered():
    from app.services.timeline_service import build_timeline
    import app.models.return_record  # noqa
    from test_returns import _mk
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    tl = build_timeline(db, b.id, o.id)
    kinds = [n["kind"] for n in tl]
    assert kinds[0] == "CREATED"
    assert "DISPATCHED" in kinds and "RETURN" in kinds
    assert kinds.index("DISPATCHED") < kinds.index("RETURN")
    assert any(n["kind"] == "AUDIT" for n in tl)
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_timeline.py -v`
Expected: FAIL "No module named app.services.timeline_service"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/timeline_service.py
def build_timeline(db, business_id: str, order_id: str) -> list[dict]:
    from app.models.order import Order
    from app.models.scan_event import ScanEvent
    from app.models.audit_log import AuditLog
    o = db.query(Order).filter_by(id=order_id, business_id=business_id).first()
    if o is None:
        return []
    nodes: list[dict] = []
    nodes.append({"at": o.order_date.isoformat() if o.order_date else None, "kind": "CREATED",
                  "label": f"Order {o.shopify_order_name} created", "detail": None})
    nodes.append({"at": None, "kind": "PAYMENT", "label": f"Payment {o.financial_status}", "detail": None})
    evs = db.query(ScanEvent).filter_by(order_id=o.id, business_id=business_id).order_by(ScanEvent.created_at).all()
    for e in evs:
        at = e.created_at.isoformat() if e.created_at else None
        if e.event_type == "DISPATCHED":
            nodes.append({"at": at, "kind": "DISPATCHED", "label": "Dispatched", "detail": None})
        elif e.event_type in ("RETURN_RECEIVED", "RTO_RECEIVED"):
            nodes.append({"at": at, "kind": "RETURN", "label": "Return received" if e.event_type == "RETURN_RECEIVED" else "RTO received", "detail": None})
        else:
            nodes.append({"at": at, "kind": e.event_type, "label": e.event_type, "detail": None})
    for a in db.query(AuditLog).filter_by(business_id=business_id).all():
        nodes.append({"at": a.created_at.isoformat() if a.created_at else None, "kind": "AUDIT",
                      "label": f"{a.action} on {a.entity_type}", "detail": a.entity_id})
    return nodes
```

Orders route addition:
```python
@router.get("/{order_id}/timeline")
def get_timeline(order_id: str, db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    from app.services.timeline_service import build_timeline
    return {"success": True, "data": {"items": build_timeline(db, _u.get("business_id"), order_id)}}
```

```python
# backend/app/api/audit.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])

@router.get("")
def list_audit(entity_type: str | None = None, entity_id: str | None = None,
               db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.audit_log import AuditLog
    q = db.query(AuditLog).filter_by(business_id=u.get("business_id")).order_by(AuditLog.created_at.desc())
    if entity_type: q = q.filter_by(entity_type=entity_type)
    if entity_id: q = q.filter_by(entity_id=entity_id)
    rows = q.limit(100).all()
    return {"success": True, "data": {"items": [
        {"id": a.id, "entity_type": a.entity_type, "entity_id": a.entity_id, "action": a.action,
         "old_data": a.old_data, "new_data": a.new_data} for a in rows]}}
```

```tsx
// frontend/components/Timeline.tsx
import React from "react";
export type TNode = { at: string | null; kind: string; label: string; detail: string | null };
export default function Timeline({ items }: { items: TNode[] }) {
  return (
    <ol>
      {items.map((n, ix) => (
        <li key={ix}>{n.kind === "RETURN" || n.kind === "AUDIT" ? "○" : "●"} {n.label}{n.at ? ` — ${n.at}` : ""}</li>
      ))}
    </ol>
  );
}
```

Order detail edit: fetch `api('/api/v1/orders/'+id+'/timeline', {}, token)` and render `<Timeline items={...} />` below existing sections.

```tsx
// frontend/tests/timeline.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Timeline from "../components/Timeline";
test("timeline renders nodes", () => {
  render(<Timeline items={[{ at: null, kind: "DISPATCHED", label: "Dispatched", detail: null }]} />);
  expect(screen.getByText(/Dispatched/)).toBeDefined();
});
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_timeline.py -v` → PASS; `npm test -- timeline.test` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual check**

Order detail page shows ● created → dispatched → ○ return + audit entries.

---

### Task 5: Regression + docs

**Files:**
- Modify: `README.md` (append Sprint 3 section)

**Interfaces:**
- Consumes: full suite
- Produces: green build + docs

- [ ] **Step 1: Full backend regression**

Run: `python -m pytest tests -v`
Expected: 20 existing + 1 models + 5 returns + 1 timeline = 27 passed. (Exact new count may vary if implementer adds route-level tests — assert zero failures, not exact count.)

- [ ] **Step 2: Full frontend checks**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: clean + all suites pass (orders, scan, return, timeline).

- [ ] **Step 3: Live migration check**

Run: `alembic upgrade head` against dev Postgres (already has 0001+0002), then `\dt` shows `returns`, `return_items`, `audit_logs`.
Expected: 3 new tables present.

- [ ] **Step 4: Docs**

Append to `README.md`:
```md
## Sprint 3 — Returns
- Scan: `POST /api/v1/scan/return {barcode, return_type, condition, reason?, items?}` (WAREHOUSE/ADMIN). Types CUSTOMER_RETURN/RTO/PARTIAL_RETURN; conditions GOOD/DAMAGED/USED/WRONG_PRODUCT/MISSING_ITEM.
- Omitted items = full-order return. Over-qty → RETURN_QUANTITY_MISMATCH; undispatched → RETURN_WITHOUT_DISPATCH; duplicate → RETURN_ALREADY_RECORDED.
- Lists: `GET /api/v1/returns`, detail `GET /api/v1/returns/{id}`.
- Timeline: `GET /api/v1/orders/{id}/timeline`; audit debug: `GET /api/v1/audit?entity_type=&entity_id=`.
- UI: `/scan/return` workstation; order detail timeline section.
- Alembic: `alembic upgrade head` adds returns + return_items + audit_logs.
```

- [ ] **Step 5: Manual end-to-end (document results)**

Dispatch parcel → return it via UI → timeline shows RETURN → audit row exists via `/api/v1/audit?entity_type=parcel`.
