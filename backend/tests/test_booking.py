# backend/tests/test_booking.py
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.user
import app.models.order
import app.models.customer
import app.models.payment
import app.models.parcel
import app.models.shipment
from app.main import app
from app.database import get_db


def _env(phone="+91-900000001"):
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.customer import Customer
    from app.models.payment import Payment
    from app.models.parcel import Parcel
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
    c = Customer(business_id=b.id, first_name="R", phone=phone)
    db.add(c)
    db.commit()
    db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-BK1", shopify_order_id="gid://bk1",
              shopify_order_name="#BK1", currency="INR", total_amount=500.0, financial_status="PAID",
              operational_status="NEW", customer_id=c.id, order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    db.add(Payment(business_id=b.id, order_id=o.id, amount=500.0, payment_status="PAID", method="COD"))
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="CREATED")
    db.add(p)
    db.commit()
    db.refresh(p)
    pid = p.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    t = TestClient(app)
    tok = t.post("/api/v1/auth/login", json={"email": "w@t.in", "password": "x"}).json()["data"]["token"]
    return t, {"Authorization": f"Bearer {tok}"}, pid


def test_book_validates_then_idempotent():
    c, h, pid = _env(phone=None)
    r = c.post(f"/api/v1/shipments/{pid}/book", json={"carrier_code": "MANUAL"}, headers=h)
    assert r.status_code == 400 and "phone" in r.text
    c2, h2, pid2 = _env(phone="+91-900000002")
    r = c2.post(f"/api/v1/shipments/{pid2}/book",
                json={"carrier_code": "MANUAL", "awb_number": "M100"},
                headers={**h2, "Idempotency-Key": "k-1"})
    assert r.status_code == 200, r.text
    sid = r.json()["data"]["id"]
    r2 = c2.post(f"/api/v1/shipments/{pid2}/book",
                 json={"carrier_code": "MANUAL", "awb_number": "M100"},
                 headers={**h2, "Idempotency-Key": "k-1"})
    assert r2.json()["data"]["id"] == sid


def test_book_uncredentialed_provider_fails_clean():
    c, h, pid = _env()
    r = c.post(f"/api/v1/shipments/{pid}/book", json={"carrier_code": "DTDC"}, headers=h)
    assert r.status_code == 400
    assert "CARRIER_NOT_CONNECTED" in r.text


def _env_connected(phone="+91-900000003", carrier="DTDC"):
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.customer import Customer
    from app.models.payment import Payment
    from app.models.parcel import Parcel
    from app.models.shipment import CarrierConnection
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
    c = Customer(business_id=b.id, first_name="R", phone=phone)
    db.add(c)
    db.commit()
    db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-BK2", shopify_order_id="gid://bk2",
              shopify_order_name="#BK2", currency="INR", total_amount=500.0, financial_status="PAID",
              operational_status="NEW", customer_id=c.id, order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    db.add(Payment(business_id=b.id, order_id=o.id, amount=500.0, payment_status="PAID", method="COD"))
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="CREATED")
    db.add(p)
    db.commit()
    db.refresh(p)
    pid = p.id
    db.add(CarrierConnection(business_id=b.id, carrier_code=carrier, credentials_encrypted="enc",
                             environment="LIVE", is_active=True))
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    t = TestClient(app)
    tok = t.post("/api/v1/auth/login", json={"email": "w@t.in", "password": "x"}).json()["data"]["token"]
    return t, {"Authorization": f"Bearer {tok}"}, pid


def test_book_connected_carrier_requires_awb():
    c, h, pid = _env_connected()
    r = c.post(f"/api/v1/shipments/{pid}/book", json={"carrier_code": "DTDC"}, headers=h)
    assert r.status_code == 400
    assert "AWB_REQUIRED" in r.text


def test_book_connected_carrier_with_awb():
    c, h, pid = _env_connected()
    r = c.post(f"/api/v1/shipments/{pid}/book",
               json={"carrier_code": "DTDC", "awb_number": "D100"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["awb_number"] == "D100"


def test_ndr_reattempt_opens_case():
    c, h, pid = _env()
    sid = c.post(f"/api/v1/shipments/{pid}/book",
                 json={"carrier_code": "MANUAL", "awb_number": "M300"}, headers=h).json()["data"]["id"]
    n = c.post(f"/api/v1/shipments/{sid}/ndr", json={"action": "reattempt", "reason": "door locked"}, headers=h)
    assert n.status_code == 200
    assert n.json()["data"]["tracking_status"] == "NDR_REATTEMPT"
    items = c.get("/api/v1/cases", headers=h).json()["data"]["items"]
    match = [x for x in items if x["shipment_id"] == sid and x["case_type"] == "DELIVERY_EXCEPTION"]
    assert len(match) == 1
    assert match[0]["priority"] == "HIGH"


def test_cancel_and_ndr():
    c, h, pid = _env()
    sid = c.post(f"/api/v1/shipments/{pid}/book",
                 json={"carrier_code": "MANUAL", "awb_number": "M200"}, headers=h).json()["data"]["id"]
    r = c.post(f"/api/v1/shipments/{sid}/cancel", json={"reason": "wrong carrier"}, headers=h)
    assert r.status_code == 200
    assert c.post(f"/api/v1/shipments/{sid}/cancel", json={"reason": "x"}, headers=h).status_code == 400
    c2, h2, pid2 = _env()
    sid2 = c2.post(f"/api/v1/shipments/{pid2}/book",
                   json={"carrier_code": "MANUAL", "awb_number": "M201"}, headers=h2).json()["data"]["id"]
    n = c2.post(f"/api/v1/shipments/{sid2}/ndr", json={"action": "reattempt", "reason": "door locked"}, headers=h2)
    assert n.status_code == 200
    assert n.json()["data"]["tracking_status"] == "NDR_REATTEMPT"
    t = c2.post(f"/api/v1/shipments/{sid2}/ndr", json={"action": "return"}, headers=h2)
    assert t.json()["data"]["tracking_status"] == "RTO_INITIATED"
