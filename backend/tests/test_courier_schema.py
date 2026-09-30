# backend/tests/test_courier_schema.py
def test_idempotency_unique():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.exc import IntegrityError
    import pytest
    from app.database import Base
    import app.models.business, app.models.courier_meta
    from app.models.business import Business
    from app.models.courier_meta import BookingIdempotency
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    db.add(BookingIdempotency(business_id=b.id, key="k1", shipment_id="s1"))
    db.commit()
    db.add(BookingIdempotency(business_id=b.id, key="k1", shipment_id="s2"))
    with pytest.raises(IntegrityError):
        db.commit()

def test_rto_delivered_terminal():
    from app.services.shipment_service import TERMINAL
    assert "RTO_DELIVERED" in TERMINAL
