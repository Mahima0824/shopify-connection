# backend/tests/test_exceptions.py
"""Task 3: Exceptions API + resolve + audit (failing-first)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 (populate Base.metadata)
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.user import User
from app.services.auth_service import hash_password

ADMIN_EMAIL = "exc-admin@t.in"
VIEWER_EMAIL = "exc-viewer@t.in"
PASSWORD = "StrongPass123!"


@pytest.fixture()
def clients():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def _override():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    try:
        db = TestingSession()
        b = Business(name="Exc Biz", email="exc@t.in")
        db.add(b)
        db.commit()
        db.refresh(b)
        admin = User(
            business_id=b.id, name="Admin", email=ADMIN_EMAIL,
            password_hash=hash_password(PASSWORD), role="ADMIN",
        )
        viewer = User(
            business_id=b.id, name="Viewer", email=VIEWER_EMAIL,
            password_hash=hash_password(PASSWORD), role="VIEWER",
        )
        db.add_all([admin, viewer])
        db.commit()
        db.refresh(admin)
        db.refresh(viewer)
        # Seed a dispatched order (R001 fires once cancelled).
        from datetime import datetime, timezone
        from app.models.order import Order, OrderItem
        from app.services.barcode_service import ensure_parcel_for_order
        from app.services.scanning_service import dispatch_parcel

        o = Order(
            business_id=b.id, internal_order_number="ORD-EXC1",
            shopify_order_id="gid://exc1", shopify_order_name="#EXC1",
            currency="INR", subtotal_amount=300.0, discount_amount=0.0,
            shipping_amount=0.0, tax_amount=0.0, total_amount=300.0,
            payment_status="PENDING", financial_status="PENDING",
            fulfillment_status="UNFULFILLED", operational_status="NEW",
            order_date=datetime.now(timezone.utc),
        )
        db.add(o)
        db.commit()
        db.refresh(o)
        i = OrderItem(business_id=b.id, order_id=o.id, title="Shoes", sku="SH-1", quantity=3, price=100.0)
        db.add(i)
        db.commit()
        p = ensure_parcel_for_order(db, o.id)
        dispatch_parcel(db, b.id, p.barcode_value, admin.id)
        # Cancel after dispatch -> R001 CANCELLED_BUT_DISPATCHED on next reconcile.
        o.cancelled_at = datetime.now(timezone.utc)
        db.commit()
        order_id = o.id
        db.close()
        with TestClient(app) as c:
            yield c, TestingSession, order_id
    finally:
        app.dependency_overrides.clear()


def _login(c: TestClient, email: str) -> dict:
    r = c.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['token']}"}


def test_resolve_requires_reason_and_role(clients):
    c, TestingSession, order_id = clients
    admin_h = _login(c, ADMIN_EMAIL)
    viewer_h = _login(c, VIEWER_EMAIL)

    # Viewer cannot run bulk reconcile.
    r = c.post("/api/v1/reconciliation/run", headers=viewer_h)
    assert r.status_code == 403

    # Seed the issue via the reconcile endpoint.
    r = c.post(f"/api/v1/reconciliation/order/{order_id}", headers=admin_h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "EXCEPTION"
    assert any(x["code"] == "CANCELLED_BUT_DISPATCHED" for x in r.json()["data"]["issues"])

    # Queue shows the issue with the order name.
    r = c.get("/api/v1/reconciliation/issues", headers=admin_h)
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    assert len(items) >= 1
    issue = next(x for x in items if x["order_id"] == order_id)
    assert issue["issue_code"] == "CANCELLED_BUT_DISPATCHED"
    issue_id = issue["id"]

    # Viewer cannot resolve.
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve",
               json={"reason": "nope"}, headers=viewer_h)
    assert r.status_code == 403

    # Missing reason -> 422 (absent body field); empty/blank reason -> 400.
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve", json={}, headers=admin_h)
    assert r.status_code == 422
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve",
               json={"reason": ""}, headers=admin_h)
    assert r.status_code == 400
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve",
               json={"reason": "   "}, headers=admin_h)
    assert r.status_code == 400

    # Resolve with reason -> 200 + resolved + audit row.
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve",
               json={"reason": "verified with warehouse"}, headers=admin_h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["resolved"] is True

    db = TestingSession()
    try:
        from app.models.reconciliation import Reconciliation
        from app.models.audit_log import AuditLog
        row = db.query(Reconciliation).filter_by(id=issue_id).first()
        assert row.resolved is True
        assert db.query(AuditLog).filter_by(
            entity_type="reconciliation", entity_id=issue_id,
            action="EXCEPTION_RESOLVED").count() == 1
    finally:
        db.close()

    # Second resolve -> 400 ALREADY_RESOLVED.
    r = c.post(f"/api/v1/reconciliation/issues/{issue_id}/resolve",
               json={"reason": "again"}, headers=admin_h)
    assert r.status_code == 400


def test_run_all_and_auth_guards(clients):
    c, _, _ = clients
    # Unauthenticated.
    assert c.post("/api/v1/reconciliation/run").status_code == 401
    assert c.get("/api/v1/reconciliation/issues").status_code == 401
    # Admin bulk run works and returns counts.
    admin_h = _login(c, ADMIN_EMAIL)
    r = c.post("/api/v1/reconciliation/run", headers=admin_h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["exceptions"] >= 1
    # Unknown order -> 404.
    r = c.post("/api/v1/reconciliation/order/does-not-exist", headers=admin_h)
    assert r.status_code == 404
