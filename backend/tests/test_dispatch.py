"""Task 3: dispatch scan API (transactional + validation). Service-level tests + API tests."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.business  # noqa: F401
import app.models.user  # noqa: F401
import app.models.order  # noqa: F401
import app.models.parcel  # noqa: F401
import app.models.scan_event  # noqa: F401
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.order import Order
from app.models.user import User
from app.services.auth_service import create_token, hash_password
from app.services.barcode_service import ensure_parcel_for_order


def _make_db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return eng, sessionmaker(bind=eng)()


def _seed(cancelled: bool = False, role: str = "WAREHOUSE"):
    eng, db = _make_db()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(
        business_id=b.id,
        name="W",
        email=f"w-{role.lower()}-{cancelled}@t.in",
        password_hash=hash_password("x"),
        role=role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    o = Order(
        business_id=b.id,
        internal_order_number=f"ORD-{'C' if cancelled else 'D'}-{role}",
        shopify_order_id=f"gid://{'c' if cancelled else 'd'}-{role}",
        shopify_order_name="#C" if cancelled else "#D",
        currency="INR",
        subtotal_amount=100.0,
        discount_amount=0.0,
        shipping_amount=0.0,
        tax_amount=0.0,
        total_amount=100.0,
        payment_status="PAID",
        financial_status="PAID",
        fulfillment_status="UNFULFILLED",
        operational_status="NEW",
        order_date=datetime.now(timezone.utc),
        cancelled_at=datetime.now(timezone.utc) if cancelled else None,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    p = ensure_parcel_for_order(db, o.id)
    return db, o, p, u


@pytest.fixture()
def seed_order_parcel_user():
    db, o, p, u = _seed()
    yield db, o, p, u
    db.close()


@pytest.fixture()
def seed_cancelled_order():
    db, o, p, u = _seed(cancelled=True)
    yield db, o, p, u
    db.close()


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

    db, order, parcel, user = seed_order_parcel_user
    dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    assert e.value.code == "PARCEL_ALREADY_DISPATCHED"


def test_cancelled_blocked(seed_cancelled_order):
    from app.services.scanning_service import dispatch_parcel, ScanError

    db, order, parcel, user = seed_cancelled_order
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, parcel.barcode_value, user.id)
    assert e.value.code == "ORDER_CANCELLED"


def test_invalid_barcode(seed_order_parcel_user):
    from app.services.scanning_service import dispatch_parcel, ScanError

    db, order, parcel, user = seed_order_parcel_user
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, order.business_id, "P99999999", user.id)
    assert e.value.code == "INVALID_BARCODE"


def _api_client(db):
    def _override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def test_api_dispatch_ok_and_duplicate_code(seed_order_parcel_user):
    db, order, parcel, user = seed_order_parcel_user
    token = create_token(user.id, order.business_id, user.role)
    headers = {"Authorization": f"Bearer {token}"}
    for client in _api_client(db):
        r = client.post("/api/v1/scan/dispatch", json={"barcode": parcel.barcode_value}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        assert r.json()["data"]["parcel"]["status"] == "DISPATCHED"
        r2 = client.post("/api/v1/scan/dispatch", json={"barcode": parcel.barcode_value}, headers=headers)
        assert r2.status_code == 400, r2.text
        assert r2.headers.get("X-Error-Code") == "PARCEL_ALREADY_DISPATCHED"


def test_api_role_gate_forbidden(seed_order_parcel_user):
    db, order, parcel, user = seed_order_parcel_user
    token = create_token(user.id, order.business_id, "VIEWER")
    headers = {"Authorization": f"Bearer {token}"}
    for client in _api_client(db):
        r = client.post("/api/v1/scan/dispatch", json={"barcode": parcel.barcode_value}, headers=headers)
        assert r.status_code == 403, r.text


def test_api_invalid_barcode_code(seed_order_parcel_user):
    db, order, parcel, user = seed_order_parcel_user
    token = create_token(user.id, order.business_id, user.role)
    headers = {"Authorization": f"Bearer {token}"}
    for client in _api_client(db):
        r = client.post("/api/v1/scan/dispatch", json={"barcode": "P99999999"}, headers=headers)
        assert r.status_code == 404, r.text
        assert r.headers.get("X-Error-Code") == "INVALID_BARCODE"
