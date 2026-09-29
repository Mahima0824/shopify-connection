# backend/tests/test_lifecycle.py
from test_returns import _mk


def test_dispatch_closed_blocked():
    from app.services.scanning_service import dispatch_parcel, ScanError
    import pytest
    db, b, u, o, i, p = _mk()
    p.status = "CLOSED"
    db.commit()
    with pytest.raises(ScanError) as e:
        dispatch_parcel(db, b.id, p.barcode_value, u.id)
    assert e.value.code == "PARCEL_CLOSED"


def test_return_closed_blocked():
    from app.services.return_service import record_return, ReturnError
    import pytest
    db, b, u, o, i, p = _mk()  # fixture parcel already dispatched
    p.status = "CLOSED"
    db.commit()
    with pytest.raises(ReturnError) as e:
        record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert e.value.code == "PARCEL_CLOSED"


def test_inspect_and_close_flow():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models.business
    import app.models.user
    import app.models.order
    import app.models.return_record
    from app.main import app
    from app.database import get_db
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.services.auth_service import hash_password
    from datetime import datetime, timezone
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
    o = Order(business_id=b.id, internal_order_number="ORD-L1", shopify_order_id="gid://l1",
              shopify_order_name="#L1", currency="INR", operational_status="DISPATCHED",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    from app.services.barcode_service import ensure_parcel_for_order
    from app.services.scanning_service import dispatch_parcel
    from app.services.return_service import record_return
    p = ensure_parcel_for_order(db, o.id)
    dispatch_parcel(db, b.id, p.barcode_value, u.id)
    out = record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    rid = out["return"]["id"]
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    try:
        c = TestClient(app)
        tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = c.post(f"/api/v1/returns/{rid}/inspect", json={"condition": "GOOD"}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "INSPECTED"
        r2 = c.post(f"/api/v1/parcels/{p.id}/close", json={"reason": "lifecycle complete"}, headers=h)
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["status"] == "CLOSED"
        from app.models.audit_log import AuditLog
        db2 = mk()
        try:
            assert db2.query(AuditLog).filter_by(entity_id=p.id, action="PARCEL_CLOSED").count() == 1
            assert db2.query(AuditLog).filter_by(entity_id=rid, action="RETURN_INSPECTED").count() == 1
        finally:
            db2.close()
    finally:
        app.dependency_overrides.clear()
