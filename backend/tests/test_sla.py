# backend/tests/test_sla.py
from datetime import datetime, timedelta, timezone


def test_sla_bands():
    from app.services.sla_service import sla_status
    now = datetime.now(timezone.utc)
    mk = lambda start, allowed, warn: {"start": start, "allowed_days": allowed, "warning_days": warn}
    assert sla_status(mk(now - timedelta(days=1), 45, 7), now)["status"] == "NORMAL"
    assert sla_status(mk(now - timedelta(days=40), 45, 7), now)["status"] == "APPROACHING"
    assert sla_status(mk(now - timedelta(days=46), 45, 7), now)["status"] == "BREACHED"


def test_sla_no_start_never_breaches():
    from app.services.sla_service import sla_status
    now = datetime.now(timezone.utc)
    out = sla_status({"start": None, "allowed_days": 45, "warning_days": 7}, now)
    assert out["status"] == "NORMAL" and out["deadline"] is None


def test_money_no_double_count():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models.business
    import app.models.user
    import app.models.order
    import app.models.sla
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial
    from app.services.auth_service import hash_password
    from app.services.money_service import money_at_risk
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    o = Order(business_id=b.id, internal_order_number="ORD-M1", shopify_order_id="gid://m1",
              shopify_order_name="#M1", currency="INR", total_amount=1500.0, financial_status="PAID",
              operational_status="DISPATCHED", order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    db.add(Payment(business_id=b.id, order_id=o.id, amount=1500.0, payment_status="PAID", method="COD"))
    db.add(Shipment(business_id=b.id, order_id=o.id, parcel_id="p1", carrier_code="DTDC",
                    awb_number="D900", tracking_status="RTO_INITIATED",
                    rto_at=datetime.now(timezone.utc) - timedelta(days=50)))
    db.add(ShipmentFinancial(business_id=b.id, shipment_id="s1", order_id=o.id,
                             expected_cod_amount=1500.0, status="EXPECTED"))
    db.commit()
    out = money_at_risk(db, b.id)
    assert out["total"] == 1500.0
    db.close()
