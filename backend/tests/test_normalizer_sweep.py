# backend/tests/test_normalizer_sweep.py
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.user
import app.models.order
import app.models.parcel
import app.models.shipment
import app.models.sla
from app.main import app
from app.database import get_db


def _env(awb="D800", status="RTO_IN_TRANSIT", days_old=50):
    from datetime import datetime, timedelta, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services.auth_service import hash_password
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    o = Order(business_id=b.id, internal_order_number="ORD-N1", shopify_order_id="gid://n1",
              shopify_order_name="#N1", currency="INR", total_amount=900.0, operational_status="DISPATCHED",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="DISPATCHED")
    db.add(p)
    db.commit()
    db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=awb, tracking_status=status,
                 rto_at=datetime.now(timezone.utc) - timedelta(days=days_old))
    db.add(s)
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}


def test_db_mapping_beats_keyword():
    from sqlalchemy import create_engine as _e
    from sqlalchemy.orm import sessionmaker as _mk
    from sqlalchemy.pool import StaticPool as _SP
    from app.database import Base as _B
    import app.models.business as _bb
    from app.models.business import Business
    from app.models.courier_meta import CourierStatusMapping
    from app.carriers.registry import db_normalize
    eng = _e("sqlite://", connect_args={"check_same_thread": False}, poolclass=_SP)
    _B.metadata.create_all(eng)
    mk = _mk(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    db.add(CourierStatusMapping(business_id=b.id, provider="DTDC", provider_status_code="Stuck at hub",
                                normalized_status="AT_HUB"))
    db.commit()
    assert db_normalize(db, b.id, "DTDC", "Stuck at hub") == "AT_HUB"
    assert db_normalize(db, b.id, "DTDC", "total gibberish xyz") is None
    db.close()


def test_evaluate_idempotent():
    c, h = _env()
    r1 = c.post("/api/v1/sla/evaluate", headers=h)
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["opened"] >= 1
    r2 = c.post("/api/v1/sla/evaluate", headers=h)
    assert r2.json()["data"]["opened"] == 0


def test_refresh_cooldown():
    c, h = _env()
    sid = c.get("/api/v1/shipments", headers=h).json()["data"]["items"][0]["id"]
    c.post(f"/api/v1/shipments/{sid}/events",
           json={"carrier_status_raw": "picked up"}, headers=h)
    c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
    r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
    assert r.status_code == 429
