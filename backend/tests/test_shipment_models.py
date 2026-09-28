# backend/tests/test_shipment_models.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.shipment


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_awb_unique_per_business():
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models.business import Business
    from app.models.shipment import Shipment
    db = _db()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    db.add(Shipment(business_id=b.id, order_id="o1", parcel_id="p1", carrier_code="DTDC", awb_number="D1", tracking_status="BOOKED"))
    db.commit()
    db.add(Shipment(business_id=b.id, order_id="o2", parcel_id="p2", carrier_code="DTDC", awb_number="D1", tracking_status="BOOKED"))
    with pytest.raises(IntegrityError):
        db.commit()
