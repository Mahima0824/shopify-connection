# backend/tests/test_shipments_search.py
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.business  # noqa: F401
import app.models.user  # noqa: F401
import app.models.order  # noqa: F401
import app.models.parcel  # noqa: F401
import app.models.shipment  # noqa: F401
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.shipment import Shipment
from app.models.user import User
from app.services.auth_service import create_token, hash_password


def _env():
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

    now = datetime.now(timezone.utc)
    o1 = Order(business_id=b.id, internal_order_number="ORD-SRCH-A", shopify_order_id="gid://srch-a",
               shopify_order_name="#A1001", currency="INR", total_amount=100.0,
               financial_status="PAID", operational_status="NEW", order_date=now)
    o2 = Order(business_id=b.id, internal_order_number="ORD-SRCH-B", shopify_order_id="gid://srch-b",
               shopify_order_name="#B1002", currency="INR", total_amount=200.0,
               financial_status="PAID", operational_status="NEW", order_date=now)
    db.add_all([o1, o2])
    db.commit()
    db.refresh(o1)
    db.refresh(o2)
    p1 = Parcel(business_id=b.id, order_id=o1.id, parcel_code="PSRCHA01", barcode_value="PSRCHA01", status="CREATED")
    p2 = Parcel(business_id=b.id, order_id=o2.id, parcel_code="PSRCHB02", barcode_value="PSRCHB02", status="CREATED")
    db.add_all([p1, p2])
    db.commit()
    db.refresh(p1)
    db.refresh(p2)
    s1 = Shipment(business_id=b.id, order_id=o1.id, parcel_id=p1.id,
                  carrier_code="MANUAL", awb_number="D100", tracking_status="BOOKED")
    s2 = Shipment(business_id=b.id, order_id=o2.id, parcel_id=p2.id,
                  carrier_code="MANUAL", awb_number="D200", tracking_status="BOOKED")
    db.add_all([s1, s2])
    db.commit()
    bid = b.id
    tok = create_token(u.id, bid, u.role)
    db.close()

    def _override():
        s = mk()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override
    c = TestClient(app)
    return c, {"Authorization": f"Bearer {tok}"}


def _awbs(resp_json):
    return [i["awb_number"] for i in resp_json["data"]["items"]]


def test_search_by_awb_returns_only_match():
    c, h = _env()
    try:
        r = c.get("/api/v1/shipments", params={"q": "D100"}, headers=h)
        assert r.status_code == 200, r.text
        assert _awbs(r.json()) == ["D100"]
    finally:
        app.dependency_overrides.clear()


def test_search_by_order_name_substring():
    c, h = _env()
    try:
        r = c.get("/api/v1/shipments", params={"q": "A1001"}, headers=h)
        assert r.status_code == 200, r.text
        assert _awbs(r.json()) == ["D100"]
    finally:
        app.dependency_overrides.clear()


def test_search_by_parcel_barcode():
    c, h = _env()
    try:
        r = c.get("/api/v1/shipments", params={"q": "PSRCHB02"}, headers=h)
        assert r.status_code == 200, r.text
        assert _awbs(r.json()) == ["D200"]
    finally:
        app.dependency_overrides.clear()


def test_empty_q_behaves_as_no_filter():
    c, h = _env()
    try:
        r = c.get("/api/v1/shipments", params={"q": ""}, headers=h)
        assert r.status_code == 200, r.text
        assert sorted(_awbs(r.json())) == ["D100", "D200"]
        r2 = c.get("/api/v1/shipments", headers=h)
        assert sorted(_awbs(r2.json())) == ["D100", "D200"]
    finally:
        app.dependency_overrides.clear()


def test_search_combinable_with_status_filter():
    c, h = _env()
    try:
        r = c.get("/api/v1/shipments", params={"q": "D", "status": "BOOKED"}, headers=h)
        assert r.status_code == 200, r.text
        assert sorted(_awbs(r.json())) == ["D100", "D200"]
        r2 = c.get("/api/v1/shipments", params={"q": "D100", "status": "DELIVERED"}, headers=h)
        assert _awbs(r2.json()) == []
    finally:
        app.dependency_overrides.clear()
