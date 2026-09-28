"""Idempotency test: re-syncing the same Shopify payload creates no duplicates."""

import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (populate Base.metadata)
from app.database import Base
from app.models.business import Business
from app.models.order import Order
from app.services.shopify_service import upsert_order

FIXTURE = Path(__file__).parent / "fixtures" / "shopify_orders.json"


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_upsert_idempotent():
    db = _session()
    b = Business(name="Test Biz", email="t@example.com")
    db.add(b)
    db.commit()
    db.refresh(b)
    payloads = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(payloads) >= 2
    payload = payloads[0]

    id1 = upsert_order(db, b.id, payload)
    id2 = upsert_order(db, b.id, payload)

    assert id1 == id2
    assert db.query(Order).filter_by(business_id=b.id).count() == 1
    o = db.query(Order).filter_by(id=id1).first()
    assert o.operational_status == "NEW"
    assert float(o.total_amount) == float(payload["total_price"])
    db.close()


def test_second_order_creates_distinct_row():
    db = _session()
    b = Business(name="Test Biz", email="t@example.com")
    db.add(b)
    db.commit()
    db.refresh(b)
    payloads = json.loads(FIXTURE.read_text(encoding="utf-8"))
    id1 = upsert_order(db, b.id, payloads[0])
    id2 = upsert_order(db, b.id, payloads[1])
    assert id1 != id2
    assert db.query(Order).filter_by(business_id=b.id).count() == 2
    db.close()
