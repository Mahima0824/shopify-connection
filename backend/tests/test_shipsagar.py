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
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
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
        ("UNKNOWN_COURIER", "delivered", "DELIVERED"),
    ]
    for courier, raw, expected in cases:
        assert norm(courier, raw) == expected, (courier, raw)


# --- generic courier fallback matrix ---

def test_generic_matrix_covers_non_india_post_couriers():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    cases = [
        ("FEDEX", "Delivered", "DELIVERED"),
        ("FEDEX", "Out for delivery", "OUT_FOR_DELIVERY"),
        ("FEDEX", "In transit", "IN_TRANSIT"),
        ("FEDEX", "Package picked up", "READY_TO_SHIP"),
        ("FEDEX", "Arrived at facility", "IN_TRANSIT"),
        ("FEDEX", "Delivery attempted", "FAILED_ATTEMPT"),
        ("FEDEX", "Returned to sender", "RETURNED"),
        ("FEDEX", "RTO", "RTO"),
        ("FEDEX", "Package lost", "LOST"),
        ("FEDEX", "Damaged", "EXCEPTION"),
        ("IP", "Item Delivered", "DELIVERED"),
        ("IP", "Item Booked", "READY_TO_SHIP"),
        ("IP", "Undelivered", "FAILED_ATTEMPT"),
    ]
    for courier, raw, expected in cases:
        assert norm(courier, raw) == expected, f"{courier}/{raw}"


def test_generic_matrix_still_falls_back_to_exception():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "some future unknown phrase xyz") == "EXCEPTION"
    assert norm("FEDEX", "") == "NOT_CREATED"


def test_generic_matrix_does_not_shadow_courier_specific_rows():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    # "undelivered" must win over "delivered" for every courier.
    assert norm("FEDEX", "Undelivered") == "FAILED_ATTEMPT"
    assert norm("INDIA_POST", "Undelivered") == "FAILED_ATTEMPT"
    assert norm("DTDC", "Not delivered") == "FAILED_ATTEMPT"


# --- generic fallback: no false positives from substring collisions ---

def test_generic_matrix_rto_does_not_match_carton():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Packed in carton") != "RTO"
    assert norm("FEDEX", "Carton sealed") != "RTO"
    assert norm("IP", "Carton sealed and shipped") == "IN_TRANSIT"


def test_generic_matrix_rto_still_matches_real_rto_phrasings():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    cases = ["RTO", "RTO initiated", "RTO in transit", "RTO Delivered back to shipper",
             "Return to origin", "Returning to origin"]
    for raw in cases:
        assert norm("FEDEX", raw) == "RTO", raw


def test_generic_matrix_redirected_is_not_caught_by_rto():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Redirected to another address") != "RTO"


def test_generic_matrix_consignee_only_fails_on_failure_phrasings():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Delivered to consignee") == "DELIVERED"
    assert norm("FEDEX", "Handed over to consignee") != "FAILED_ATTEMPT"
    assert norm("FEDEX", "Redelivered to consignee") != "FAILED_ATTEMPT"
    for raw in ("Consignee absent at delivery", "Consignee not available",
                "Consignee unavailable", "Consignee refused"):
        assert norm("FEDEX", raw) == "FAILED_ATTEMPT", raw


def test_generic_matrix_negative_phrasings_beat_positive_wrappers():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    cases = [
        ("Out for delivery - undelivered", "FAILED_ATTEMPT"),
        ("Out for delivery - delivery attempted", "FAILED_ATTEMPT"),
        ("Out for delivery - consignee absent", "FAILED_ATTEMPT"),
        ("OFD - undelivered", "FAILED_ATTEMPT"),
        ("Out for delivery - returning to sender", "RETURNED"),
    ]
    for raw, expected in cases:
        assert norm("FEDEX", raw) == expected, raw
    assert norm("FEDEX", "Out for delivery") == "OUT_FOR_DELIVERY"


def test_generic_matrix_orders_negative_rows_before_positive_rows():
    """Structural pin: every negative/return row precedes every positive row."""
    from app.services.shipsagar_service import _GENERIC_MATRIX
    statuses = [status for _, status in _GENERIC_MATRIX]
    negatives = {"FAILED_ATTEMPT", "RETURNED", "RTO"}
    positives = {"DELIVERED", "OUT_FOR_DELIVERY", "IN_TRANSIT", "READY_TO_SHIP"}
    last_negative = max(i for i, s in enumerate(statuses) if s in negatives)
    first_positive = min(i for i, s in enumerate(statuses) if s in positives)
    assert last_negative < first_positive, _GENERIC_MATRIX


def test_generic_matrix_attempt_narrowed_to_fresh_attempts():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Address corrected, reattempt") != "FAILED_ATTEMPT"
    for raw in ("Delivery attempted", "Attempted delivery", "1 delivery attempt",
                "Attempt failed", "2 delivery attempts"):
        assert norm("FEDEX", raw) == "FAILED_ATTEMPT", raw


def test_generic_matrix_covers_returning_ing_forms():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Returning to sender") == "RETURNED"
    assert norm("FEDEX", "Returning to origin") == "RTO"


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
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
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
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
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
        monkeypatch.setattr(config.settings, "shipsagar_token", "TOK")
        monkeypatch.setattr(config.settings, "shipsagar_client_code", "C1001")

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


# --- real ShipSagar client: PushShipment + TrackShipment ---

def _configured(monkeypatch, token="TOK", client_code="C1001"):
    from app import config
    monkeypatch.setattr(config.settings, "shipsagar_token", token)
    monkeypatch.setattr(config.settings, "shipsagar_client_code", client_code)
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")


class _OrderStub:
    internal_order_number = "MAN-AB12CD34"
    shopify_order_name = "#10452"
    receiver_name = "Dileep Kumar"
    receiver_email = "rahul@example.com"
    receiver_mobile = "9963026645"
    receiver_company = "Reshamgath"


def test_is_configured_keys_off_token_and_client_code(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    assert ss.is_configured() is False
    _configured(monkeypatch, token="T", client_code="")
    assert ss.is_configured() is False
    _configured(monkeypatch, token="", client_code="C")
    assert ss.is_configured() is False
    _configured(monkeypatch)
    assert ss.is_configured() is True
    # The base URL is deliberately NOT consulted. It ships with a non-empty
    # default, so keying off it would make stub mode unreachable and every
    # stub-mode test would attempt a live network call.
    monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "")
    assert ss.is_configured() is True


def test_is_configured_accepts_deprecated_api_key_as_token(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "C1001")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "LEGACY")
    assert ss.is_configured() is True


def test_post_sends_token_and_client_code_in_the_body(monkeypatch):
    """Real ShipSagar auth is body-based; no Authorization header is sent."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch, token="TOK9", client_code="C1001")
    seen = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"status": "success", "message": "Data has been recorded successfully"}

    def _fake_post(url, json=None, headers=None, timeout=None):
        seen["url"] = url
        seen["json"] = json
        seen["headers"] = headers
        return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "post", _fake_post)
    out = ss._post("/PushShipment", {"TrackingNo": "EG080960145IN"})
    assert seen["url"] == "https://app.shipsagar.com/api/Web/PushShipment"
    assert seen["json"]["Token"] == "TOK9"
    assert seen["json"]["ClientCode"] == "C1001"
    assert seen["json"]["TrackingNo"] == "EG080960145IN"
    assert not (seen["headers"] or {}).get("Authorization")
    assert out["status"] == "success"


def test_post_raises_api_error_on_http_error_status(monkeypatch):
    """HTTP >= 400 is a transport/API failure the retry queue must see."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)

    class _Resp:
        status_code = 500
        text = "upstream exploded"

    import httpx
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    try:
        ss._post("/PushShipment", {"TrackingNo": "T1"})
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_API_ERROR"
        assert "500" in exc.message


def test_post_raises_bad_response_on_non_json(monkeypatch):
    """A 200 HTML maintenance page is a malformed response, not a result."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)

    class _Resp:
        status_code = 200
        text = "<html>maintenance</html>"

        @staticmethod
        def json():
            raise ValueError("not json")

    import httpx
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    try:
        ss._post("/TrackShipment", {"TrackingNo": "T1"})
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_BAD_RESPONSE"


def test_build_push_payload_maps_every_business_field():
    from app.services.shipsagar_service import build_push_payload
    payload = build_push_payload(
        tracking_no="EG080960145IN", courier_code="ip", order=_OrderStub())
    assert payload["CourierCode"] == "IP"
    assert payload["TrackingNo"] == "EG080960145IN"
    assert payload["OrderNo"] == "MAN-AB12CD34"
    assert payload["CustomerName"] == "Dileep Kumar"
    assert payload["EmailID"] == "rahul@example.com"
    assert payload["MobileNo"] == "9963026645"
    assert payload["ShipmentType"] == "Road"
    assert payload["CountryName"] == "India"
    assert payload["CompanyName"] == "Reshamgath"


def test_build_push_payload_blanks_missing_optional_fields():
    from app.services import shipsagar_service as ss
    o = _OrderStub()
    o.receiver_email = ""
    o.receiver_company = ""
    payload = ss.build_push_payload(tracking_no="T1", courier_code="IP", order=o)
    assert payload["EmailID"] == ""
    assert payload["CompanyName"] == ""


def test_push_shipment_success_and_error_shapes(monkeypatch):
    """Success is lowercase 'success'; failure is uppercase 'Status'/'Message'."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "status": "success", "message": "Data has been recorded successfully"})
    out = ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
    assert out == {"ok": True, "message": "Data has been recorded successfully"}

    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "Status": "ERROR", "Message": "please try again later"})
    out = ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
    assert out["ok"] is False
    assert out["message"] == "please try again later"


def test_push_shipment_raises_when_not_configured(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_NOT_CONFIGURED"


TRACK_OK = {
    "status": "SUCCESS",
    "message": "3 Record Found",
    "TrackingDetails": [{
        "ClientCode": "C1001",
        "TrackingNo": "324049418658",
        "CourierCode": "ATS",
        "TrackingHistory": [
            {"ActionDate": "16-May-2023", "ActionTime": "12:27",
             "ActionLocation": "", "ActionDescription": "Label Created"},
            {"ActionDate": "16-May-2023", "ActionTime": "15:51",
             "ActionLocation": "", "ActionDescription": "Package picked up"},
            {"ActionDate": "16-May-2023", "ActionTime": "19:43",
             "ActionLocation": "New Delhi",
             "ActionDescription": "Package arrived at the carrier facility"},
        ],
    }],
}


def test_track_shipment_flattens_history_and_parses_dates(monkeypatch):
    from datetime import datetime, timezone
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: TRACK_OK)
    out = ss.track_shipment("324049418658")
    assert out["awb"] == "324049418658"
    assert len(out["events"]) == 3
    first = out["events"][0]
    assert first["status_raw"] == "Label Created"
    assert first["location"] == ""
    # ShipSagar timestamps are not ISO; the parser attaches UTC explicitly.
    assert first["event_time"] == datetime(2023, 5, 16, 12, 27, tzinfo=timezone.utc)
    assert out["events"][2]["location"] == "New Delhi"


def test_track_shipment_synthesizes_a_stable_event_id(monkeypatch):
    """ShipSagar sends no event id; the synthetic one makes dedupe work."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: TRACK_OK)
    a = ss.track_shipment("324049418658")
    b = ss.track_shipment("324049418658")
    ids_a = [e["event_id"] for e in a["events"]]
    ids_b = [e["event_id"] for e in b["events"]]
    assert ids_a == ids_b
    assert len(set(ids_a)) == 3


def test_track_shipment_raises_on_error_status(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "Status": "ERROR", "Message": "please try again later"})
    try:
        ss.track_shipment("324049418658")
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_API_ERROR"
        assert "please try again later" in exc.message


def test_track_shipment_unparseable_date_falls_back_to_now(monkeypatch):
    from datetime import datetime, timezone
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, pl: {
        "status": "SUCCESS", "TrackingDetails": [{
            "CourierCode": "IP", "TrackingNo": "T9", "TrackingHistory": [
                {"ActionDate": "not-a-date", "ActionTime": "99:99",
                 "ActionLocation": "X", "ActionDescription": "Item Booked"}]}]})
    out = ss.track_shipment("T9")
    et = out["events"][0]["event_time"]
    assert abs((datetime.now(timezone.utc) - et).total_seconds()) < 120


def test_track_shipment_handles_empty_tracking_details(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, pl: {
        "status": "SUCCESS", "message": "0 Record Found", "TrackingDetails": []})
    assert ss.track_shipment("NOPE") == {"awb": "NOPE", "events": []}


def test_parse_event_time_accepts_english_month_spellings():
    """Month names are looked up in a fixed map, not the C locale's calendar."""
    from datetime import datetime, timezone
    from app.services.shipsagar_service import _parse_event_time
    may = datetime(2023, 5, 16, 12, 27, tzinfo=timezone.utc)
    assert _parse_event_time("16-May-2023", "12:27") == may
    assert _parse_event_time("16-may-2023", "12:27") == may
    # Full month names, which a locale-dependent %b cannot parse at all.
    assert _parse_event_time("16-September-2023", "12:27") == datetime(
        2023, 9, 16, 12, 27, tzinfo=timezone.utc)
    assert _parse_event_time("16-September-2023", "09:05 PM") == datetime(
        2023, 9, 16, 21, 5, tzinfo=timezone.utc)
    assert _parse_event_time("", "") is not None
