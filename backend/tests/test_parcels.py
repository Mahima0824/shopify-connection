from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event

def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()

def _biz(db):
    from app.models.business import Business
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b); return b

def test_generate_barcode_sequence():
    from app.services.barcode_service import generate_barcode
    from app.models.parcel import Parcel
    db = _db(); b = _biz(db)
    c1 = generate_barcode(db, b.id)
    # generate_barcode is a pure query: persist a parcel before asking for next code.
    db.add(Parcel(business_id=b.id, order_id="seed", parcel_code=c1, barcode_value=c1, status="CREATED"))
    db.commit()
    c2 = generate_barcode(db, b.id)
    assert c1 == "P00000001"
    assert c2 == "P00000002"

def test_ensure_parcel_idempotent():
    from app.models.order import Order
    from app.services.barcode_service import ensure_parcel_for_order
    from datetime import datetime, timezone
    db = _db(); b = _biz(db)
    o = Order(business_id=b.id, internal_order_number="ORD-1", shopify_order_id="gid://1",
              shopify_order_name="#1", currency="INR", subtotal_amount=100.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=100.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    p1 = ensure_parcel_for_order(db, o.id)
    p2 = ensure_parcel_for_order(db, o.id)
    assert p1.id == p2.id
    assert p1.barcode_value == "P00000001"
