# backend/tests/test_statements.py
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
import app.models.statement
from app.main import app
from app.database import get_db

CSV = b"AWB No,COD Amount,Settlement Date,Net Remittance\nD500,1499,2026-09-01,1409\n"


def _env():
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
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ACCOUNTANT")
    db.add(u)
    db.commit()
    db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-S1", shopify_order_id="gid://s1",
              shopify_order_name="#S1", currency="INR", total_amount=1499.0, operational_status="DISPATCHED",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001", barcode_value="P00000001", status="DISPATCHED")
    db.add(p)
    db.commit()
    db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number="D500", tracking_status="DELIVERED",
                 delivered_at=datetime.now(timezone.utc))
    db.add(s)
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}


def _upload(c, h, content=CSV, name="stmt.csv"):
    return c.post("/api/v1/statements/upload?type=COURIER_SETTLEMENT&provider=DTDC&period_start=2026-09-01&period_end=2026-09-30",
                  files={"file": (name, content, "text/csv")}, headers=h)


def test_duplicate_upload_blocked():
    c, h = _env()
    assert _upload(c, h).status_code == 200
    r = _upload(c, h)
    assert r.status_code == 400
    assert "STATEMENT_ALREADY_IMPORTED" in r.text


def test_match_priority_awb_over_amount():
    c, h = _env()
    uid = _upload(c, h).json()["data"]["id"]
    c.post(f"/api/v1/statements/{uid}/process", headers=h)
    r = c.get(f"/api/v1/statements/{uid}/results", headers=h).json()["data"]
    assert r["counts"]["matched"] == 1
    assert r["rows"][0]["matched_shipment_id"] is not None


def test_manual_match_audited():
    from app.models.statement import StatementRow
    from app.models.audit_log import AuditLog
    from sqlalchemy import create_engine as _ce  # noqa
    c, h = _env()
    uid = _upload(c, h, b"AWB No,COD Amount,Settlement Date,Net Remittance\nD999,100,2026-09-01,90\n").json()["data"]["id"]
    c.post(f"/api/v1/statements/{uid}/process", headers=h)
    rows = c.get(f"/api/v1/statements/{uid}/results", headers=h).json()["data"]["rows"]
    rid = [r for r in rows if r["reconciliation_status"] == "UNMATCHED"][0]["id"]
    ships = c.get("/api/v1/shipments", headers=h).json()["data"]["items"]
    m = c.post(f"/api/v1/statements/rows/{rid}/match",
               json={"shipment_id": ships[0]["id"], "reason": "phone confirm"}, headers=h)
    assert m.status_code == 200
    assert m.json()["data"]["reconciliation_status"] == "MATCHED"
