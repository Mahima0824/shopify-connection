# backend/tests/test_tally.py
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

def test_tally_mapping_crud():
    from app.services.tally_service import get_or_create_mapping, update_mapping
    db, b, u, o, i, p = _mk()
    m = get_or_create_mapping(db, b.id)
    assert m.voucher_sales == "Sales"
    
    m2 = update_mapping(db, b.id, {"voucher_sales": "Custom Sales"})
    assert m2.voucher_sales == "Custom Sales"

def test_tally_validation_and_export():
    from app.services.tally_service import validate_tally_export, generate_tally_export
    db, b, u, o, i, p = _mk()
    val = validate_tally_export(db, b.id)
    assert val["valid"] is True
    
    out = generate_tally_export(db, b.id, u.id)
    assert "batch" in out
    assert out["batch"]["batch_reference"].startswith("TALLY-")
    assert "Voucher Type" in out["content"].decode()

def test_tally_api_endpoints():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    b = Business(name="Biz Tally", email="biztally@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="Tally User", email="tally@t.in", password_hash=hash_password("Pass123!"), role="ADMIN")
    db.add(u)
    db.commit()
    db.close()
    
    app.dependency_overrides[get_db] = lambda: Session()
    c = TestClient(app)
    r_login = c.post("/api/v1/auth/login", json={"email": "tally@t.in", "password": "Pass123!"})
    token = r_login.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. GET mapping
    r = c.get("/api/v1/tally/mapping", headers=headers)
    assert r.status_code == 200
    assert r.json()["data"]["voucher_sales"] == "Sales"
    
    # 2. PUT mapping
    r = c.put("/api/v1/tally/mapping", json={"voucher_sales": "Export Sales"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["data"]["voucher_sales"] == "Export Sales"
    
    # 3. Validate (#47 gate: empty scope -> nothing to export, no errors)
    r = c.post("/api/v1/tally/validate", headers=headers)
    assert r.status_code == 200
    assert r.json()["data"]["error_count"] == 0
    
    # 4. Export
    r = c.post("/api/v1/tally/export", headers=headers)
    assert r.status_code == 200
    assert "attachment; filename=" in r.headers.get("content-disposition", "")
    
    # 5. Batches
    r = c.get("/api/v1/tally/batches", headers=headers)
    assert r.status_code == 200
    assert len(r.json()["data"]) >= 1
