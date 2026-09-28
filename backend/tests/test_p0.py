# backend/tests/test_p0.py
"""Task 1 P0 hardening: batches serializable + prod-safe defaults."""
import json

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

EMAIL = "p0@example.com"
PASSWORD = "StrongPass123!"


@pytest.fixture()
def auth_client():
    engine = create_engine(
        "sqlite://",
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
        b = Business(name="P0 Biz", email=EMAIL)
        db.add(b)
        db.commit()
        db.refresh(b)
        u = User(
            business_id=b.id,
            name="P0 Admin",
            email=EMAIL,
            password_hash=hash_password(PASSWORD),
            role="ADMIN",
        )
        db.add(u)
        db.commit()
        db.close()
        with TestClient(app) as c:
            r = c.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
            assert r.status_code == 200, r.text
            token = r.json()["data"]["token"]
            c.headers.update({"Authorization": f"Bearer {token}"})
            yield c
    finally:
        app.dependency_overrides.clear()


def test_batches_serializable(auth_client):
    r = auth_client.get("/api/v1/tally/batches")
    assert r.status_code == 200
    json.dumps(r.json())  # must not raise
    assert isinstance(r.json()["data"], list)


def test_prod_defaults_safe(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    from app import config
    assert config.Settings().app_env == "production"
