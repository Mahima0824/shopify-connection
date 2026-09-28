# backend/tests/test_returns.py (fixtures first)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel
import app.models.scan_event, app.models.return_record, app.models.audit_log

def _mk():
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
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u); db.commit(); db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-R1", shopify_order_id="gid://r1",
              shopify_order_name="#R1", currency="INR", subtotal_amount=300.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=300.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    i = OrderItem(business_id=b.id, order_id=o.id, title="Shoes", sku="SH-1", quantity=3, price=100.0)
    db.add(i); db.commit(); db.refresh(i)
    p = ensure_parcel_for_order(db, o.id)
    dispatch_parcel(db, b.id, p.barcode_value, u.id)
    return db, b, u, o, i, p

def test_full_return():
    from app.services.return_service import record_return
    from app.models.scan_event import ScanEvent
    from app.models.audit_log import AuditLog
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert out["return"]["status"] == "RECEIVED"
    assert out["parcel"]["status"] == "RETURN_RECEIVED"
    assert out["order"]["operational_status"] == "RETURN_RECEIVED"
    assert len(out["items"]) == 1 and out["items"][0]["quantity"] == 3
    assert db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="RETURN_RECEIVED").count() == 1
    assert db.query(AuditLog).filter_by(entity_type="parcel", entity_id=p.id, action="RETURN_RECORDED").count() == 1

def test_partial_return():
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "PARTIAL_RETURN", "GOOD",
                        items=[{"order_item_id": i.id, "quantity": 2}])
    assert out["items"][0]["quantity"] == 2

def test_over_qty_rejected():
    from app.services.return_service import record_return, ReturnError
    import pytest
    db, b, u, o, i, p = _mk()
    with pytest.raises(ReturnError) as e:
        record_return(db, b.id, p.barcode_value, u.id, "PARTIAL_RETURN", "GOOD",
                      items=[{"order_item_id": i.id, "quantity": 5}])
    assert e.value.code == "RETURN_QUANTITY_MISMATCH"

def test_duplicate_blocked():
    from app.services.return_service import record_return, ReturnError
    import pytest
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    with pytest.raises(ReturnError) as e:
        record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert e.value.code == "RETURN_ALREADY_RECORDED"

def test_rto_sets_rto_status():
    from app.services.return_service import record_return
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    out = record_return(db, b.id, p.barcode_value, u.id, "RTO", "USED")
    assert out["order"]["operational_status"] == "RTO"
    assert db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="RTO_RECEIVED").count() == 1
