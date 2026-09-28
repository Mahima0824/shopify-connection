# backend/tests/test_scan_idempotency.py
from test_returns import _mk


def test_dispatch_retry_same_id_no_second_event():
    from app.services.scanning_service import dispatch_parcel
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    from app.models.order import Order
    # _mk already dispatches without a key; build a fresh undispatched parcel
    # by reusing _mk's business/user/order but a second parcel path is heavy —
    # instead seed fresh via service on a new order.
    db, b, u, o, i, p = _mk()
    from datetime import datetime, timezone
    from app.models.order import Order as O, OrderItem as OI
    from app.services.barcode_service import ensure_parcel_for_order
    o2 = O(business_id=b.id, internal_order_number="ORD-IDEM", shopify_order_id="gid://idem",
           shopify_order_name="#IDEM", currency="INR", subtotal_amount=100.0,
           total_amount=100.0, payment_status="PAID", financial_status="PAID",
           fulfillment_status="UNFULFILLED", operational_status="NEW",
           order_date=datetime.now(timezone.utc))
    db.add(o2); db.commit(); db.refresh(o2)
    i2 = OI(business_id=b.id, order_id=o2.id, title="Cap", sku="CP-1", quantity=1, price=100.0)
    db.add(i2); db.commit(); db.refresh(i2)
    p2 = ensure_parcel_for_order(db, o2.id)
    a = dispatch_parcel(db, b.id, p2.barcode_value, u.id, client_scan_id="c1")
    before = db.query(ScanEvent).filter_by(parcel_id=p2.id).count()
    b2 = dispatch_parcel(db, b.id, p2.barcode_value, u.id, client_scan_id="c1")
    after = db.query(ScanEvent).filter_by(parcel_id=p2.id).count()
    assert after == before and b2["parcel"]["status"] == "DISPATCHED"


def _seed_rto():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models.business  # noqa: F401
    import app.models.user  # noqa: F401
    import app.models.order  # noqa: F401
    import app.models.parcel  # noqa: F401
    import app.models.scan_event  # noqa: F401
    import app.models.return_record  # noqa: F401
    import app.models.audit_log  # noqa: F401
    from app.main import app
    from app.database import get_db
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order, OrderItem
    from app.services.auth_service import hash_password
    from app.services.barcode_service import ensure_parcel_for_order
    from app.services.scanning_service import dispatch_parcel
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u); db.commit(); db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-RTO", shopify_order_id="gid://rto",
              shopify_order_name="#RTO", currency="INR", subtotal_amount=100.0,
              total_amount=100.0, payment_status="PAID", financial_status="PAID",
              fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    it = OrderItem(business_id=b.id, order_id=o.id, title="Hat", sku="HT-1", quantity=1, price=100.0)
    db.add(it); db.commit(); db.refresh(it)
    p = ensure_parcel_for_order(db, o.id)
    dispatch_parcel(db, b.id, p.barcode_value, u.id)
    code = p.barcode_value
    pid = p.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "w@t.in", "password": "x"}).json()["data"]["token"]
    return c, tok, mk, code, pid


def test_rto_endpoint():
    from app.models.parcel import Parcel
    from app.models.order import Order
    from app.models.scan_event import ScanEvent
    c, tok, mk, code, pid = _seed_rto()
    r = c.post("/api/v1/scan/rto", json={"barcode": code, "condition": "GOOD"},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    db = mk()
    try:
        p = db.query(Parcel).filter_by(id=pid).first()
        o = db.query(Order).filter_by(id=p.order_id).first()
        assert p.status == "RETURN_RECEIVED"
        assert o.operational_status == "RTO"
        assert db.query(ScanEvent).filter_by(parcel_id=pid, event_type="RTO_RECEIVED").count() == 1
    finally:
        db.close()


def test_reprint_writes_audit():
    from app.models.audit_log import AuditLog
    c, tok, mk, code, pid = _seed_rto()
    r = c.post(f"/api/v1/parcels/{pid}/reprint", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["reprint"] is True and "label" in body["label_url"]
    db = mk()
    try:
        assert db.query(AuditLog).filter_by(
            entity_type="parcel", entity_id=pid, action="LABEL_REPRINTED").count() == 1
    finally:
        db.close()
