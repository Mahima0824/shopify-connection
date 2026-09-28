# backend/tests/test_dashboard.py
import pytest
from test_returns import _mk
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import app.models
from app.database import Base, get_db
from app.main import app
from app.models.business import Business
from app.models.user import User
from app.services.auth_service import hash_password

def test_dashboard_summary():
    from app.services.dashboard_service import get_dashboard_summary
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    
    # Add a refund row
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="r100", amount=50.0, currency="INR", status="COMPLETED"))
    db.commit()
    
    res = get_dashboard_summary(db, b.id)
    assert res["kpis"]["orders_total"] >= 1
    assert res["financials"]["gross_sales"] > 0
    assert res["financials"]["total_refunds"] == 50.0
    assert "reconciled_rate" in res["kpis"]

def test_dashboard_api_endpoint():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    b = Business(name="Biz Dashboard", email="bizdash@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="Dash User", email="dash@t.in", password_hash=hash_password("Pass123!"), role="ADMIN")
    db.add(u)
    db.commit()
    db.close()
    
    app.dependency_overrides[get_db] = lambda: Session()
    c = TestClient(app)
    r_login = c.post("/api/v1/auth/login", json={"email": "dash@t.in", "password": "Pass123!"})
    token = r_login.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    r = c.get("/api/v1/dashboard/summary", headers=headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert "kpis" in data
    assert "financials" in data
