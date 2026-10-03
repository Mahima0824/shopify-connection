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


def _post(c, payload: dict, secret: str = SECRET, ts: str | None = "AUTO",
          bid: str | None = None):
    raw = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "X-ShipSagar-Signature": sig}
    if ts == "AUTO":  # strict replay guard: real webhooks always carry a timestamp
        from datetime import timezone as _tz
        ts = str(datetime.now(_tz.utc).timestamp())
    if ts is not None:
        headers["X-ShipSagar-Timestamp"] = ts
    if bid is not None:
        headers["X-Business-Id"] = bid
    return c.post("/api/webhooks/shipsagar", content=raw, headers=headers)


def _authed(monkeypatch, mk, role="ADMIN", email="a@t.in"):
    """Business + user + login token for authed endpoint tests."""
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = Business(name="B", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email=email,
             password_hash=hash_password("x"), role=role)
    db.add(u)
    db.commit()
    bid = b.id
    db.close()
    c = _client(monkeypatch, mk)
    tok = c.post("/api/v1/auth/login",
                 json={"email": email, "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}, bid


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
    sid, bid = _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        body = {"event_id": "ss-evt-1", "tracking_number": "EM123456789IN",
                "courier": "INDIA_POST", "status": "Out for Delivery",
                "location": "Delhi SP", "message": "OFD",
                "event_time": datetime.now(timezone.utc).isoformat()}
        r1 = _post(c, body, bid=bid)
        assert r1.status_code == 200, r1.text
        assert r1.json()["data"]["created"] is True
        assert r1.json()["data"]["stale"] is False
        assert r1.json()["data"]["tracking_status"] == "OUT_FOR_DELIVERY"
        r2 = _post(c, body, bid=bid)  # duplicate delivery
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
    _, bid = _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        # missing/unknown tenant scope
        r = _post(c, {"event_id": "e0", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "delivered"})
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNKNOWN_BUSINESS"
        r = _post(c, {"event_id": "e0", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "delivered"}, bid="nope")
        assert r.status_code == 401
        # missing event id
        r = _post(c, {"tracking_number": "EM123456789IN", "courier": "INDIA_POST",
                      "status": "delivered"}, bid=bid)
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "MISSING_EVENT_ID"
        # unknown tracking
        r = _post(c, {"event_id": "e9", "tracking_number": "NOPE999",
                      "courier": "DTDC", "status": "delivered"}, bid=bid)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "SHIPMENT_NOT_FOUND"
        # unsupported courier
        r = _post(c, {"event_id": "e8", "tracking_number": "EM123456789IN",
                      "courier": "FEDEX", "status": "delivered"}, bid=bid)
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "UNSUPPORTED_COURIER"
    finally:
        app.dependency_overrides.clear()


def test_rto_flow(monkeypatch):
    from app.models.shipment import Shipment
    mk = _mk()
    sid, bid = _seed_shipment(mk, carrier="DTDC", awb="D12345")
    c = _client(monkeypatch, mk)
    try:
        assert _post(c, {"event_id": "rto-1", "tracking_number": "D12345",
                         "courier": "DTDC", "status": "In Transit",
                         "event_time": datetime.now(timezone.utc).isoformat()},
                    bid=bid).status_code == 200
        r = _post(c, {"event_id": "rto-2", "tracking_number": "D12345",
                      "courier": "DTDC", "status": "RTO In Transit",
                      "event_time": datetime.now(timezone.utc).isoformat()}, bid=bid)
        assert r.json()["data"]["tracking_status"] == "RTO"
        r = _post(c, {"event_id": "rto-3", "tracking_number": "D12345",
                      "courier": "DTDC", "status": "RTO Delivered back to shipper",
                      "event_time": datetime.now(timezone.utc).isoformat()}, bid=bid)
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


# --- fix round 1/5 ---

def test_webhook_tenant_scoped(monkeypatch):
    """Same AWB in two tenants: webhook resolves only the header tenant."""
    from app.models.business import Business
    from app.models.shipment import Shipment
    mk = _mk()
    sid1, bid1 = _seed_shipment(mk, awb="SHARED-AWB")
    db = mk()
    b2 = Business(name="B2", email="b2@t.in")
    db.add(b2)
    db.commit()
    db.refresh(b2)
    db.add(Shipment(business_id=b2.id, order_id="o9", parcel_id="p9",
                    carrier_code="INDIA_POST", awb_number="SHARED-AWB",
                    tracking_status="READY_TO_SHIP"))
    db.commit()
    bid2 = b2.id
    db.close()
    c = _client(monkeypatch, mk)
    try:
        r = _post(c, {"event_id": "tnt-1", "tracking_number": "SHARED-AWB",
                      "courier": "INDIA_POST", "status": "Out for Delivery",
                      "event_time": datetime.now(timezone.utc).isoformat()}, bid=bid2)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["tracking_status"] == "OUT_FOR_DELIVERY"
        db = mk()
        try:
            assert db.query(Shipment).filter_by(id=sid1).first().tracking_status == "READY_TO_SHIP"
            hit = db.query(Shipment).filter_by(
                business_id=bid2, awb_number="SHARED-AWB").first()
            assert hit.tracking_status == "OUT_FOR_DELIVERY"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_stale_event_never_regresses_terminal(monkeypatch):
    """DELIVERED then IN_TRANSIT (or older event_time) is stored, not applied."""
    from app.models.shipment import Shipment, ShipmentEvent
    mk = _mk()
    sid, bid = _seed_shipment(mk)
    c = _client(monkeypatch, mk)
    try:
        now = datetime.now(timezone.utc)
        r = _post(c, {"event_id": "st-1", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "Item Delivered",
                      "event_time": now.isoformat()}, bid=bid)
        assert r.json()["data"]["tracking_status"] == "DELIVERED"
        assert r.json()["data"]["stale"] is False
        # Rank regress with a NEWER timestamp: still stale.
        from datetime import timedelta as _td
        r = _post(c, {"event_id": "st-2", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "In Transit",
                      "event_time": (now + _td(hours=1)).isoformat()}, bid=bid)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["stale"] is True
        assert r.json()["data"]["tracking_status"] == "DELIVERED"
        # Same-state but OLDER event_time: stale by time guard alone.
        r = _post(c, {"event_id": "st-3", "tracking_number": "EM123456789IN",
                      "courier": "INDIA_POST", "status": "Item Delivered",
                      "event_time": (now - _td(hours=1)).isoformat()}, bid=bid)
        assert r.json()["data"]["stale"] is True
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.tracking_status == "DELIVERED"
            # Stale checkpoints preserved as history, never double-state.
            assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 3
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_retry_drain_marks_done_and_dead_letters(monkeypatch):
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    from app import config
    monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    mk = _mk()
    sid, bid = _seed_shipment(mk, carrier="DTDC", awb="D-DRAIN")
    db = mk()
    try:
        past = datetime.now(timezone.utc) - _td(seconds=5)
        db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                                 shipment_id=sid, attempts=1, max_attempts=4,
                                 status="PENDING", next_retry_at=past))
        db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                                 shipment_id=sid, attempts=1, max_attempts=4,
                                 status="PENDING",
                                 next_retry_at=datetime.now(timezone.utc) + _td(hours=1)))
        db.commit()
        out = ss.drain_retry_queue(db)
        db.commit()
        assert out == {"checked": 1, "succeeded": 1, "requeued": 0, "dead_lettered": 0}
        s = db.query(Shipment).filter_by(id=sid).first()
        assert (s.shipsagar_tracking_id or "").endswith("D-DRAIN")

        # Failure path with exhausted attempts -> DEAD_LETTER, backoff capped.
        monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "https://example.invalid")
        monkeypatch.setattr(config.settings, "shipsagar_api_key", "k")

        def _boom(path, payload):
            raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "boom")

        monkeypatch.setattr(ss, "_post", _boom)
        db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                                 shipment_id=sid, attempts=3, max_attempts=4,
                                 status="PENDING", next_retry_at=past))
        db.commit()
        out = ss.drain_retry_queue(db)
        db.commit()
        assert out["checked"] == 1 and out["dead_lettered"] == 1
        assert db.query(ShipsagarRetryJob).filter_by(status="DEAD_LETTER").count() == 1
    finally:
        db.close()


def test_retry_drain_endpoint_and_register_envelope(monkeypatch):
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        db = mk()
        m = Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                     carrier_code="MANUAL", awb_number="M-ENV",
                     tracking_status="BOOKED")
        d = Shipment(business_id=bid, order_id="o2", parcel_id="p2",
                     carrier_code="DTDC", awb_number="D-ENV",
                     tracking_status="READY_TO_SHIP")
        db.add_all([m, d])
        db.commit()
        mid, did = m.id, d.id
        db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                                 shipment_id=did, attempts=1, max_attempts=4,
                                 status="PENDING",
                                 next_retry_at=datetime.now(timezone.utc) - _td(seconds=5)))
        db.commit()
        db.close()
        # Drain endpoint (stub mode: unconfigured settings from _client).
        r = c.post("/api/v1/shipsagar/retry-drain", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["succeeded"] == 1
        # Register success still works with envelope success shape.
        r = c.post(f"/api/v1/shipments/{did}/register-tracking", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        assert r.json()["data"]["shipsagar_tracking_id"].endswith("D-ENV")
        # Register error is envelope, not HTTPException detail.
        r = c.post(f"/api/v1/shipments/{mid}/register-tracking", headers=h)
        assert r.status_code == 400, r.text
        assert r.json()["success"] is False
        assert r.json()["error"]["code"] == "UNSUPPORTED_COURIER"
        r = c.post("/api/v1/shipments/does-not-exist/register-tracking", headers=h)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "SHIPMENT_NOT_FOUND"
        # Non-admin cannot drain.
        c2, h2, _ = _authed(monkeypatch, mk, role="VIEWER", email="v@t.in")
        r = c2.post("/api/v1/shipsagar/retry-drain", headers=h2)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"
    finally:
        app.dependency_overrides.clear()


# --- settings ---

def test_shipsagar_settings_exist_and_default_to_unconfigured(monkeypatch):
    from app.config import Settings
    # _env_file=None drops dotenv files and delenv drops ambient vars, so these
    # assertions read the declared defaults and cannot be shadowed by real creds.
    for var in ("SHIPSAGAR_TOKEN", "SHIPSAGAR_CLIENT_CODE",
                "SHIPSAGAR_API_KEY", "SHIPSAGAR_API_BASE_URL"):
        monkeypatch.delenv(var, raising=False)
    s = Settings(_env_file=None)
    assert s.shipsagar_token == ""
    assert s.shipsagar_client_code == ""
    # The declared default base URL is the real ShipSagar host.
    assert s.shipsagar_api_base_url == "https://app.shipsagar.com/api/Web"
