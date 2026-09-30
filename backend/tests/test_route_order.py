"""Route-order regression: /shipments/outstanding must hit the SLA board, not shipments GET /{sid}."""

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

EMAIL = "routes@example.com"
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
        b = Business(name="Routes Biz", email=EMAIL)
        db.add(b)
        db.commit()
        db.refresh(b)
        u = User(
            business_id=b.id,
            name="Routes Admin",
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


def test_outstanding_beats_sid_route(client: TestClient):
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get("/api/v1/shipments/outstanding", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True


def test_unknown_sid_still_404s(client: TestClient):
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get("/api/v1/shipments/does-not-exist", headers=h)
    assert r.status_code == 404, r.text
