# backend/tests/test_export.py
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

def test_export_excel_csv():
    from app.services.export_service import generate_excel_workbook
    db, b, u, o, i, p = _mk()
    content = generate_excel_workbook(db, b.id)
    assert isinstance(content, (bytes, str))
    text = content.decode() if isinstance(content, bytes) else content
    assert "SECTION: ORDERS" in text
    assert o.shopify_order_name in text

def test_export_endpoint():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    b = Business(name="Biz Export", email="bizexp@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="Exp User", email="exp@t.in", password_hash=hash_password("Pass123!"), role="ADMIN")
    db.add(u)
    db.commit()
    db.close()
    
    app.dependency_overrides[get_db] = lambda: Session()
    c = TestClient(app)
    r_login = c.post("/api/v1/auth/login", json={"email": "exp@t.in", "password": "Pass123!"})
    token = r_login.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    r = c.get("/api/v1/export/excel", headers=headers)
    assert r.status_code == 200
    assert "attachment; filename=" in r.headers.get("content-disposition", "")
