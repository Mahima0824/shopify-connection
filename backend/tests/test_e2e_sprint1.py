"""Sprint 1 E2E smoke: login -> sync (fixture fallback) -> orders visible.

Runs without live Postgres/Shopify: sqlite in-memory override for `get_db`
plus the `/sync` fixture fallback (no `SHOPIFY_ACCESS_TOKEN`/`SHOPIFY_SHOP_DOMAIN`
in env, enforced via monkeypatch).

Adapted from the plan Task 5 snippet: `GET /api/v1/orders` returns
`{"success": True, "data": {"items": [...], "total": N, "page": P}}`,
so assertions unwrap `data.items` (with a fallback for list-shaped data).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (populate Base.metadata)
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.user import User
from app.services.auth_service import hash_password

EMAIL = "e2e@example.com"
PASSWORD = "StrongPass123!"


@pytest.fixture()
def client(monkeypatch):
    """TestClient with sqlite-backed `get_db` and a seeded Business/User."""
    # Force fixture fallback: never hit live Shopify in this test.
    monkeypatch.delenv("SHOPIFY_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("SHOPIFY_SHOP_DOMAIN", raising=False)

    # StaticPool keeps a single shared :memory: DB across TestClient threads.
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
        b = Business(name="E2E Biz", email=EMAIL)
        db.add(b)
        db.commit()
        db.refresh(b)
        u = User(
            business_id=b.id,
            name="E2E Admin",
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


def _login_token(client: TestClient) -> str:
    r = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    token = body["data"]["token"]
    assert token
    return token


def _order_items(payload: dict) -> list:
    data = payload["data"]
    if isinstance(data, dict):
        return data.get("items", [])
    return data


def test_e2e_sync_then_list(client: TestClient):
    token = _login_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/v1/shopify/sync", params={"days": 30}, headers=headers)
    assert r.status_code in (200, 201), r.text
    sync_body = r.json()
    assert sync_body["success"] is True
    assert sync_body["data"]["synced"] >= 1
    # Fixture fallback: no live Shopify creds in this test.
    assert sync_body["data"]["source"] == "fixture"
    # Never leak tokens.
    assert "access_token" not in r.text

    r2 = client.get("/api/v1/orders", headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["success"] is True
    items = _order_items(r2.json())
    assert len(items) >= 1
    first = items[0]
    assert first.get("shopify_order_id")
    assert first.get("business_id")


def test_e2e_resync_produces_no_duplicates(client: TestClient):
    token = _login_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    for _ in range(2):
        r = client.post("/api/v1/shopify/sync", params={"days": 30}, headers=headers)
        assert r.status_code in (200, 201), r.text

    r2 = client.get("/api/v1/orders", params={"page_size": 100}, headers=headers)
    assert r2.json()["success"] is True
    items = _order_items(r2.json())
    ids = [o["shopify_order_id"] for o in items]
    assert len(ids) >= 1
    assert len(ids) == len(set(ids)), "re-sync created duplicates"


def test_e2e_orders_requires_auth(client: TestClient):
    r = client.get("/api/v1/orders")
    assert r.status_code == 401, r.text


def test_e2e_sync_requires_auth(client: TestClient):
    r = client.post("/api/v1/shopify/sync", params={"days": 30})
    assert r.status_code == 401, r.text
