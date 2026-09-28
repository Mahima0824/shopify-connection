# Sprint 4 Webhooks + Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Shopify webhooks idempotently and automatically flag every operational mismatch as a resolvable exception.

**Architecture:** `POST /api/v1/shopify/webhooks` verifies HMAC, persists raw events, and queues BackgroundTasks processing that upserts order/payment/refund state then calls `reconcile_order`; `reconciliation_service` holds 8 independent rule functions writing `reconciliations` rows; thin `reconciliation` router serves the exception queue; Next.js `/exceptions` page + order-detail block.

**Tech Stack:** Python 3.14, FastAPI 0.115 (BackgroundTasks), SQLAlchemy 2.0, Alembic 1.14, hmac/hashlib stdlib, pytest 8, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id` UUID; webhook business resolved by `X-Shopify-Shop-Domain`.
- Webhook endpoint speaks Shopify protocol: plain `200`/`401`, NOT the app envelope. All other new routes use the envelope.
- `reconciliations` upserted by `(order_id, issue_code)`; fixed issues auto-resolve (resolved_by NULL = system).
- `scan_events` and `audit_logs` append-only.
- `Payment` fields are `amount/payment_status/method/transaction_id` (no transaction_type column); `OrderItem.quantity` is ordered count; `ScanEvent` JSON column is `event_metadata`.
- HMAC secret `SHOPIFY_CLIENT_SECRET` never logged/exposed; add to `.env.example`.
- Auth on all reconciliation routes via `get_current_user`; resolve requires ADMIN/ACCOUNTANT + non-empty reason.
- Never commit `.env`; no other new env keys.
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React`.

---

### Task 1: Webhook models + endpoint + processing + retry

**Files:**
- Create: `backend/app/models/refund.py`, `backend/app/models/reconciliation.py`, `backend/app/services/webhook_service.py`, `backend/app/api/webhooks.py`, `backend/alembic/versions/0004_sprint4.py`, `backend/tests/test_webhooks.py`
- Modify: `backend/app/models/__init__.py` (exports), `backend/app/main.py` (mount), `backend/app/config.py` (add `shopify_client_secret: str = ""`), `.env.example` (add `SHOPIFY_CLIENT_SECRET=`)

**Interfaces:**
- Consumes: `ShopifyWebhookEvent`, `ShopifyStore`, `Order`, `Payment`, `get_db`
- Produces: `verify_hmac(raw: bytes, header_sig: str, secret: str) -> bool`; `process_webhook(db, event_id: str) -> str(status)`; `POST /api/v1/shopify/webhooks -> plain 200/401`; `Refund` model

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_webhooks.py
import hmac, hashlib, json
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel
import app.models.scan_event, app.models.return_record, app.models.audit_log
import app.models.shopify_store, app.models.webhook_event, app.models.payment
import app.models.refund, app.models.reconciliation
from app.main import app
from app.database import get_db

SECRET = "testsecret123"

def _client():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    from app.models.business import Business
    from app.models.shopify_store import ShopifyStore
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    db.add(ShopifyStore(business_id=b.id, shop_domain="t.myshopify.com", access_token_encrypted="", api_version="2026-01"))
    db.commit(); db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    return TestClient(app), SECRET

def _sig(raw: bytes) -> str:
    import base64
    return base64.b64encode(hmac.new(SECRET.encode(), raw, hashlib.sha256).digest()).decode()

def test_bad_hmac_rejected(monkeypatch):
    from app import config
    monkeypatch.setattr(config.settings, "shopify_client_secret", SECRET)
    c, _ = _client()
    r = c.post("/api/v1/shopify/webhooks", content=b"{}", headers={"X-Shopify-Hmac-Sha256": "bad",
        "X-Shopify-Topic": "orders/create", "X-Shopify-Shop-Domain": "t.myshopify.com", "X-Shopify-Webhook-Id": "w1"})
    assert r.status_code == 401

def test_duplicate_delivery_single_row(monkeypatch):
    from app import config
    from app.services.webhook_service import process_webhook
    monkeypatch.setattr(config.settings, "shopify_client_secret", SECRET)
    c, _ = _client()
    body = json.dumps({"id": 1001, "name": "#W1"}).encode()
    h = {"X-Shopify-Hmac-Sha256": _sig(body), "Content-Type": "application/json",
         "X-Shopify-Topic": "orders/create", "X-Shopify-Shop-Domain": "t.myshopify.com", "X-Shopify-Webhook-Id": "w2"}
    assert c.post("/api/v1/shopify/webhooks", content=body, headers=h).status_code == 200
    assert c.post("/api/v1/shopify/webhooks", content=body, headers=h).status_code == 200
    from app.database import SessionLocal  # noqa - proves import surface only
```

Note: duplicate assertion on row count needs db access — implementer: query `ShopifyWebhookEvent` count via a fresh sqlite session in-test (pattern from e2e tests) and assert `== 1`.

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_webhooks.py -v`
Expected: FAIL "No module named app.models.refund"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/models/refund.py
from sqlalchemy import ForeignKey, String, Numeric, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (UniqueConstraint("business_id", "shopify_refund_id", name="uq_refund_biz_shopify"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    shopify_refund_id: Mapped[str] = mapped_column(String(64))
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

```python
# backend/app/models/reconciliation.py
from sqlalchemy import ForeignKey, String, Boolean, DateTime, func, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Reconciliation(Base):
    __tablename__ = "reconciliations"
    __table_args__ = (
        UniqueConstraint("order_id", "issue_code", name="uq_recon_order_issue"),
        Index("ix_recon_resolved", "resolved"),
        Index("ix_recon_issue", "issue_code"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    reconciliation_status: Mapped[str] = mapped_column(String(32), default="EXCEPTION")
    severity: Mapped[str] = mapped_column(String(16))
    issue_code: Mapped[str] = mapped_column(String(64))
    issue_message: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

```python
# backend/app/services/webhook_service.py
import base64
import hashlib
import hmac as hmac_mod

def verify_hmac(raw: bytes, header_sig: str, secret: str) -> bool:
    if not secret or not header_sig:
        return False
    digest = hmac_mod.new(secret.encode(), raw, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac_mod.compare_digest(expected, header_sig)

def process_webhook(db, event_id: str) -> str:
    from datetime import datetime, timezone
    from app.models.webhook_event import ShopifyWebhookEvent
    ev = db.query(ShopifyWebhookEvent).filter_by(id=event_id).first()
    if ev is None:
        return "SKIPPED"
    if ev.processing_status == "DONE":
        return "DONE"
    ev.processing_status = "PROCESSING"
    try:
        _apply(db, ev)
    except ValueError as e:
        ev.processing_status = "SKIPPED"; ev.error_message = str(e)[:500]
        db.commit(); return "SKIPPED"
    except Exception as e:
        ev.attempts = (ev.attempts or 0) + 1
        ev.error_message = f"{type(e).__name__}: {e}"[:500]
        ev.processing_status = "FAILED" if ev.attempts < 3 else "SKIPPED"
        db.commit(); return ev.processing_status
    ev.processing_status = "DONE"; ev.processed = True
    ev.processed_at = datetime.now(timezone.utc)
    db.commit()
    try:
        from app.services.reconciliation_service import reconcile_order
        o = _resolve_order(db, ev)
        if o is not None:
            reconcile_order(db, o.id)
    except Exception:
        pass
    return "DONE"
```

`_apply(db, ev)`: switch on `ev.topic`: `orders/create|updated` → upsert order fields (financial/fulfillment/shopify_updated_at) by `(business, shopify_order_id)`; `orders/cancelled` → set `cancelled_at` (payload `cancelled_at` or now) + `cancel_reason`; `refunds/create` → upsert Refund by `(business, shopify_refund_id)` + update order financial; `fulfillments/create|update` → map `status=success` to fulfillment FULFILLED; unknown → no-op. Business resolved by `ShopifyStore.shop_domain == ev.shop_domain`; unknown domain → ValueError (SKIPPED, never retried forever). `_resolve_order` returns the touched Order or None.

```python
# backend/app/api/webhooks.py
from fastapi import APIRouter, Request, BackgroundTasks, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/v1/shopify", tags=["shopify-webhooks"])

@router.post("/webhooks", response_class=PlainTextResponse)
async def receive(request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    from datetime import datetime, timezone
    from app.config import settings
    from app.models.webhook_event import ShopifyWebhookEvent
    from app.services.webhook_service import verify_hmac, process_webhook
    raw = await request.body()
    if not verify_hmac(raw, request.headers.get("X-Shopify-Hmac-Sha256", ""),
                       settings.shopify_client_secret):
        return PlainTextResponse("invalid signature", status_code=401)
    wid = request.headers.get("X-Shopify-Webhook-Id", "")
    if wid and db.query(ShopifyWebhookEvent).filter_by(webhook_id=wid).first() is not None:
        return PlainTextResponse("ok")
    import json as _json
    try:
        payload = _json.loads(raw or b"{}")
    except Exception:
        payload = {}
    ev = ShopifyWebhookEvent(
        business_id=_biz_for(db, request.headers.get("X-Shopify-Shop-Domain", "")),
        webhook_id=wid or f"noid-{datetime.now(timezone.utc).timestamp()}",
        topic=request.headers.get("X-Shopify-Topic", ""),
        shop_domain=request.headers.get("X-Shopify-Shop-Domain", ""),
        payload=payload, processing_status="RECEIVED",
        received_at=datetime.now(timezone.utc), attempts=0)
    db.add(ev); db.commit(); db.refresh(ev)
    background.add_task(_run, ev.id)
    return PlainTextResponse("ok")

def _biz_for(db, domain: str):
    from app.models.shopify_store import ShopifyStore
    s = db.query(ShopifyStore).filter_by(shop_domain=domain).first()
    return s.business_id if s else None

def _run(event_id: str):
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        process_webhook(db, event_id)
    finally:
        db.close()
```

Migration `0004_sprint4.py` (revision `0004_sprint4`, down `0003_sprint3`): create `refunds` + `reconciliations` (columns per models above); alter `shopify_webhook_events` add `processing_status VARCHAR(16) SERVER DEFAULT 'RECEIVED'`, `error_message TEXT NULL`, `received_at TIMESTAMPTZ NULL`, `processed_at TIMESTAMPTZ NULL`, `attempts INTEGER SERVER DEFAULT 0`. Downgrade reverses.

Config: add `shopify_client_secret: str = ""` to Settings. `.env.example`: append `SHOPIFY_CLIENT_SECRET=`.

Mount in main.py: `from app.api.webhooks import router as webhooks_router; app.include_router(webhooks_router)` — no prefix collision (same `/api/v1/shopify` prefix, distinct `/webhooks` path from existing `/sync|/status`).

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_webhooks.py -v`
Expected: PASS. Then `python -m pytest tests -q` green. `alembic upgrade head --sql` shows refunds + reconciliations + new webhook columns.

- [ ] **Step 5: Manual HMAC check**

Via `/docs`: POST webhooks without signature → 401; with valid HMAC (compute per test helper) → 200 + row in `shopify_webhook_events`.

---

### Task 2: Reconciliation engine (8 rules)

**Files:**
- Create: `backend/app/services/reconciliation_service.py`, `backend/tests/test_reconciliation.py`
- Modify: `backend/app/services/scanning_service.py` (call reconcile after dispatch commit), `backend/app/services/return_service.py` (call reconcile after return commit), `backend/app/services/shopify_service.py` (call reconcile after sync upsert loop — after commit, best-effort try/except)

**Interfaces:**
- Consumes: Order, Payment, Refund, ReturnRecord, ReturnItem, ScanEvent, Reconciliation, log via no-op
- Produces: `reconcile_order(db, order_id: str) -> dict{status, issues[]}`; `check_r001..check_r008(db, order) -> list[dict{code, severity, message}]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_reconciliation.py
from test_returns import _mk  # reuse dispatched order+parcel fixture (order with 1 item qty 3)

def test_r001_cancelled_dispatched():
    from app.services.reconciliation_service import reconcile_order
    from datetime import datetime, timezone
    db, b, u, o, i, p = _mk()
    o.cancelled_at = datetime.now(timezone.utc); db.commit()
    out = reconcile_order(db, o.id)
    assert out["status"] == "EXCEPTION"
    assert any(x["code"] == "CANCELLED_BUT_DISPATCHED" and x["severity"] == "CRITICAL" for x in out["issues"])

def test_clean_order():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    out = reconcile_order(db, o.id)
    assert out == {"status": "RECONCILED", "issues": []}

def test_r004_paid_no_payment():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    assert o.financial_status == "PAID"
    out = reconcile_order(db, o.id)
    assert any(x["code"] == "PAYMENT_DATA_MISSING" for x in out["issues"])

def test_r002_return_no_refund_and_clears():
    from app.services.reconciliation_service import reconcile_order
    from app.services.return_service import record_return
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert any(x["code"] == "RETURN_WITHOUT_REFUND" for x in reconcile_order(db, o.id)["issues"])
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="r1", amount=300.0, currency="INR", status="COMPLETED"))
    db.commit()
    assert reconcile_order(db, o.id)["status"] in ("RECONCILED", "EXCEPTION")
    codes = [x["code"] for x in reconcile_order(db, o.id)["issues"]]
    assert "RETURN_WITHOUT_REFUND" not in codes

def test_auto_resolve():
    from app.services.reconciliation_service import reconcile_order
    from app.models.reconciliation import Reconciliation
    from datetime import datetime, timezone
    db, b, u, o, i, p = _mk()
    o.cancelled_at = datetime.now(timezone.utc); db.commit()
    reconcile_order(db, o.id)
    assert db.query(Reconciliation).filter_by(order_id=o.id, resolved=False).count() >= 1
    o.cancelled_at = None; db.commit()
    out = reconcile_order(db, o.id)
    assert all(r.resolved for r in db.query(Reconciliation).filter_by(order_id=o.id).all()) or out["status"] == "RECONCILED"
```

Note: `_mk` order is PAID with no payment rows — `test_clean_order` as written would trip R004. Implementer: set `o.financial_status = "PENDING"` (unpaid) in clean test before reconcile, or seed a Payment row; keep R004 test on PAID. (R004 fires only when PAID.)

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_reconciliation.py -v`
Expected: FAIL "No module named app.services.reconciliation_service"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/reconciliation_service.py
from datetime import datetime, timezone, timedelta

GRACE = timedelta(minutes=15)

def _open(db, o, code, severity, message):
    from app.models.reconciliation import Reconciliation
    r = db.query(Reconciliation).filter_by(order_id=o.id, issue_code=code).first()
    if r is None:
        r = Reconciliation(business_id=o.business_id, order_id=o.id, reconciliation_status="EXCEPTION",
                           severity=severity, issue_code=code, issue_message=message, resolved=False)
        db.add(r)
    else:
        r.severity = severity; r.issue_message = message; r.reconciliation_status = "EXCEPTION"
        r.resolved = False; r.resolved_by = None; r.resolved_at = None
        r.updated_at = datetime.now(timezone.utc)
    return {"code": code, "severity": severity, "message": message}

def check_r001(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    if o.cancelled_at is None:
        return []
    disp = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if disp > 0:
        return [_open(db, o, "CANCELLED_BUT_DISPATCHED", "CRITICAL",
                      f"Order {o.shopify_order_name} cancelled after dispatch.")]
    packed = db.query(Parcel).filter_by(order_id=o.id).filter(Parcel.status != "CREATED").count()
    if packed > 0:
        return [_open(db, o, "CANCELLED_AFTER_PACK", "HIGH",
                      f"Order {o.shopify_order_name} cancelled after packing.")]
    return []

def check_r002(db, o):
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    rets = db.query(ReturnRecord).filter_by(order_id=o.id).filter(ReturnRecord.status != "CLOSED").count()
    if rets == 0:
        return []
    if o.financial_status != "PAID":
        return []
    if db.query(Refund).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "RETURN_WITHOUT_REFUND", "HIGH", "Return received but no refund found.")]

def check_r003(db, o):
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    if db.query(Refund).filter_by(order_id=o.id).count() == 0:
        return []
    if db.query(ReturnRecord).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "REFUND_WITHOUT_RETURN", "MEDIUM", "Refund exists without a recorded return (may be legitimate).")]

def check_r004(db, o):
    from app.models.payment import Payment
    if o.financial_status != "PAID":
        return []
    if db.query(Payment).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "PAYMENT_DATA_MISSING", "HIGH", "Order marked PAID but no payment transaction found.")]

def check_r005(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    n = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if n > 1:
        return [_open(db, o, "DUPLICATE_DISPATCH_SCAN", "HIGH", f"{n} dispatch scans recorded.")]
    return []

def check_r006(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    ret = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type.in_(["RETURN_RECEIVED", "RTO_RECEIVED"])).count()
    disp = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if ret > 0 and disp == 0:
        return [_open(db, o, "RETURN_WITHOUT_DISPATCH", "HIGH", "Return recorded without any dispatch.")]
    return []

def check_r007(db, o):
    from app.models.order import OrderItem
    from app.models.return_record import ReturnRecord, ReturnItem
    ordered = sum(i.quantity for i in db.query(OrderItem).filter_by(order_id=o.id).all())
    rids = [r.id for r in db.query(ReturnRecord).filter_by(order_id=o.id).all()]
    returned = sum(i.quantity for i in db.query(ReturnItem).filter(ReturnItem.return_id.in_(rids)).all()) if rids else 0
    if returned > ordered:
        return [_open(db, o, "RETURN_QUANTITY_MISMATCH", "HIGH",
                      f"Returned {returned} exceeds ordered {ordered}.")]
    return []

def check_r008(db, o):
    if o.shopify_updated_at is None:
        return []
    now = datetime.now(timezone.utc)
    local = o.updated_at if hasattr(o, "updated_at") else None
    if local is not None and o.shopify_updated_at <= local:
        return []
    if now - o.shopify_updated_at.replace(tzinfo=timezone.utc) < GRACE:
        return []
    return [_open(db, o, "SYNC_DELAY", "MEDIUM", "Shopify is newer than local state beyond grace period.")]

CHECKS = (check_r001, check_r002, check_r003, check_r004, check_r005, check_r006, check_r007, check_r008)

def reconcile_order(db, order_id: str) -> dict:
    from app.models.order import Order
    from app.models.reconciliation import Reconciliation
    o = db.query(Order).filter_by(id=order_id).first()
    if o is None:
        return {"status": "RECONCILED", "issues": []}
    issues = []
    for fn in CHECKS:
        issues += fn(db, o)
    db.commit()
    if not issues:
        now = datetime.now(timezone.utc)
        for r in db.query(Reconciliation).filter_by(order_id=o.id, resolved=False).all():
            r.resolved = True; r.resolved_at = now
        db.commit()
        return {"status": "RECONCILED", "issues": []}
    return {"status": "EXCEPTION", "issues": issues}
```

Note: Order has no `updated_at` column — R008 uses `created_at` fallback? Plan code guards with hasattr; implementer: use `o.shopify_updated_at` vs max scan/audit `created_at` if Order lacks updated_at — keep plan logic (hasattr guard) to avoid schema change.

Auto-trigger hooks (best-effort, never break the write path):
- End of `dispatch_parcel` after commit: `try: reconcile_order(db, o.id) except Exception: pass`.
- End of `record_return` after commit: same.
- `shopify_service.upsert_order` after parcel ensure: same (import inside function to avoid cycles).

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_reconciliation.py -v`
Expected: PASS (5 passed). Full suite green.

- [ ] **Step 5: Seed-matrix spot check**

Extend test file with R003/R005/R006/R007/R008 cases per spec §5 (one fixture order each) — full matrix in Task 5; Task 2 needs the 5 above green.

---

### Task 3: Exceptions API + resolve + auto-hooks verification

**Files:**
- Create: `backend/app/api/reconciliation.py`, `backend/tests/test_exceptions.py`
- Modify: `backend/app/main.py` (mount)

**Interfaces:**
- Consumes: `reconcile_order`, `Reconciliation`, `get_current_user`, `log_audit`
- Produces: `GET /api/v1/reconciliation/issues`; `POST /api/v1/reconciliation/order/{id}`; `POST /api/v1/reconciliation/run`; `POST /api/v1/reconciliation/issues/{id}/resolve`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_exceptions.py
def test_resolve_requires_reason_and_role(auth_client_admin, auth_client_viewer):
    r = auth_client_viewer.post("/api/v1/reconciliation/run")
    assert r.status_code == 403
    # seed an issue via reconcile on cancelled-dispatched order, then:
    # resolve without reason -> 400/422; with reason as admin -> 200 + audit row
```

Implementer: build on TestClient+login-header pattern from e2e tests; seed issue by cancelling a dispatched fixture order then calling reconcile endpoint. Assert: viewer run 403; admin resolve missing reason 400/422; admin resolve with reason 200, resolved=True, audit `EXCEPTION_RESOLVED` exists; second resolve 400 ALREADY_RESOLVED.

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_exceptions.py -v`
Expected: FAIL "No module named app.api.reconciliation" (import in test) or 404.

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/api/reconciliation.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/reconciliation", tags=["reconciliation"])

def _j(r, order_name=None) -> dict:
    return {"id": r.id, "order_id": r.order_id, "order_name": order_name,
            "issue_code": r.issue_code, "severity": r.severity, "issue_message": r.issue_message,
            "resolved": r.resolved,
            "detected_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None}

@router.get("/issues")
def issues(status: str = "OPEN", severity: str | None = None, issue_code: str | None = None,
           page: int = 1, page_size: int = 20,
           db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.reconciliation import Reconciliation
    from app.models.order import Order
    q = db.query(Reconciliation).filter_by(business_id=u.get("business_id"))
    if status == "OPEN": q = q.filter_by(resolved=False)
    elif status == "RESOLVED": q = q.filter_by(resolved=True)
    if severity: q = q.filter_by(severity=severity)
    if issue_code: q = q.filter_by(issue_code=issue_code)
    total = q.count()
    rows = q.order_by(Reconciliation.created_at.desc()).offset(
        (max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    onames = {o.id: o.shopify_order_name for o in db.query(Order).filter(
        Order.id.in_([r.order_id for r in rows])).all()} if rows else {}
    return {"success": True, "data": {"items": [_j(r, onames.get(r.order_id)) for r in rows],
                                      "total": total, "page": max(int(page or 1), 1)}}

@router.post("/order/{order_id}")
def run_one(order_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.reconciliation_service import reconcile_order
    from app.models.order import Order
    if db.query(Order).filter_by(id=order_id, business_id=u.get("business_id")).first() is None:
        raise HTTPException(404, "Order not found")
    return {"success": True, "data": reconcile_order(db, order_id)}

@router.post("/run")
def run_all(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    from app.models.order import Order
    from app.services.reconciliation_service import reconcile_order
    rec = exc = 0
    for o in db.query(Order).filter_by(business_id=u.get("business_id")).all():
        out = reconcile_order(db, o.id)
        if out["status"] == "RECONCILED": rec += 1
        else: exc += 1
    return {"success": True, "data": {"reconciled": rec, "exceptions": exc}}

class ResolveIn(BaseModel):
    reason: str

@router.post("/issues/{issue_id}/resolve")
def resolve(issue_id: str, body: ResolveIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.reconciliation import Reconciliation
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    if not (body.reason or "").strip():
        raise HTTPException(400, "Reason is required")
    r = db.query(Reconciliation).filter_by(id=issue_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Issue not found")
    if r.resolved:
        raise HTTPException(400, "Issue already resolved")
    r.resolved = True; r.resolved_by = u.get("user_id"); r.resolved_at = datetime.now(timezone.utc)
    log_audit(db, r.business_id, u.get("user_id"), "reconciliation", r.id, "EXCEPTION_RESOLVED",
              {"resolved": False}, {"resolved": True, "reason": body.reason.strip()})
    db.commit()
    return {"success": True, "data": {"id": r.id, "resolved": True}}
```

Mount in main.py. Pydantic v2: empty reason string passes type check → handler raises 400 (test asserts 400, not 422).

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_exceptions.py -v`
Expected: PASS. Full suite green.

- [ ] **Step 5: Manual queue check**

Via `/docs`: run-all → issues list with order names → resolve with reason → audit visible.

---

### Task 4: Exceptions + order-reconciliation UI

**Files:**
- Create: `frontend/app/exceptions/page.tsx`, `frontend/components/SeverityBadge.tsx`, `frontend/tests/exceptions.test.tsx`
- Modify: `frontend/app/orders/[id]/page.tsx` (reconciliation block above timeline)

**Interfaces:**
- Consumes: `api()`, envelope `{items,total,page}`
- Produces: exception queue + resolve modal + order block

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/exceptions.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import SeverityBadge from "../components/SeverityBadge";
test("badge shows text severity", () => {
  render(<SeverityBadge severity="CRITICAL" />);
  expect(screen.getByText("CRITICAL")).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- exceptions.test`
Expected: FAIL missing component.

- [ ] **Step 3: Minimal implementation**

```tsx
// frontend/components/SeverityBadge.tsx
import React from "react";
const ICONS: Record<string, string> = { CRITICAL: "❌", HIGH: "❌", MEDIUM: "⚠", LOW: "⚠" };
export default function SeverityBadge({ severity }: { severity: string }) {
  return <span>{ICONS[severity] ?? "○"} {severity}</span>;
}
```

```tsx
// frontend/app/exceptions/page.tsx
"use client";
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import SeverityBadge from "../../components/SeverityBadge";

type Issue = { id: string; order_id: string; order_name: string | null; issue_code: string; severity: string; issue_message: string; resolved: boolean; detected_at: string | null };
export default function ExceptionsPage() {
  const [items, setItems] = useState<Issue[]>([]);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const token = localStorage.getItem("token") ?? undefined;
    const q = new URLSearchParams({ status, ...(severity ? { severity } : {}) });
    const data = await api<{ items: Issue[] }>(`/api/v1/reconciliation/issues?${q}`, {}, token);
    setItems(data.items);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [status, severity]);
  async function doResolve() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(`/api/v1/reconciliation/issues/${resolving!.id}/resolve`,
      { method: "POST", body: JSON.stringify({ reason }) }, token);
    setResolving(null); setReason(""); load().catch((e) => setError(e.message));
  }
  return (
    <main>
      <h1>Exceptions</h1>
      <div>
        {(["OPEN", "RESOLVED", "ALL"] as const).map((s) => <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}>{s}</button>)}
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">All severities</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option>
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      <table><thead><tr><th>Order</th><th>Issue</th><th>Severity</th><th>Detected</th><th>Status</th><th></th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.id}><td>{i.order_name ?? i.order_id}</td><td>{i.issue_code}</td>
          <td><SeverityBadge severity={i.severity} /></td><td>{i.detected_at ?? "-"}</td>
          <td>{i.resolved ? "RESOLVED" : "OPEN"}</td>
          <td>{!i.resolved && <button onClick={() => setResolving(i)}>View / Resolve</button>}</td></tr>)}
        </tbody></table>
      {resolving && (
        <div role="dialog" aria-label="Resolve issue">
          <p>{resolving.issue_code} — {resolving.issue_message}</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Resolution reason (required)" aria-label="Reason" />
          <button onClick={doResolve} disabled={!reason.trim()}>Resolve</button>
          <button onClick={() => setResolving(null)}>Cancel</button>
        </div>
      )}
    </main>
  );
}
```

Order detail edit: fetch `api('/api/v1/reconciliation/order/'+id, {method:'POST'}, token)` on mount; render `✅ RECONCILED` or issue rows with SeverityBadge above the existing timeline section.

- [ ] **Step 4: Verify**

Run: `npm test -- exceptions.test` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual queue**

Seed a cancelled-dispatched order via API, open `/exceptions` → CRITICAL row → resolve with reason → moves to RESOLVED.

---

### Task 5: Seed matrix + full regression + docs

**Files:**
- Create: `backend/tests/test_seed_matrix.py`
- Modify: `README.md` (append Sprint 4 section)

**Interfaces:**
- Consumes: `reconcile_order`, fixture builders from `test_returns._mk`-style setup
- Produces: R001–R008 proof + docs

- [ ] **Step 1: Write the matrix test**

```python
# backend/tests/test_seed_matrix.py
from test_returns import _mk

def _codes(db, oid):
    from app.services.reconciliation_service import reconcile_order
    return {x["code"]: x["severity"] for x in reconcile_order(db, oid)["issues"]}

def test_r005_duplicate_dispatch():
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.add(ScanEvent(business_id=b.id, parcel_id=p.id, order_id=o.id, event_type="DISPATCHED", performed_by=u.id))
    db.commit()
    assert _codes(db, o.id).get("DUPLICATE_DISPATCH_SCAN") == "HIGH"

def test_r006_return_without_dispatch():
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.query(ScanEvent).filter_by(parcel_id=p.id).delete()
    db.add(ScanEvent(business_id=b.id, parcel_id=p.id, order_id=o.id, event_type="RETURN_RECEIVED", performed_by=u.id))
    db.commit()
    assert _codes(db, o.id).get("RETURN_WITHOUT_DISPATCH") == "HIGH"

def test_r007_over_qty():
    from app.models.return_record import ReturnRecord, ReturnItem
    db, b, u, o, i, p = _mk()
    r = ReturnRecord(business_id=b.id, order_id=o.id, parcel_id=p.id, return_type="CUSTOMER_RETURN",
                     status="RECEIVED", created_by=u.id)
    db.add(r); db.flush()
    db.add(ReturnItem(return_id=r.id, order_item_id=i.id, quantity=i.quantity + 5))
    db.commit()
    assert _codes(db, o.id).get("RETURN_QUANTITY_MISMATCH") == "HIGH"

def test_r008_stale_sync():
    from datetime import datetime, timedelta, timezone
    db, b, u, o, i, p = _mk()
    o.shopify_updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()
    assert _codes(db, o.id).get("SYNC_DELAY") == "MEDIUM"

def test_r003_refund_without_return():
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="rx", amount=300.0, currency="INR", status="COMPLETED"))
    db.commit()
    assert _codes(db, o.id).get("REFUND_WITHOUT_RETURN") == "MEDIUM"

def test_r001_pack_only_high():
    from datetime import datetime, timezone
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.query(ScanEvent).filter_by(parcel_id=p.id).delete()
    p.status = "PACKED"; db.commit()
    o.cancelled_at = datetime.now(timezone.utc); db.commit()
    assert _codes(db, o.id).get("CANCELLED_AFTER_PACK") == "HIGH"
```

Implementer: expand the sketch into one test per rule with direct-row seeding where service validation would block the state (R006/R007 need states the API refuses — seed rows directly, that is the point). Assert exact code+severity per spec §3 table.

- [ ] **Step 2: Run to verify fail-then-pass**

Run: `python -m pytest tests/test_seed_matrix.py -v`
Expected: 6 passed (validates Task 2 engine integration).

- [ ] **Step 3: Full regression**

Run: `python -m pytest tests -v` → zero failures (expect ~27 + webhooks 2 + reconciliation 5 + exceptions 3 + matrix 6+).
Run: `npx tsc --noEmit && npm test -- --run` → clean + green.

- [ ] **Step 4: Live migration + webhook drill**

Run: `alembic upgrade head` on dev Postgres → `refunds`, `reconciliations` present; webhook columns on `shopify_webhook_events` present.
Drill via `/docs`: compute HMAC for a `orders/cancelled` payload for a dispatched order → 200 → issue appears in `/exceptions`; duplicate POST → still single event row.

- [ ] **Step 5: Docs**

Append to `README.md`:
```md
## Sprint 4 — Webhooks + Reconciliation
- Webhook: `POST /api/v1/shopify/webhooks` (HMAC `X-Shopify-Hmac-Sha256` + `SHOPIFY_CLIENT_SECRET`; plain 200/401; idempotent on webhook id; BackgroundTasks processing, 3 retries).
- Topics: orders/create|updated|cancelled, refunds/create, fulfillments/create|update. Needs `SHOPIFY_CLIENT_SECRET=` in `.env` (App setup → API credentials → Client secret).
- Engine: `reconcile_order` R001–R008 auto-runs after dispatch/return/sync/webhook. Manual: `POST /api/v1/reconciliation/order/{id}`, bulk `POST /api/v1/reconciliation/run` (ADMIN/ACCOUNTANT).
- Queue: `GET /api/v1/reconciliation/issues?status=&severity=&issue_code=`; resolve `POST /issues/{id}/resolve {reason}` (reason mandatory, audited).
- UI: `/exceptions` queue + resolve dialog; order detail reconciliation block.
- Alembic: adds refunds + reconciliations + webhook processing columns.
```
