from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event
import app.models.return_record, app.models.audit_log

def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()

def test_audit_append():
    from app.models.business import Business
    from app.services.audit_service import log_audit
    db = _db()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    a = log_audit(db, b.id, None, "order", "oid-1", "TEST_ACTION", {"s": "NEW"}, {"s": "DISPATCHED"})
    assert a.id is not None
    assert a.action == "TEST_ACTION"
