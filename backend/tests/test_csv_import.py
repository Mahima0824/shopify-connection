from pathlib import Path
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


_LAST_MK = None


def _db():
    return _LAST_MK()


def _client():
    global _LAST_MK
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng, autoflush=False, autocommit=False)

    def _override():
        db = mk()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    _LAST_MK = mk
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    db.close()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, tok


def _teardown():
    app.dependency_overrides.clear()


def _bytes():
    return (Path(__file__).parent / "fixtures" / "orders_export_1.csv").read_bytes()


def test_import_creates_orders_and_refund():
    from app.models.business import Business as _B
    from app.models.order import Order as _O
    from app.models.refund import Refund as _R
    c, tok = _client()
    try:
        r = c.post("/api/v1/imports/shopify-csv", files={"file": ("orders.csv", _bytes(), "text/csv")},
                   headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        d = r.json()["data"]
        assert d["created"] == 4 and d["skipped"] == 0
        r2 = c.get("/api/v1/orders", headers={"Authorization": f"Bearer {tok}"})
        assert r2.json()["data"]["total"] == 4
        names = [o["shopify_order_name"] for o in r2.json()["data"]["items"]]
        assert "#1004" in names
        db = _db()
        try:
            b = db.query(_B).first()
            o = db.query(_O).filter_by(business_id=b.id, shopify_order_name="#1004").first()
            assert o is not None
            ref = db.query(_R).filter_by(business_id=b.id, order_id=o.id).first()
            assert ref is not None
            assert float(ref.amount) == 1025.0
        finally:
            db.close()
    finally:
        _teardown()


def test_reimport_no_duplicates_and_dry_run():
    c, tok = _client()
    try:
        h = {"Authorization": f"Bearer {tok}"}
        c.post("/api/v1/imports/shopify-csv", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
        r = c.post("/api/v1/imports/shopify-csv", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
        assert r.json()["data"]["created"] == 0 and r.json()["data"]["updated"] == 4
        d = c.post("/api/v1/imports/shopify-csv?dry_run=true", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
        assert d.json()["data"]["created"] == 0 and d.json()["data"]["parsed"] == 4
    finally:
        _teardown()


def test_dry_run_first_writes_nothing():
    c, tok = _client()
    try:
        h = {"Authorization": f"Bearer {tok}"}
        d = c.post("/api/v1/imports/shopify-csv?dry_run=true", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
        assert d.status_code == 200
        body = d.json()["data"]
        assert body["created"] == 0 and body["parsed"] == 4
        r2 = c.get("/api/v1/orders", headers=h)
        assert r2.json()["data"]["total"] == 0
    finally:
        _teardown()


def test_caps_and_type_guards():
    c, tok = _client()
    try:
        h = {"Authorization": f"Bearer {tok}"}
        big = b"x" * (5 * 1024 * 1024 + 1)
        r = c.post("/api/v1/imports/shopify-csv", files={"file": ("big.csv", big, "text/csv")}, headers=h)
        assert r.status_code == 400
        r2 = c.post("/api/v1/imports/shopify-csv", files={"file": ("o.txt", _bytes(), "text/plain")}, headers=h)
        assert r2.status_code == 415
    finally:
        _teardown()
