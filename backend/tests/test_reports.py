# backend/tests/test_reports.py
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business
import app.models.user
import app.models.order
import app.models.cost
from app.main import app
from app.database import get_db


def _env():
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.cost import CostRule
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
    o = Order(business_id=b.id, internal_order_number="ORD-RP1", shopify_order_id="gid://rp1",
              shopify_order_name="#RP1", currency="INR", subtotal_amount=1000.0, discount_amount=100.0,
              shipping_amount=50.0, tax_amount=90.0, total_amount=1040.0, financial_status="PAID",
              operational_status="DISPATCHED",
              order_date=datetime(2026, 9, 10, tzinfo=timezone.utc))
    db.add(o)
    db.commit()
    db.add(CostRule(business_id=b.id, key="SHIPPING", amount=50.0, source="MANUAL",
                    effective_from=datetime(2026, 9, 1, tzinfo=timezone.utc)))
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}


def test_monthly_sections():
    c, h = _env()
    d = c.get("/api/v1/reports/monthly?month=2026-09", headers=h).json()["data"]
    for k in ("orders", "courier", "returns", "money", "exceptions", "costs", "profitability"):
        assert k in d, k
    assert d["orders"]["total"] == 1


def test_pnl_estimated_label():
    c, h = _env()
    p = c.get("/api/v1/reports/monthly?month=2026-09", headers=h).json()["data"]["profitability"]
    assert p["label"] == "ESTIMATED OPERATING PROFIT"


def test_cost_history_freezes():
    c, h = _env()
    before = c.get("/api/v1/reports/monthly?month=2026-09", headers=h).json()["data"]["costs"]["total"]
    c.put("/api/v1/reports/costs", json={"items": [
        {"key": "SHIPPING", "amount": 200.0, "source": "MANUAL", "effective_from": "2026-10-01T00:00:00+00:00"}]},
        headers=h)
    after = c.get("/api/v1/reports/monthly?month=2026-09", headers=h).json()["data"]["costs"]["total"]
    assert before == after
