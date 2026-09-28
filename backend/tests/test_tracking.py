# backend/tests/test_tracking.py
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
from app.main import app
from app.database import get_db


def _seed():
    from datetime import datetime, timezone
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
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u)
    db.commit()
    db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-T1", shopify_order_id="gid://t1",
              shopify_order_name="#T1", currency="INR", operational_status="DISPATCHED",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="DISPATCHED")
    db.add(p)
    db.commit()
    db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number="D100", tracking_status="BOOKED")
    db.add(s)
    db.commit()
    db.refresh(s)
    sid = s.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "w@t.in", "password": "x"}).json()["data"]["token"]
    return c, tok, mk, sid


def _post(c, tok, sid, body):
    return c.post(f"/api/v1/shipments/{sid}/events", json=body,
                  headers={"Authorization": f"Bearer {tok}"})


def test_manual_checkpoint_dedupes():
    from app.models.shipment import ShipmentEvent
    c, tok, mk, sid = _seed()
    body = {"carrier_event_id": "e1", "carrier_status_raw": "Arrived at Ahmedabad DC",
            "message": "At hub", "location": "Ahmedabad"}
    assert _post(c, tok, sid, body).status_code == 200
    assert _post(c, tok, sid, body).status_code == 200
    db = mk()
    try:
        assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 1
    finally:
        db.close()


def test_unknown_status_stored():
    c, tok, mk, sid = _seed()
    r = _post(c, tok, sid, {"carrier_event_id": "e9", "carrier_status_raw": "blorpg gibberish"})
    assert r.status_code == 200
    assert r.json()["data"]["event"]["normalized_status"] == "UNKNOWN"


def test_terminal_stops_sync():
    c, tok, mk, sid = _seed()
    _post(c, tok, sid, {"carrier_event_id": "ed", "carrier_status_raw": "delivered to customer"})
    r = c.post(f"/api/v1/shipments/{sid}/sync", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["data"]["synced"] is False
