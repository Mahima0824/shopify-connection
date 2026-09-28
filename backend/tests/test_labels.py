"""Task 2: parcel lookup + backfill + label (sqlite override, never live DB)."""

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

EMAIL = "labels@example.com"
PASSWORD = "StrongPass123!"


@pytest.fixture()
def client_auth():
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
        b = Business(name="Label Biz", email=EMAIL)
        db.add(b)
        db.commit()
        db.refresh(b)
        u = User(
            business_id=b.id,
            name="Label Admin",
            email=EMAIL,
            password_hash=hash_password(PASSWORD),
            role="ADMIN",
        )
        db.add(u)
        db.commit()
        # Seed one fixture order via sync path (uses upsert_order -> auto parcel hook).
        from app.services.shopify_service import upsert_order

        upsert_order(db, b.id, {
            "id": 1001, "name": "#1001", "currency": "INR",
            "subtotal": 100.0, "total_discounts": 0.0, "total_shipping": 0.0,
            "total_tax": 0.0, "total_price": 100.0,
            "financial_status": "paid", "fulfillment_status": "unfulfilled",
            "created_at": "2026-01-01T00:00:00Z",
            "customer": {"id": 55, "first_name": "A", "last_name": "B", "email": "a@b.in"},
            "line_items": [{"id": 1, "title": "Widget", "sku": "W-1", "quantity": 2, "price": 50.0}],
        })
        # Remove the auto-created parcel so backfill has work to do.
        from app.models.parcel import Parcel

        db.query(Parcel).delete()
        db.commit()
        db.close()
        with TestClient(app) as c:
            c.testing_session = TestingSession  # type: ignore[attr-defined]
            yield c
    finally:
        app.dependency_overrides.clear()


def test_parcel_lookup_and_backfill(client_auth):
    lr = client_auth.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert lr.status_code == 200, lr.text
    token = lr.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = client_auth.post("/api/v1/parcels/backfill", headers=headers)
    assert r.status_code == 200, r.text
    n = r.json()["data"]["created"]
    assert n >= 1
    r2 = client_auth.get("/api/v1/orders", headers=headers)
    assert r2.status_code == 200, r2.text
    assert len(r2.json()["data"]["items"]) >= 1
    TestingSession = client_auth.testing_session
    db = TestingSession()
    from app.models.parcel import Parcel
    from app.models.order import Order

    o = db.query(Order).first()
    p = db.query(Parcel).filter_by(order_id=o.id).first()
    db.close()
    assert p is not None
    r3 = client_auth.get(f"/api/v1/parcels/{p.barcode_value}", headers=headers)
    assert r3.status_code == 200, r3.text
    assert r3.json()["data"]["parcel"]["barcode_value"] == p.barcode_value
    r4 = client_auth.get(f"/api/v1/parcels/{p.id}/label", headers=headers)
    assert r4.status_code == 200, r4.text
    assert "text/html" in r4.headers["content-type"]
    assert p.barcode_value in r4.text


def test_parcels_list_route(client_auth):
    lr = client_auth.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {lr.json()['data']['token']}"}
    client_auth.post("/api/v1/parcels/backfill", headers=headers)
    r = client_auth.get("/api/v1/parcels", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total"] >= 1 and len(data["items"]) >= 1
    row = data["items"][0]
    for k in ("id", "parcel_code", "barcode_value", "status", "order_id", "order_name"):
        assert k in row, row
    assert "courier" in row and "awb" in row
    r2 = client_auth.get("/api/v1/parcels?status=CREATED", headers=headers)
    assert r2.status_code == 200, r2.text
    assert all(i["status"] == "CREATED" for i in r2.json()["data"]["items"])


def test_backfill_requires_auth(client_auth):
    r = client_auth.post("/api/v1/parcels/backfill")
    assert r.status_code == 401, r.text


def test_barcode_png_download(client_auth):
    lr = client_auth.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {lr.json()['data']['token']}"}
    client_auth.post("/api/v1/parcels/backfill", headers=headers)
    TestingSession = client_auth.testing_session
    db = TestingSession()
    from app.models.parcel import Parcel

    p = db.query(Parcel).first()
    db.close()
    assert p is not None
    r = client_auth.get(f"/api/v1/parcels/{p.id}/barcode.png", headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    r2 = client_auth.get("/api/v1/parcels/NOPE/barcode.png", headers=headers)
    assert r2.status_code == 404, r2.text
