# backend/tests/test_shipsagar.py — SDD Task 4: ShipSagar integration.
import hashlib
import hmac
import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.models  # noqa: F401 — register all models
from app.main import app
from app.database import get_db

SECRET = "shipsagar-test-secret"


def _sig(raw: bytes) -> str:
    return hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()


def _mk():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)


def _seed_shipment(mk, carrier="INDIA_POST", awb="EM123456789IN"):
    from app.models.business import Business
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    s = Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                 carrier_code=carrier, awb_number=awb, tracking_status="READY_TO_SHIP")
    db.add(s)
    db.commit()
    db.refresh(s)
    sid, bid = s.id, b.id
    db.close()
    return sid, bid


def _client(monkeypatch, mk):
    from app import config
    monkeypatch.setattr(config.settings, "shipsagar_webhook_secret", SECRET)
    monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    return c


def _post(c, payload: dict, secret: str = SECRET, ts: str | None = None):
    raw = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "X-ShipSagar-Signature": sig}
    if ts is not None:
        headers["X-ShipSagar-Timestamp"] = ts
    return c.post("/api/webhooks/shipsagar", content=raw, headers=headers)


# --- status normalization matrix (both couriers -> plan #15 vocabulary) ---

def test_normalization_matrix():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    cases = [
        ("INDIA_POST", "Item Booked at Mumbai NSH", "READY_TO_SHIP"),
        ("INDIA_POST", "Item Dispatched to Delhi", "IN_TRANSIT"),
        ("INDIA_POST", "Reached Hub Kolkata", "IN_TRANSIT"),
        ("INDIA_POST", "Out for Delivery", "OUT_FOR_DELIVERY"),
        ("INDIA_POST", "Item Delivered to consignee", "DELIVERED"),
        ("INDIA_POST", "Delivery Attempted - Door Locked", "FAILED_ATTEMPT"),
        ("INDIA_POST", "Undelivered - Consignee Absent", "FAILED_ATTEMPT"),
        ("INDIA_POST", "RTO - Return to Sender booked", "RTO"),
        ("INDIA_POST", "Returned to Sender, delivered back", "RETURNED"),
        ("INDIA_POST", "Article Lost in transit", "LOST"),
        ("INDIA_POST", "Item Damaged at hub", "EXCEPTION"),
        ("DTDC", "Manifested at origin", "READY_TO_SHIP"),
        ("DTDC", "In Transit to destination", "IN_TRANSIT"),
        ("DTDC", "Out For Delivery", "OUT_FOR_DELIVERY"),
        ("DTDC", "Delivered Successfully", "DELIVERED"),
        ("DTDC", "Consignee Not Available", "FAILED_ATTEMPT"),
        ("DTDC", "Delivery Failed - Address Incorrect", "FAILED_ATTEMPT"),
        ("DTDC", "RTO In Transit", "RTO"),
        ("DTDC", "RTO Delivered back to shipper", "RETURNED"),
        ("DTDC", "Shipment Lost", "LOST"),
        ("DTDC", "On Hold - Exception", "EXCEPTION"),
        ("DTDC", "Some future unknown phrase xyz", "EXCEPTION"),
        ("INDIA_POST", "", "NOT_CREATED"),
        ("UNKNOWN_COURIER", "delivered", "EXCEPTION"),
    ]
    for courier, raw, expected in cases:
        assert norm(courier, raw) == expected, (courier, raw)


# --- webhook security ---

def test_bad_signature_rejected_and_stored(monkeypatch):
    from app.models.shipment_event import ShipsagarWebhookFailure
    mk = _mk()
    sid, _ = _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        r = _post(c, {"event_id": "e1", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "delivered"},
                  secret="wrong-secret")
        assert r.status_code == 401, r.text
        assert r.json()["success"] is False
        assert r.json()["error"]["code"] == "INVALID_SIGNATURE"
        db = mk()
        try:
            assert db.query(ShipsagarWebhookFailure).filter_by(
                reason="INVALID_SIGNATURE").count() == 1
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_stale_timestamp_rejected(monkeypatch):
    mk = _mk()
    _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        r = _post(c, {"event_id": "e1", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "delivered"}, ts="1")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "STALE_TIMESTAMP"
    finally:
        app.dependency_overrides.clear()


# --- webhook happy path + idempotency ---

def test_webhook_ingest_and_duplicate_delivery(monkeypatch):
    from app.models.shipment import Shipment, ShipmentEvent
    mk = _mk()
    sid, _ = _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        body = {"event_id": "ss-evt-1", "tracking_number": "EM123456789IN",
                "courier": "INDIA_POST", "status": "Out for Delivery",
                "location": "Delhi SP", "message": "OFD",
                "event_time": datetime.now(timezone.utc).isoformat()}
        r1 = _post(c, body)
        assert r1.status_code == 200, r1.text
        assert r1.json()["data"]["created"] is True
        assert r1.json()["data"]["tracking_status"] == "OUT_FOR_DELIVERY"
        r2 = _post(c, body)  # duplicate delivery
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["created"] is False
        assert r2.json()["data"]["deduped"] is True
        db = mk()
        try:
            assert db.query(ShipmentEvent).filter_by(
                provider="SHIPSAGAR", provider_event_id="ss-evt-1").count() == 1
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.tracking_status == "OUT_FOR_DELIVERY"
            assert s.current_location == "Delhi SP"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_webhook_validation_errors(monkeypatch):
    mk = _mk()
    _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        # missing event id
        r = _post(c, {"tracking_number": "EM123456789IN", "courier": "INDIA_POST",
                      "status": "delivered"})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "MISSING_EVENT_ID"
        # unknown tracking
        r = _post(c, {"event_id": "e9", "tracking_number": "NOPE999",
                      "courier": "DTDC", "status": "delivered"})
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "SHIPMENT_NOT_FOUND"
        # unsupported courier
        r = _post(c, {"event_id": "e8", "tracking_number": "EM123456789IN",
                      "courier": "FEDEX", "status": "delivered"})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "UNSUPPORTED_COURIER"
    finally:
        app.dependency_overrides.clear()


def test_rto_flow(monkeypatch):
    from app.models.shipment import Shipment
    mk = _mk()
    sid, _ = _seed_shipment(mk, carrier="DTDC", awb="D12345")
    c = _client(monkeypatch, mk)
    try:
        assert _post(c, {"event_id": "rto-1", "tracking_number": "D12345",
                         "courier": "DTDC", "status": "In Transit",
                         "event_time": datetime.now(timezone.utc).isoformat()}).status_code == 200
        r = _post(c, {"event_id": "rto-2", "tracking_number": "D12345",
                      "courier": "DTDC", "status": "RTO In Transit",
                      "event_time": datetime.now(timezone.utc).isoformat()})
        assert r.json()["data"]["tracking_status"] == "RTO"
        r = _post(c, {"event_id": "rto-3", "tracking_number": "D12345",
                      "courier": "DTDC", "status": "RTO Delivered back to shipper",
                      "event_time": datetime.now(timezone.utc).isoformat()})
        assert r.json()["data"]["tracking_status"] == "RETURNED"
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.rto_at is not None
            assert s.returned_at is not None
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


# --- registration + retry + health ---

def test_register_tracking_stub_keeps_identity_chain(monkeypatch):
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    from app import config
    monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    mk = _mk()
    sid, _ = _seed_shipment(mk)
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        out = ss.register_tracking(db, s)
        assert out["stubbed"] is True
        assert out["shipsagar_tracking_id"].endswith("EM123456789IN")
        assert s.shipsagar_tracking_id == out["shipsagar_tracking_id"]
        assert s.tracking_status == "READY_TO_SHIP"
        # Business id is still the internal shipment id, never the ShipSagar id.
        assert s.id == sid != s.shipsagar_tracking_id
    finally:
        db.close()


def test_retry_backoff_and_dead_letter():
    from app.services.shipsagar_service import backoff_for_attempt, schedule_retry, record_retry_attempt
    assert backoff_for_attempt(1) == 30
    assert backoff_for_attempt(2) == 120
    assert backoff_for_attempt(3) == 600
    assert backoff_for_attempt(4) is None
    mk = _mk()
    db = mk()
    try:
        job = schedule_retry(db, business_id=None, operation="register_tracking",
                             shipment_id=None, error="boom")
        assert job.status == "PENDING" and job.attempts == 1
        record_retry_attempt(db, job, "boom2")
        record_retry_attempt(db, job, "boom3")
        assert job.status == "PENDING"
        record_retry_attempt(db, job, "boom4")
        assert job.status == "DEAD_LETTER" and job.next_retry_at is None
    finally:
        db.close()


def test_health_endpoint_counts(monkeypatch):
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    mk = _mk()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in",
             password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    bid = b.id
    db.close()
    from app.models.shipment import Shipment
    db = mk()
    db.add(Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                    carrier_code="DTDC", awb_number="D777",
                    tracking_status="READY_TO_SHIP"))
    db.commit()
    db.close()
    c = _client(monkeypatch, mk)
    try:
        tok = c.post("/api/v1/auth/login",
                     json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
        r = c.get("/api/v1/shipsagar/health",
                  headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["provider"] == "SHIPSAGAR"
        assert data["unregistered_shipments"] == 1
        assert "failed_webhooks" in data and "failed_jobs" in data
    finally:
        app.dependency_overrides.clear()
