"""Task 1: India Post model fields exist on Order."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.user import User
from app.services.auth_service import hash_password

EMAIL = "indiapost@example.com"
PASSWORD = "StrongPass123!"


@pytest.fixture()
def client(monkeypatch):
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
        b = Business(name="IndiaPost Biz", email=EMAIL)
        db.add(b)
        db.commit()
        db.refresh(b)
        u = User(
            business_id=b.id,
            name="IndiaPost Admin",
            email=EMAIL,
            password_hash=hash_password(PASSWORD),
            role="ADMIN",
        )
        db.add(u)
        db.commit()
        db.close()
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _token(c: TestClient) -> str:
    r = c.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["data"]["token"]


def test_model_has_india_post_fields():
    from app.models.order import Order
    assert hasattr(Order, "receiver_pincode")
    assert hasattr(Order, "cod_mode")
    assert hasattr(Order, "weight_grams")
    assert hasattr(Order, "barcode_no")


def test_create_manual_cod_order(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "500018", "weight_grams": 930, "cod_mode": "COD", "cod_value": 1350}
    r = client.post("/api/v1/orders", json=payload, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["receiver_pincode"] == "500018"


def test_create_rejects_bad_pincode(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "123", "weight_grams": 930, "cod_mode": "COD", "cod_value": 1350}
    r = client.post("/api/v1/orders", json=payload, headers=h)
    assert r.status_code == 422, r.text


def test_filter_cod_and_pincode(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    base = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "weight_grams": 930}
    r1 = client.post("/api/v1/orders", json={**base, "receiver_pincode": "500018", "cod_mode": "COD", "cod_value": 1350}, headers=h)
    assert r1.status_code == 200, r1.text
    r2 = client.post("/api/v1/orders", json={**base, "receiver_pincode": "500001", "cod_mode": "PREPAID", "cod_value": 0}, headers=h)
    assert r2.status_code == 200, r2.text
    r = client.get("/api/v1/orders?cod_mode=COD&pincode=500018", headers=h)
    assert r.status_code == 200
    assert all(x.get("cod_mode")=="COD" for x in r.json()["data"]["items"])


def test_filter_city_and_date_range(client):
    from datetime import date
    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "500018", "weight_grams": 930, "cod_mode": "COD", "cod_value": 1350}
    r1 = client.post("/api/v1/orders", json=payload, headers=h)
    assert r1.status_code == 200, r1.text
    created_id = r1.json()["data"]["id"]
    today = date.today().isoformat()
    r = client.get(f"/api/v1/orders?city=HYD&date_from={today}T00:00:00&date_to={today}T23:59:59", headers=h)
    assert r.status_code == 200
    ids = [x.get("id") for x in r.json()["data"]["items"]]
    assert created_id in ids


def test_export_header_exact():
    from app.services.india_post_export import INDIA_POST_HEADERS
    assert len(INDIA_POST_HEADERS) == 48
    assert INDIA_POST_HEADERS[0] == "SERIAL NUMBER"
    assert INDIA_POST_HEADERS[40] == "CODR/COD"
    assert INDIA_POST_HEADERS[47] == "BULK REFERENCE"


def test_export_bulk_xlsx(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "500018", "weight_grams": 930, "cod_mode": "COD", "cod_value": 1350}
    r1 = client.post("/api/v1/orders", json=payload, headers=h)
    assert r1.status_code == 200, r1.text
    r = client.get("/api/v1/orders/export/india-post.xlsx", headers=h)
    assert r.status_code == 200, r.text
    assert "spreadsheetml" in r.headers.get("content-type", "")
    assert r.content[:2] == b"PK"


def test_delete_order_with_reconciliation_and_children(client):
    from app.models.reconciliation import Reconciliation
    from app.models.payment import Payment
    from app.models.refund import Refund
    from app.models.order import Order
    from app.database import get_db

    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "KIRAN", "receiver_mobile": "9100312162", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "500018", "weight_grams": 930, "cod_mode": "COD", "cod_value": 1350}
    r = client.post("/api/v1/orders", json=payload, headers=h)
    assert r.status_code == 200, r.text
    order_id = r.json()["data"]["id"]

    db_gen = client.app.dependency_overrides[get_db]()
    db = next(db_gen)
    o = db.query(Order).filter_by(id=order_id).first()
    recon = Reconciliation(business_id=o.business_id, order_id=o.id, issue_code="TEST_ISSUE", severity="HIGH", issue_message="Test recon issue")
    pmt = Payment(business_id=o.business_id, order_id=o.id, amount=100.0)
    ref = Refund(business_id=o.business_id, order_id=o.id, shopify_refund_id="REF123", amount=50.0)
    db.add_all([recon, pmt, ref])
    db.commit()

    r_del = client.delete(f"/api/v1/orders/{order_id}", headers=h)
    assert r_del.status_code == 200, r_del.text
    assert r_del.json()["success"] is True

    r_get = client.get(f"/api/v1/orders/{order_id}", headers=h)
    assert r_get.status_code == 404


def test_delete_order_without_parcels(client):
    from app.models.order import Order, OrderItem
    from app.models.parcel_item import ParcelItem
    from app.database import get_db

    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name": "TEST", "receiver_mobile": "9999999999", "receiver_add1": "HYDERABAD", "receiver_city": "HYDERABAD", "receiver_state": "TELANGANA", "receiver_pincode": "500018", "weight_grams": 500, "cod_mode": "PREPAID", "cod_value": 0}
    r = client.post("/api/v1/orders", json=payload, headers=h)
    assert r.status_code == 200, r.text
    order_id = r.json()["data"]["id"]

    db_gen = client.app.dependency_overrides[get_db]()
    db = next(db_gen)
    o = db.query(Order).filter_by(id=order_id).first()
    item = OrderItem(order_id=o.id, business_id=o.business_id, title="Test Item", quantity=1, price=100.0)
    db.add(item)
    db.commit()

    r_del = client.delete(f"/api/v1/orders/{order_id}", headers=h)
    assert r_del.status_code == 200, r_del.text
    assert r_del.json()["success"] is True


