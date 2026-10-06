# backend/tests/test_shipsagar.py — SDD Task 4: ShipSagar integration.
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

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
    """The word-boundary rule now applies to every matrix.

    IP is an alias of INDIA_POST, so it reads the India Post rows and agrees
    with them exactly. The India Post rows used to match "rto" as a plain
    substring, which was deliberate while nothing could reach those rows - until
    COURIER_ALIASES routed IP, the push dialog's default courier, into them. The
    loose matching is gone there too, so "carton" is protected on both paths.
    """
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "Packed in carton") != "RTO"
    assert norm("FEDEX", "Carton sealed") != "RTO"
    assert norm("FEDEX", "Carton sealed and shipped") == "IN_TRANSIT"
    assert norm("IP", "Carton sealed and shipped") == norm("INDIA_POST", "Carton sealed and shipped")


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
    """DELIBERATE UPDATE (final review, finding 4).

    This test originally seeded a single tenant, so it passed whether or not the
    four pre-existing counters were scoped, and in effect pinned the unscoped
    behaviour. A second tenant with its own unregistered shipment and its own
    DEAD_LETTER job is seeded here, and the assertions now require the caller's
    numbers to exclude both.
    """
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
    b2 = Business(name="B2", email="b2@t.in")
    db.add(b2)
    db.commit()
    db.refresh(b2)
    bid, bid2 = b.id, b2.id
    db.close()
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    db = mk()
    db.add(Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                    carrier_code="DTDC", awb_number="D777",
                    tracking_status="READY_TO_SHIP"))
    db.add(Shipment(business_id=bid2, order_id="o9", parcel_id="p9",
                    carrier_code="DTDC", awb_number="D778",
                    tracking_status="READY_TO_SHIP"))
    db.add(ShipsagarRetryJob(business_id=bid2, operation="register_tracking",
                             shipment_id=None, attempts=4, max_attempts=4,
                             status="DEAD_LETTER"))
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
        # Only this tenant's own unregistered shipment, not the other tenant's.
        assert data["unregistered_shipments"] == 1
        assert data["failed_jobs"] == 0
        assert data["failed_webhooks"] in (0, 1) and "failed_jobs" in data
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
    from datetime import datetime, timedelta, timezone
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
    from datetime import datetime, timedelta, timezone
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


# --- ShipsagarProvider wiring ---

def test_registry_exposes_shipsagar_provider():
    from app.carriers.registry import PROVIDERS, get_provider
    assert "SHIPSAGAR" in PROVIDERS
    p = get_provider("SHIPSAGAR")
    assert p.code == "SHIPSAGAR"
    assert "TRACKING" in p.capabilities()


def test_provider_for_shipment_routes_on_shipsagar_tracking_id():
    from app.carriers.registry import (normalize_for_shipment,
                                       provider_code_for_shipment,
                                       provider_for_shipment)

    class _Pushed:
        carrier_code = "IP"
        shipsagar_tracking_id = "SS-EG080960145IN"

    assert provider_code_for_shipment(_Pushed()) == "SHIPSAGAR"
    assert provider_for_shipment(_Pushed()).code == "SHIPSAGAR"
    assert normalize_for_shipment(_Pushed(), "Item Delivered") == "DELIVERED"

    class _Direct:
        carrier_code = "INDIA_POST"
        shipsagar_tracking_id = None

    assert provider_code_for_shipment(_Direct()) == "INDIA_POST"
    assert provider_for_shipment(_Direct()).code == "INDIA_POST"
    assert normalize_for_shipment(_Direct(), "Item Delivered") == "DELIVERED"


def test_shipsagar_provider_get_tracking_delegates(monkeypatch):
    from app.carriers import shipsagar as ssmod
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    p = ssmod.ShipsagarProvider(courier="IP")
    # The provider returns track_shipment's result unchanged, so any top-level
    # key the API adds later survives instead of being silently dropped.
    monkeypatch.setattr(ss, "track_shipment", lambda awb, courier_code="": {
        "awb": awb, "courier_code": "IP", "events": [{
            "event_id": "e1", "status_raw": "Item Delivered",
            "normalized_status": "DELIVERED", "message": "Item Delivered",
            "location": "Delhi", "event_time": "2023-05-16T19:43:00+00:00"}]})
    out = p.get_tracking("EG080960145IN")
    assert out["awb"] == "EG080960145IN"
    assert out["courier_code"] == "IP"
    assert out["events"][0]["normalized_status"] == "DELIVERED"


def test_shipsagar_provider_normalize_uses_its_courier():
    from app.carriers.shipsagar import ShipsagarProvider
    assert ShipsagarProvider(courier="FEDEX").normalize_status("Delivered") == "DELIVERED"
    assert ShipsagarProvider(courier="IP").normalize_status("Item Booked") == "READY_TO_SHIP"


def test_shipsagar_provider_raises_carrier_error_when_unconfigured(monkeypatch):
    from app import config
    from app.carriers.base import CarrierError
    from app.carriers.shipsagar import ShipsagarProvider
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        ShipsagarProvider(courier="IP").get_tracking("EG1")
        raise AssertionError("expected CarrierError")
    except CarrierError as exc:
        assert exc.code == "CARRIER_NOT_CONNECTED"


def test_shipsagar_provider_raises_carrier_error_without_tracking_number(monkeypatch):
    from app.carriers.base import CarrierError
    from app.carriers.shipsagar import ShipsagarProvider
    _configured(monkeypatch)
    try:
        ShipsagarProvider(courier="IP").get_tracking("   ")
        raise AssertionError("expected CarrierError")
    except CarrierError as exc:
        assert exc.code == "CARRIER_NOT_CONNECTED"


def _seed_pushed_shipment(mk, awb="EG080960145IN", courier="IP", status="READY_TO_SHIP",
                          business_id=None):
    """A shipment pushed through ShipSagar: courier code in carrier_code, id on the row.

    business_id is passed in so the shipment belongs to the tenant _authed logged
    into; without it the endpoint tests would seed a second, invisible tenant.
    """
    from app.models.business import Business
    from app.models.shipment import Shipment
    db = mk()
    if business_id is None:
        b = Business(name="B", email="b@t.in")
        db.add(b)
        db.commit()
        db.refresh(b)
        business_id = b.id
    s = Shipment(business_id=business_id, order_id="o1", parcel_id="p1",
                 carrier_code=courier, awb_number=awb, tracking_status=status,
                 shipsagar_tracking_id=f"SS-{awb}")
    db.add(s)
    db.commit()
    db.refresh(s)
    sid = s.id
    db.close()
    return sid, business_id


def test_sync_endpoint_pulls_shipsagar_history(monkeypatch):
    """A pushed shipment's sync hits TrackShipment and rolls the status up."""
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        sid, _ = _seed_pushed_shipment(mk, business_id=bid)
        _configured(monkeypatch)
        calls = []

        def _fake_track(tracking_no, courier_code=""):
            calls.append((tracking_no, courier_code))
            from datetime import datetime as _dt, timezone as _tz
            return {"awb": tracking_no, "events": [{
                "event_id": "ss-EG080960145IN-16-May-2023-19:43-0",
                "status_raw": "Out for delivery",
                "normalized_status": "OUT_FOR_DELIVERY",
                "message": "Out for delivery", "location": "New Delhi",
                "event_time": _dt.now(_tz.utc)}]}

        monkeypatch.setattr(ss, "track_shipment", _fake_track)
        r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["synced"] is True
        assert calls == [("EG080960145IN", "IP")]
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.tracking_status == "OUT_FOR_DELIVERY"
            assert s.current_location == "New Delhi"
            assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 1
        finally:
            db.close()
        # A second sync inside the 60s cooldown is refused, not double-counted.
        r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "REFRESH_COOLDOWN"
    finally:
        app.dependency_overrides.clear()


def test_poll_sweep_includes_shipsagar_shipments(monkeypatch):
    from datetime import datetime as _dt, timezone as _tz
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        _seed_pushed_shipment(mk, awb="EG080960000IN", status="READY_TO_SHIP",
                              business_id=bid)
        _configured(monkeypatch)
        monkeypatch.setattr(ss, "track_shipment", lambda awb, courier_code="": {
            "awb": awb, "events": [{
                "event_id": f"ss-{awb}-0", "status_raw": "Delivered",
                "normalized_status": "DELIVERED", "message": "Delivered",
                "location": "Pune", "event_time": _dt.now(_tz.utc)}]})
        r = c.post("/api/v1/shipments/poll-sweep", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["checked"] == 1
        assert data["synced"] == 1
        assert data["skipped"] == 0
    finally:
        app.dependency_overrides.clear()


def test_parse_event_time_accepts_english_month_spellings():
    """Month names are looked up in a fixed map, not the C locale's calendar."""
    from datetime import datetime, timedelta, timezone
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


# --- JSON-safe event payloads (provider-agnostic, enforced in ingest_event) ---

def test_ingest_event_coerces_datetime_payloads_once():
    """A provider payload carrying real datetimes must flush and round-trip.

    raw_payload is a JSON column, and sync/poll-sweep hand it the provider's own
    event dict verbatim. Timestamps must survive as ISO 8601 (timezone kept),
    not be dropped or stringified into something lossy.
    """
    import json
    from datetime import datetime, timedelta, timezone
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.shipment_service import ingest_event
    mk = _mk()
    sid, _ = _seed_pushed_shipment(mk, awb="EG-JSON-1")
    when = datetime(2023, 5, 16, 19, 43, tzinfo=timezone.utc)
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        ev, created = ingest_event(
            db, s, "Item Delivered", "Delivered", "Delhi", when, "ss-json-1",
            "API", {"event_time": when, "status_raw": "Item Delivered",
                    "nested": [{"at": when}]})
        db.commit()
        assert created is True
        row = db.query(ShipmentEvent).filter_by(id=ev.id).first()
        stored = json.loads(json.dumps(row.raw_payload))
        assert stored["event_time"] == when.isoformat()
        assert stored["nested"][0]["at"] == when.isoformat()
        assert stored["status_raw"] == "Item Delivered"
        # The event_time column itself keeps a real datetime, as before.
        assert row.event_time is not None
    finally:
        db.close()


def test_india_post_stub_payload_flushes_through_ingest_event(monkeypatch):
    """The India Post stub branch returns datetimes; ingest_event absorbs them.

    This is the same latent bug ShipSagar would have hit, in a provider that
    predates it — the coercion must not be ShipSagar-specific.
    """
    import json
    from datetime import datetime
    from app import config
    from app.carriers import india_post
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.shipment_service import ingest_event
    monkeypatch.setattr(india_post, "httpx", None)
    monkeypatch.setattr(config.settings, "india_post_client_id", "cid")
    data = india_post.IndiaPostProvider().get_tracking("IP-JSON-1")
    assert any(isinstance(e["event_time"], datetime) for e in data["events"])
    mk = _mk()
    sid, _ = _seed_shipment(mk, awb="IP-JSON-1")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        for raw_ev in data["events"]:
            ingest_event(db, s, raw_ev.get("status_raw"), raw_ev.get("message"),
                         raw_ev.get("location"), raw_ev.get("event_time"),
                         raw_ev.get("event_id", ""), "API", raw_ev)
        db.commit()
        rows = db.query(ShipmentEvent).filter_by(shipment_id=sid).all()
        assert len(rows) == 2
        for row in rows:
            json.dumps(row.raw_payload)
    finally:
        db.close()


# --- the instance courier selects the matrix, not just the registry key ---

def test_shipment_routing_threads_the_instance_courier_into_normalization():
    """Provider key alone is not enough: the per-shipment courier picks the matrix.

    'Redirected to another address' is a disagreement case on purpose — the
    India-Post rows map 'redirected' to RTO, the generic matrix has no such row
    and falls through to EXCEPTION, and the India Post provider itself has no
    keyword for it and returns UNKNOWN. Reverting the instance courier to ''
    would collapse the first two and fail this test.
    """
    from app.carriers.registry import (get_provider, normalize_for_shipment,
                                       provider_for_shipment)
    from app.services.shipsagar_service import normalize_shipsagar_status
    raw = "Redirected to another address"
    assert normalize_shipsagar_status("INDIA_POST", raw) == "RTO"
    assert normalize_shipsagar_status("FEDEX", raw) == "EXCEPTION"

    class _Pushed:
        carrier_code = "INDIA_POST"
        shipsagar_tracking_id = "SS-ROUTING-1"

    assert normalize_for_shipment(_Pushed(), raw) == "RTO"
    assert provider_for_shipment(_Pushed()).normalize_status(raw) == "RTO"
    # The registry singleton is courier-less, so it can only reach the generic
    # matrix — which is exactly why the resolver builds a per-shipment instance.
    assert get_provider("SHIPSAGAR").normalize_status(raw) == "EXCEPTION"

    class _Direct:
        carrier_code = "INDIA_POST"
        shipsagar_tracking_id = None

    assert normalize_for_shipment(_Direct(), raw) == "UNKNOWN"


# --- register_tracking on the real PushShipment path ---

def _seed_shipment_with_order(mk, awb, courier="DTDC", status="READY_TO_SHIP",
                              order_no="MAN-R1"):
    from app.models.business import Business
    from app.models.order import Order
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    o = Order(business_id=b.id, internal_order_number=order_no,
              shopify_order_id=f"MANUAL-{order_no}",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id="p1",
                 carrier_code=courier, awb_number=awb, tracking_status=status)
    db.add(s)
    db.commit()
    db.refresh(s)
    s_id = s.id
    db.close()
    return s_id


def test_register_tracking_calls_push_shipment_when_configured(monkeypatch):
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-CFG-1")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        seen = {}

        def _fake_push(*, tracking_no, courier_code, order):
            seen["awb"] = tracking_no
            seen["courier"] = courier_code
            seen["order_no"] = order.internal_order_number
            return {"ok": True, "message": "Data has been recorded successfully"}

        monkeypatch.setattr(ss, "push_shipment", _fake_push)
        out = ss.register_tracking(db, s)
        assert out["pushed"] is True
        assert out["stubbed"] is False
        assert out["shipsagar_tracking_id"] == "SS-D-CFG-1"
        assert seen == {"awb": "D-CFG-1", "courier": "DTDC", "order_no": "MAN-R1"}
        assert s.shipsagar_tracking_id == "SS-D-CFG-1"
    finally:
        db.close()


def test_register_tracking_reports_provider_error_without_raising(monkeypatch):
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-ERR-1", order_no="MAN-R2")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "please try again later"})
        out = ss.register_tracking(db, s)
        assert out["pushed"] is False
        assert out["message"] == "please try again later"
        assert out["shipsagar_tracking_id"] == "SS-D-ERR-1"
        # The other half of the distinction: ShipSagar received the request
        # and refused it, so there is nothing transient to retry. A retry job
        # here would storm against a rejection that will never succeed.
        db.commit()
        assert db.query(ShipsagarRetryJob).filter_by(
            shipment_id=sid).count() == 0
    finally:
        db.close()


def test_register_tracking_transport_failure_queues_one_retry_and_raises(monkeypatch):
    """The transport half of the distinction: queue a bounded job and re-raise.

    Symmetric partner to the provider-ERROR test above. Deleting the
    schedule_retry call must turn this red; deleting nothing here and only
    raising must turn the count to 0 and also fail.
    """
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-TRAN-1", order_no="MAN-R3")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()

        def _boom(*, tracking_no, courier_code, order):
            raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

        monkeypatch.setattr(ss, "push_shipment", _boom)
        try:
            ss.register_tracking(db, s)
            raise AssertionError("expected ShipsagarError")
        except ss.ShipsagarError as exc:
            assert exc.code == "SHIPSAGAR_API_ERROR"
        db.commit()
        jobs = db.query(ShipsagarRetryJob).filter_by(shipment_id=sid).all()
        assert len(jobs) == 1
        assert jobs[0].status == "PENDING"
        assert jobs[0].operation == "register_tracking"
        assert jobs[0].attempts == 1 and jobs[0].max_attempts == 4
        assert "SHIPSAGAR_API_ERROR" in jobs[0].last_error
        assert jobs[0].next_retry_at is not None
        # The push never landed, so no tracking id may be persisted.
        assert s.shipsagar_tracking_id is None
    finally:
        db.close()


def test_register_tracking_stub_promotes_only_promotable_statuses(monkeypatch):
    """Stub path promotes the pre-dispatch statuses and leaves later ones alone.

    The earlier READY_TO_SHIP assertion was vacuous: the seed default was
    already READY_TO_SHIP, so it passed whatever the promotion logic did.
    """
    from app import config
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    mk = _mk()
    cases = [("S-NOTCREATED", "NOT_CREATED", "READY_TO_SHIP"),
             ("S-BOOKED", "BOOKED", "READY_TO_SHIP"),
             ("S-EMPTY", "", "READY_TO_SHIP"),
             ("S-TRANSIT", "IN_TRANSIT", "IN_TRANSIT"),
             ("S-DELIVERED", "DELIVERED", "DELIVERED")]
    ids = [(awb, _seed_shipment_with_order(mk, awb, status=status, order_no=f"MAN-{awb}"), expected)
           for awb, status, expected in cases]
    db = mk()
    try:
        for awb, sid, expected in ids:
            s = db.query(Shipment).filter_by(id=sid).first()
            out = ss.register_tracking(db, s)
            assert out["stubbed"] is True
            assert s.tracking_status == expected, (awb, s.tracking_status)
            assert out["shipsagar_tracking_id"] == f"SS-STUB-DTDC-{awb}"
    finally:
        db.close()


def test_register_tracking_endpoint_surfaces_push_outcome(monkeypatch):
    """A rejected push must be visible to the API caller, not just logged.

    SS-{awb} is persisted either way, so without pushed/message in the
    response a caller cannot tell a registered parcel from a refused one.
    """
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        db = mk()
        db.add_all([
            Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                     carrier_code="DTDC", awb_number="D-OK", tracking_status="READY_TO_SHIP"),
            Shipment(business_id=bid, order_id="o2", parcel_id="p2",
                     carrier_code="DTDC", awb_number="D-NOPE", tracking_status="READY_TO_SHIP"),
        ])
        db.commit()
        ok_id = db.query(Shipment).filter_by(awb_number="D-OK").first().id
        bad_id = db.query(Shipment).filter_by(awb_number="D-NOPE").first().id
        db.close()

        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": True, "message": "Data has been recorded successfully"})
        r = c.post(f"/api/v1/shipments/{ok_id}/register-tracking", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is True
        assert data["message"] == "Data has been recorded successfully"
        assert data["shipsagar_stubbed"] is False

        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "Invalid AWB for the courier"})
        r = c.post(f"/api/v1/shipments/{bad_id}/register-tracking", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is False
        assert data["message"] == "Invalid AWB for the courier"
        assert data["shipsagar_tracking_id"] == "SS-D-NOPE"
    finally:
        app.dependency_overrides.clear()


def test_health_counts_shipments_whose_push_shipsagar_refused(monkeypatch):
    """A refused push must not read as healthy forever.

    SS-{awb} is persisted even on refusal, so the shipment leaves the
    unregistered_shipments count and no retry job is queued by design.
    Without a dedicated counter such a parcel reports healthy indefinitely.
    """
    from app.models.audit_log import AuditLog
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        db = mk()
        db.add_all([
            Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                     carrier_code="DTDC", awb_number="D-H-OK", tracking_status="READY_TO_SHIP"),
            Shipment(business_id=bid, order_id="o2", parcel_id="p2",
                     carrier_code="DTDC", awb_number="D-H-BAD", tracking_status="READY_TO_SHIP"),
        ])
        db.commit()
        ok_id = db.query(Shipment).filter_by(awb_number="D-H-OK").first().id
        bad_id = db.query(Shipment).filter_by(awb_number="D-H-BAD").first().id
        db.close()

        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": True, "message": "Data has been recorded successfully"})
        assert c.post(f"/api/v1/shipments/{ok_id}/register-tracking",
                      headers=h).status_code == 200
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["rejected_pushes"] == 0

        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "Invalid AWB for the courier"})
        assert c.post(f"/api/v1/shipments/{bad_id}/register-tracking",
                      headers=h).status_code == 200
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["rejected_pushes"] == 1
        # Backward compatibility: the pre-existing keys are untouched, and a
        # refused push leaves the parcel out of unregistered_shipments.
        assert data["provider"] == "SHIPSAGAR"
        assert data["unregistered_shipments"] == 0
        assert data["status"] == "warning"
        db = mk()
        try:
            row = db.query(AuditLog).filter_by(
                action="SHIPSAGAR_PUSH_REJECTED", entity_id=bad_id).first()
            assert row is not None
            assert row.entity_type == "shipment" and row.business_id == bid
            assert "Invalid AWB" in row.new_data["message"]
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_retry_drain_requeues_when_shipsagar_refuses_the_push(monkeypatch):
    """A retried shipment that ShipSagar refuses must not be marked DONE.

    register_tracking reports a provider ERROR instead of raising, so 'no
    exception' no longer means 'pushed'. Treating it as success silently
    retires a shipment the aggregator never accepted.
    """
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-DRAIN-REJ", order_no="MAN-DRAIN-REJ")
    db = mk()
    past = datetime.now(timezone.utc) - _td(seconds=5)
    s = db.query(Shipment).filter_by(id=sid).first()
    bid = s.business_id
    db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                             shipment_id=sid, attempts=1, max_attempts=4,
                             status="PENDING", next_retry_at=past))
    db.commit()
    try:
        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "Invalid AWB for the courier"})
        out = ss.drain_retry_queue(db)
        db.commit()
        assert out == {"checked": 1, "succeeded": 0, "requeued": 1, "dead_lettered": 0}
        job = db.query(ShipsagarRetryJob).filter_by(
            business_id=bid, shipment_id=sid, status="PENDING").first()
        assert job is not None
        assert job.attempts == 2
        assert job.next_retry_at is not None
        assert "Invalid AWB for the courier" in job.last_error
    finally:
        db.close()


def test_retry_drain_dead_letters_when_provider_refusal_exhausts_attempts(monkeypatch):
    """Bounded, like every other drain failure: refusals dead-letter too."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-DRAIN-DL", order_no="MAN-DRAIN-DL")
    db = mk()
    past = datetime.now(timezone.utc) - _td(seconds=5)
    s = db.query(Shipment).filter_by(id=sid).first()
    bid = s.business_id
    db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                             shipment_id=sid, attempts=3, max_attempts=4,
                             status="PENDING", next_retry_at=past))
    db.commit()
    try:
        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "please try again later"})
        out = ss.drain_retry_queue(db)
        db.commit()
        assert out == {"checked": 1, "succeeded": 0, "requeued": 0, "dead_lettered": 1}
        job = db.query(ShipsagarRetryJob).filter_by(
            business_id=bid, shipment_id=sid, status="DEAD_LETTER").first()
        assert job is not None
        assert job.attempts == 4 and job.next_retry_at is None
        assert "please try again later" in job.last_error
    finally:
        db.close()


def test_register_tracking_stub_when_unconfigured(monkeypatch):
    from app import config
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-STUB", order_no="MAN-R3")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        out = ss.register_tracking(db, s)
        assert out["stubbed"] is True
        assert out["pushed"] is False
        assert out["shipsagar_tracking_id"] == "SS-STUB-DTDC-D-STUB"
        assert s.tracking_status == "READY_TO_SHIP"
    finally:
        db.close()


def test_register_tracking_still_rejects_unsupported_courier(monkeypatch):
    from app.models.business import Business
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    s = Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                 carrier_code="MANUAL", awb_number="M-1", tracking_status="BOOKED")
    db.add(s)
    db.commit()
    db.refresh(s)
    try:
        ss.register_tracking(db, s)
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "UNSUPPORTED_COURIER"
    finally:
        db.close()


# --- POST /api/v1/shipments/push ---

def _authed_with_order(monkeypatch, mk, role="ADMIN", email="a@t.in"):
    """Business + user + one Order. Returns (client, headers, business_id, order_id)."""
    from app.models.business import Business
    from app.models.order import Order
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = Business(name="B", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    o = Order(business_id=b.id, internal_order_number="MAN-P1",
              shopify_order_id="MANUAL-P1",
              order_date=datetime.now(timezone.utc))
    db.add(o)
    db.commit()
    db.refresh(o)
    u = User(business_id=b.id, name="A", email=email,
             password_hash=hash_password("x"), role=role)
    db.add(u)
    db.commit()
    bid, oid = b.id, o.id
    db.close()
    c = _client(monkeypatch, mk)
    tok = c.post("/api/v1/auth/login",
                 json={"email": email, "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}, bid, oid


def test_push_creates_parcel_and_shipment_and_calls_shipsagar(monkeypatch):
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    _configured(monkeypatch)
    seen = {}

    def _fake_push(*, tracking_no, courier_code, order):
        seen["awb"] = tracking_no
        seen["courier"] = courier_code
        seen["order_no"] = order.internal_order_number
        return {"ok": True, "message": "Data has been recorded successfully"}

    monkeypatch.setattr(ss, "push_shipment", _fake_push)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960145IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is True
        assert data["awb_number"] == "EG080960145IN"
        assert data["carrier_code"] == "IP"
        assert data["tracking_status"] == "READY_TO_SHIP"
        assert data["shipsagar_tracking_id"] == "SS-EG080960145IN"
        assert seen == {"awb": "EG080960145IN", "courier": "IP", "order_no": "MAN-P1"}
        db = mk()
        try:
            p = db.query(Parcel).filter_by(business_id=bid).first()
            assert p is not None
            assert p.barcode_value == "EG080960145IN"
            assert p.order_id == oid
            s = db.query(Shipment).filter_by(business_id=bid).first()
            assert s.parcel_id == p.id
            assert s.order_id == oid
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_when_unconfigured_creates_records_with_stub_id(monkeypatch):
    from app import config
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960999IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is False
        assert data["shipsagar_tracking_id"] == "SS-STUB-IP-EG080960999IN"
        assert "SHIPSAGAR_TOKEN" in data["message"]
    finally:
        app.dependency_overrides.clear()


def test_push_provider_error_still_persists_and_reports(monkeypatch):
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
        "ok": False, "message": "please try again later"})
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960777IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is False
        assert data["message"] == "please try again later"
        db = mk()
        try:
            s = db.query(Shipment).filter_by(business_id=bid).first()
            assert s is not None
            # A refusal is deterministic: repeating it cannot succeed, so the
            # provider-ERROR path must queue nothing at all.
            assert db.query(ShipsagarRetryJob).filter_by(
                shipment_id=s.id).count() == 0
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_validation_errors(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "   ", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "MISSING_TRACKING_NUMBER"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG1", "courier_code": "  "})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "MISSING_COURIER"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "", "courier_code": ""})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "MISSING_TRACKING_NUMBER"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": "nope", "tracking_no": "EG1", "courier_code": "IP"})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "ORDER_NOT_FOUND"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-FIRST", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-SECOND", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "SHIPMENT_EXISTS"
    finally:
        app.dependency_overrides.clear()


def test_push_rejects_tracking_number_too_long_for_the_barcode_column(monkeypatch):
    """parcels.barcode_value is String(32); SQLite never enforces it, MySQL does."""
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        at_limit = "E" * 32
        over_limit = "E" * 33
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": at_limit, "courier_code": "IP"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["awb_number"] == at_limit
        db = mk()
        try:
            from app.models.order import Order
            o2 = Order(business_id=bid, internal_order_number="MAN-LONG",
                       shopify_order_id="MANUAL-LONG",
                       order_date=datetime.now(timezone.utc))
            db.add(o2)
            db.commit()
            db.refresh(o2)
            oid2 = o2.id
        finally:
            db.close()
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid2, "tracking_no": over_limit, "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "INVALID_TRACKING_NUMBER_LENGTH"
        assert "32" in r.json()["error"]["message"]
        db = mk()
        try:
            assert db.query(Parcel).filter_by(business_id=bid).count() == 1
            assert db.query(Shipment).filter_by(business_id=bid).count() == 1
            assert db.query(Shipment).filter_by(order_id=oid2).count() == 0
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_rejects_awb_already_used_for_that_courier(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-DUP", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        db = mk()
        try:
            from app.models.order import Order
            o2 = Order(business_id=bid, internal_order_number="MAN-P2",
                       shopify_order_id="MANUAL-P2",
                       order_date=datetime.now(timezone.utc))
            db.add(o2)
            db.commit()
            db.refresh(o2)
            oid2 = o2.id
        finally:
            db.close()
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid2, "tracking_no": "EG-DUP", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "DUPLICATE_TRACKING"
    finally:
        app.dependency_overrides.clear()


def test_push_rejects_awb_clash_owned_by_the_shipment_constraint(monkeypatch):
    """A pre-existing shipment can own the AWB with an unrelated parcel barcode.

    create_shipment lets a Parcel carry any barcode while the Shipment takes the
    AWB, so the parcels probe has nothing to match here and only the
    (business_id, carrier_code, awb_number) probe can reject the push.
    """
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        db = mk()
        try:
            p = Parcel(business_id=bid, order_id=oid, parcel_code="UNRELATED-1",
                       barcode_value="UNRELATED-1", status="CREATED")
            db.add(p)
            db.commit()
            db.refresh(p)
            pid = p.id
            o2 = Order(business_id=bid, internal_order_number="MAN-P3",
                       shopify_order_id="MANUAL-P3",
                       order_date=datetime.now(timezone.utc))
            db.add(o2)
            db.commit()
            db.refresh(o2)
            oid2 = o2.id
        finally:
            db.close()
        r = c.post("/api/v1/shipments", headers=h, json={
            "parcel_id": pid, "carrier_code": "INDIA_POST",
            "awb_number": "EG-COLLIDE"})
        assert r.status_code == 200, r.text
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid2, "tracking_no": "EG-COLLIDE",
            "courier_code": "INDIA_POST"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "DUPLICATE_TRACKING"
        db = mk()
        try:
            # The parcels probe had nothing to match; the shipment probe fired.
            assert db.query(Parcel).filter_by(
                business_id=bid, barcode_value="EG-COLLIDE").count() == 0
            assert db.query(Shipment).filter_by(business_id=bid).count() == 1
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_cannot_attach_to_another_tenants_order(monkeypatch):
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    mk = _mk()
    _, _, bid_a, oid_a = _authed_with_order(monkeypatch, mk)
    c2, h2, bid_b = _authed(monkeypatch, mk, role="ADMIN", email="other@t.in")
    try:
        r = c2.post("/api/v1/shipments/push", headers=h2, json={
            "order_id": oid_a, "tracking_no": "EG-XTENANT", "courier_code": "IP"})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "ORDER_NOT_FOUND"
        db = mk()
        try:
            assert db.query(Parcel).filter_by(order_id=oid_a).count() == 0
            assert db.query(Shipment).filter_by(business_id=bid_a).count() == 0
            assert db.query(Shipment).filter_by(business_id=bid_b).count() == 0
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_is_tenant_scoped(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-T1", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        sid = r.json()["data"]["id"]
        c2, h2, _ = _authed(monkeypatch, mk, role="ADMIN", email="other@t.in")
        r = c2.get(f"/api/v1/shipments/{sid}", headers=h2)
        assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()


def test_push_forbidden_for_viewer(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk, role="VIEWER")
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-V1", "courier_code": "IP"})
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "FORBIDDEN"
    finally:
        app.dependency_overrides.clear()


def test_push_queues_retry_when_provider_transport_fails(monkeypatch):
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    _configured(monkeypatch)

    def _boom(**kw):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

    monkeypatch.setattr(ss, "push_shipment", _boom)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-BOOM", "courier_code": "IP"})
        assert r.status_code == 502, r.text
        assert r.json()["error"]["code"] == "SHIPSAGAR_API_ERROR"
        db = mk()
        try:
            jobs = db.query(ShipsagarRetryJob).filter_by(
                business_id=bid, status="PENDING").all()
            assert len(jobs) == 1
            # drain_retry_queue only dispatches register_tracking; a
            # push_shipment job would dead-letter as UNKNOWN_OPERATION and the
            # registration would never be retried.
            assert jobs[0].operation == "register_tracking"
            assert jobs[0].shipment_id is not None
            assert "connection reset" in jobs[0].last_error
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_queued_retry_is_actually_drained(monkeypatch):
    """The job the 502 path queues must reach ShipSagar on a later drain."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    _configured(monkeypatch)

    def _boom(**kw):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

    monkeypatch.setattr(ss, "push_shipment", _boom)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-DRAIN",
            "courier_code": "INDIA_POST"})
        assert r.status_code == 502, r.text
        db = mk()
        try:
            job = db.query(ShipsagarRetryJob).filter_by(
                business_id=bid, status="PENDING").first()
            assert job is not None
            job.next_retry_at = datetime.now(timezone.utc) - _td(seconds=5)
            db.commit()
            reached = {}

            def _recovered(*, tracking_no, courier_code, order):
                reached["awb"] = tracking_no
                reached["courier"] = courier_code
                reached["order_no"] = order.internal_order_number
                return {"ok": True, "message": "Data has been recorded successfully"}

            monkeypatch.setattr(ss, "push_shipment", _recovered)
            out = ss.drain_retry_queue(db)
            db.commit()
            assert reached == {"awb": "EG-DRAIN", "courier": "INDIA_POST",
                               "order_no": "MAN-P1"}
            assert out == {"checked": 1, "succeeded": 1, "requeued": 0,
                           "dead_lettered": 0}
            done = db.query(ShipsagarRetryJob).filter_by(
                business_id=bid, status="DONE").all()
            assert len(done) == 1
            s = db.query(Shipment).filter_by(business_id=bid).first()
            assert s.shipsagar_tracking_id == "SS-EG-DRAIN"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


# --- list: date filters, facets, joined display columns ---

def _seed_list_rows(mk, n=3, courier="IP", days=(0, 1, 2), email="l@t.in",
                    prefix="MAN"):
    from datetime import timedelta
    from app.models.business import Business
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="L", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    now = datetime.now(timezone.utc)
    for i in range(n):
        o = Order(business_id=b.id, internal_order_number=f"{prefix}-{i}",
                  shopify_order_id=f"MANUAL-{prefix}-{i}", order_date=now)
        db.add(o)
        db.commit()
        db.refresh(o)
        p = Parcel(business_id=b.id, order_id=o.id, parcel_code=f"P{i}",
                   barcode_value=f"EG{i}IN")
        db.add(p)
        db.commit()
        db.refresh(p)
        s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id,
                     carrier_code=courier, awb_number=f"EG{i}IN",
                     tracking_status="DELIVERED" if i == 0 else "IN_TRANSIT",
                     shipsagar_tracking_id=f"SS-EG{i}IN",
                     created_at=now - timedelta(days=days[i]))
        db.add(s)
        db.commit()
    bid = b.id
    db.close()
    return bid


def _authed_for_list(monkeypatch, mk, email="l@t.in"):
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = db.query(Business).filter_by(email=email).first()
    if b is None:
        b = Business(name="L", email=email)
        db.add(b)
        db.commit()
        db.refresh(b)
    u = User(business_id=b.id, name="L", email=email,
             password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    bid = b.id
    db.close()
    c = _client(monkeypatch, mk)
    tok = c.post("/api/v1/auth/login",
                 json={"email": email, "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}, bid


def test_list_returns_joined_display_columns(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=1)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments", headers=h)
        assert r.status_code == 200, r.text
        row = r.json()["data"]["items"][0]
        assert row["order_no"] == "MAN-0"
        # DELIBERATE UPDATE (fix wave 2, item 1). These four used to be asserted
        # as populated from receiver_* columns on Order. Those columns arrive
        # with the India Post order migration, which is uncommitted, so seeding
        # them made every list/detail test on this branch red at HEAD with
        # TypeError/AttributeError. On a tree without those columns the honest
        # value is null, which is what is asserted here; the mapping itself is
        # still pinned, directly, by
        # test_order_fields_maps_the_receiver_columns_when_they_exist.
        assert row["customer_name"] is None
        assert row["customer_email"] is None
        assert row["customer_mobile"] is None
        assert row["company_name"] is None
        assert row["shipment_type"] == "Road"
        assert row["country_name"] == "India"
        assert row["entry_datetime"] is not None
    finally:
        app.dependency_overrides.clear()


def test_order_fields_maps_the_receiver_columns_when_they_exist():
    """The receiver_* mapping is pinned directly, off a real Order instance.

    The list tests above assert null because the committed Order has no
    receiver_* columns, which on its own would let the mapping rot unnoticed.
    Setting the attributes on the instance exercises the same getattr path the
    serializer takes once the India Post migration lands, so the four display
    columns are proven to map - without the committed suite depending on a
    column that does not exist on this branch.
    """
    from app.api.shipments import _order_fields
    from app.models.order import Order
    o = Order(business_id="b1", internal_order_number="MAN-X",
              shopify_order_name="#X", order_date=datetime.now(timezone.utc))
    assert _order_fields(o) == {
        "order_no": "MAN-X", "customer_name": None, "customer_email": None,
        "customer_mobile": None, "company_name": None}
    o.receiver_name = "Dileep Kumar"
    o.receiver_email = "rahul@example.com"
    o.receiver_mobile = "9963026645"
    o.receiver_company = "Reshamgath"
    assert _order_fields(o) == {
        "order_no": "MAN-X", "customer_name": "Dileep Kumar",
        "customer_email": "rahul@example.com", "customer_mobile": "9963026645",
        "company_name": "Reshamgath"}
    # shopify_order_name is the fallback when there is no internal number.
    assert _order_fields(Order(
        business_id="b1", internal_order_number=None,
        shopify_order_name="#ONLY", order_date=datetime.now(timezone.utc))
    )["order_no"] == "#ONLY"


def test_list_returns_facets_over_the_filtered_set(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3, courier="IP")
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?page_size=1", headers=h)
        data = r.json()["data"]
        assert data["total"] == 3
        assert len(data["items"]) == 1
        assert data["page_size"] == 1
        carriers = {x["code"]: x["count"] for x in data["facets"]["carriers"]}
        statuses = {x["code"]: x["count"] for x in data["facets"]["statuses"]}
        assert carriers == {"IP": 3}
        assert statuses == {"DELIVERED": 1, "IN_TRANSIT": 2}
    finally:
        app.dependency_overrides.clear()


def test_list_date_filters_narrow_the_set_and_facets(monkeypatch):
    """Both ends of the range cover the whole named day, inclusive.

    Rows are seeded at today, yesterday and the day before. date_to=yesterday
    must therefore return 2 (yesterday and the day before), not 1: shipments.py
    mirrors order_service._day_bounds so the orders and shipments date pickers
    cannot disagree about whether a single day includes its final second.
    """
    from datetime import timedelta
    mk = _mk()
    _seed_list_rows(mk, n=3, days=(0, 1, 2))
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        today = datetime.now(timezone.utc).date()
        r = c.get(f"/api/v1/shipments?date_from={(today - timedelta(days=1)).isoformat()}",
                  headers=h)
        data = r.json()["data"]
        assert data["total"] == 2
        assert sum(x["count"] for x in data["facets"]["statuses"]) == 2
        r = c.get(f"/api/v1/shipments?date_to={(today - timedelta(days=1)).isoformat()}",
                  headers=h)
        assert r.json()["data"]["total"] == 2
        r = c.get(f"/api/v1/shipments?date_from={(today - timedelta(days=1)).isoformat()}"
                  f"&date_to={(today - timedelta(days=1)).isoformat()}", headers=h)
        assert r.json()["data"]["total"] == 1
    finally:
        app.dependency_overrides.clear()


def test_list_order_no_filter_matches_order_numbers(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?order_no=MAN-1", headers=h)
        assert r.json()["data"]["total"] == 1
        assert r.json()["data"]["items"][0]["awb_number"] == "EG1IN"
    finally:
        app.dependency_overrides.clear()


def test_list_carrier_filter_drives_facets(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=2, courier="IP")
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?carrier=DELHIVERY", headers=h)
        data = r.json()["data"]
        assert data["total"] == 0
        assert data["facets"]["carriers"] == []
    finally:
        app.dependency_overrides.clear()


def test_list_q_still_matches_awb_and_barcode(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        assert c.get("/api/v1/shipments?q=EG1IN", headers=h).json()["data"]["total"] == 1
        assert c.get("/api/v1/shipments?q=MAN-2", headers=h).json()["data"]["total"] == 1
    finally:
        app.dependency_overrides.clear()


def test_shipment_detail_includes_display_columns(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=1)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        sid = c.get("/api/v1/shipments", headers=h).json()["data"]["items"][0]["id"]
        r = c.get(f"/api/v1/shipments/{sid}", headers=h)
        assert r.status_code == 200, r.text
        # DELIBERATE UPDATE (fix wave 2, item 1) - null because the committed
        # Order carries no receiver_* columns. See
        # test_list_returns_joined_display_columns for the full note and
        # test_order_fields_maps_the_receiver_columns_when_they_exist for the
        # mapping itself.
        assert r.json()["data"]["customer_name"] is None
        assert r.json()["data"]["country_name"] == "India"
    finally:
        app.dependency_overrides.clear()


def test_list_facets_do_not_inflate_when_the_joined_columns_fan_out(monkeypatch):
    """Facets count shipments, not join rows.

    Three orders and three parcels in one tenant is the shape that inflates if
    the facet query joins on something other than the PK (a stray
    ``Order.business_id == Shipment.business_id``, say): the counts then report
    9 and the page repeats rows. q is what drags both outer joins into the
    facet subquery, so this is the path that must stay a set of ids.
    """
    mk = _mk()
    _seed_list_rows(mk, n=3, courier="IP")
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        data = c.get("/api/v1/shipments?q=IN", headers=h).json()["data"]
        assert data["total"] == 3
        assert len(data["items"]) == 3
        assert len({i["id"] for i in data["items"]}) == 3
        assert sum(x["count"] for x in data["facets"]["carriers"]) == 3
        assert sum(x["count"] for x in data["facets"]["statuses"]) == 3
        assert {x["code"]: x["count"] for x in data["facets"]["statuses"]} == {
            "DELIVERED": 1, "IN_TRANSIT": 2}
    finally:
        app.dependency_overrides.clear()


def test_list_and_facets_stay_inside_the_callers_business(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=2, courier="IP", email="mine@t.in", prefix="MINE")
    _seed_list_rows(mk, n=1, courier="DTDC", email="other@t.in", prefix="OTH")
    c, h, _ = _authed_for_list(monkeypatch, mk, email="mine@t.in")
    try:
        data = c.get("/api/v1/shipments", headers=h).json()["data"]
        assert data["total"] == 2
        assert {x["code"]: x["count"] for x in data["facets"]["carriers"]} == {"IP": 2}
        assert {x["code"] for x in data["facets"]["statuses"]} == {"DELIVERED", "IN_TRANSIT"}
    finally:
        app.dependency_overrides.clear()


def test_list_clamps_an_unbounded_page_size(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        data = c.get("/api/v1/shipments?page_size=100000", headers=h).json()["data"]
        assert data["page_size"] == 200
        assert len(data["items"]) == 3
    finally:
        app.dependency_overrides.clear()


def test_display_columns_degrade_to_null_where_no_order_is_joined(monkeypatch):
    """_sdict(s) with one argument must still serialize the new keys.

    correct-awb returns _sdict(s) with no Order attached, so the display
    columns have to fall back to nulls rather than raising.
    """
    mk = _mk()
    _seed_list_rows(mk, n=1)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        sid = c.get("/api/v1/shipments", headers=h).json()["data"]["items"][0]["id"]
        r = c.post(f"/api/v1/shipments/{sid}/correct-awb",
                   json={"awb_number": "EG0IN-X", "reason": "reprint"}, headers=h)
        assert r.status_code == 200, r.text
        row = r.json()["data"]
        assert row["shipment_type"] == "Road"
        assert row["country_name"] == "India"
        assert row["entry_datetime"] is not None
        for key in ("order_no", "customer_name", "customer_email",
                    "customer_mobile", "company_name"):
            assert row[key] is None, key
    finally:
        app.dependency_overrides.clear()


# --- courier alias map: ShipSagar reports India Post as IP ---

def test_ip_resolves_through_the_india_post_matrix():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("IP", "Item Booked") == norm("INDIA_POST", "Item Booked") == "READY_TO_SHIP"
    # Rows where the courier matrix and the generic fallback disagree prove the
    # alias reaches _MATRIX. Before the fix IP landed on the generic matrix and
    # returned the third value in each row.
    disagreeing = [
        ("Door Locked", "FAILED_ATTEMPT", "EXCEPTION"),
        ("Redirected to other hub", "RTO", "EXCEPTION"),
        ("Item retained at hub", "EXCEPTION", "EXCEPTION"),
    ]
    for raw, india_post, generic in disagreeing:
        assert norm("IP", raw) == india_post, raw
        assert norm("INDIA_POST", raw) == india_post, raw
        assert norm("SOMETHING_ELSE", raw) == generic, raw


def test_courier_alias_tolerates_case_and_surrounding_whitespace():
    from app.services import shipsagar_service as ss
    assert ss.normalize_shipsagar_status(" ip ", "Door Locked") == "FAILED_ATTEMPT"
    assert ss.normalize_shipsagar_status("Ip", "Door Locked") == "FAILED_ATTEMPT"
    assert ss.normalize_shipsagar_status("india_post ", "Door Locked") == "FAILED_ATTEMPT"
    assert ss.resolve_courier(" ip ") == "INDIA_POST"
    assert ss.resolve_courier(None) == "" and ss.resolve_courier("  ") == ""
    # The alias map widens nothing: an unrecognized courier still falls through
    # to the generic matrix rather than being treated as India Post.
    assert ss.resolve_courier(" fedex ") == "FEDEX"
    assert ss.normalize_shipsagar_status("FEDEX", "Door Locked") == "EXCEPTION"


def test_register_tracking_accepts_the_ip_alias_and_any_real_courier_code(monkeypatch):
    """DELIBERATE UPDATE (final review, finding 9).

    This test used to assert that a FEDEX shipment raised UNSUPPORTED_COURIER.
    The whole-branch review found that inconsistent with the push dialog, which
    offers FEDEX and a free-text courier in COURIER_OPTIONS: the push accepted
    such a shipment, queued a retry, and that retry could only ever dead-letter
    with UNSUPPORTED_COURIER, so the parcel was never registered. ShipSagar
    aggregates many carriers while SUPPORTED_COURIERS only lists the ones this
    app has hand-written status matrices for, so registration now accepts any
    real courier and refuses only the internal MANUAL placeholder. Status
    normalization still routes an unlisted courier to the generic matrix.
    """
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    ip_id = _seed_shipment_with_order(mk, "IP-REG-1", courier="IP", order_no="MAN-IP1")
    fedex_id = _seed_shipment_with_order(mk, "FZ-REG-1", courier="FEDEX", order_no="MAN-FZ1")
    manual_id = _seed_shipment_with_order(mk, "MN-REG-1", courier="MANUAL", order_no="MAN-MN1")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=ip_id).first()
        seen = {}

        def _fake_push(*, tracking_no, courier_code, order):
            seen["awb"] = tracking_no
            seen["courier"] = courier_code
            return {"ok": True, "message": "Data has been recorded successfully"}

        monkeypatch.setattr(ss, "push_shipment", _fake_push)
        out = ss.register_tracking(db, s)
        assert out["pushed"] is True and out["stubbed"] is False
        # ShipSagar's own vocabulary goes back out on the wire: carrier_code
        # stores "IP", so the PushShipment CourierCode must be "IP" too.
        assert seen == {"awb": "IP-REG-1", "courier": "IP"}
        assert s.carrier_code == "IP"
        assert s.shipsagar_tracking_id == "SS-IP-REG-1"

        # The courier the push dialog offers and the retry used to refuse.
        fz = db.query(Shipment).filter_by(id=fedex_id).first()
        seen.clear()
        out = ss.register_tracking(db, fz)
        assert out["pushed"] is True
        assert seen == {"awb": "FZ-REG-1", "courier": "FEDEX"}
        assert fz.shipsagar_tracking_id == "SS-FZ-REG-1"
        # And it normalizes through the generic matrix, not to EXCEPTION-blind.
        from app.services.shipment_service import ingest_event
        ingest_event(db, fz, "Delivered to consignee", "Delivered to consignee",
                     "Mumbai", None, "fz-evt-1", "API")
        db.commit()
        assert fz.tracking_status == "DELIVERED"

        # MANUAL is the absence of a courier, not a courier.
        bad = db.query(Shipment).filter_by(id=manual_id).first()
        try:
            ss.register_tracking(db, bad)
            raise AssertionError("expected ShipsagarError")
        except ss.ShipsagarError as exc:
            assert exc.code == "UNSUPPORTED_COURIER"
    finally:
        db.close()


def test_webhook_accepts_an_ip_shipment_and_rolls_the_status_up(monkeypatch):
    """An IP shipment was rejected as UNSUPPORTED_COURIER before the alias.

    "Door Locked" is deliberately a row only the India Post matrix carries: the
    generic matrix would have rolled this up to EXCEPTION instead.
    """
    from app.models.shipment import Shipment
    mk = _mk()
    sid, bid = _seed_shipment(mk, carrier="IP", awb="IP123456789IN")
    c = _client(monkeypatch, mk)
    try:
        r = _post(c, {"event_id": "ip-evt-1", "tracking_number": "IP123456789IN",
                      "courier": "IP", "status": "Door Locked",
                      "location": "Delhi SP",
                      "event_time": datetime.now(timezone.utc).isoformat()}, bid=bid)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["created"] is True and data["stale"] is False
        assert data["tracking_status"] == "FAILED_ATTEMPT"
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.tracking_status == "FAILED_ATTEMPT"
            assert s.carrier_code == "IP"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_health_counts_an_ip_shipment_as_unregistered(monkeypatch):
    from app.models.business import Business
    from app.models.shipment import Shipment
    from app.models.user import User
    from app.services.auth_service import hash_password
    mk = _mk()
    db = mk()
    b = Business(name="B", email="ip-h@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="ip-h@t.in",
             password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    db.add(Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                    carrier_code="IP", awb_number="IP-H-1",
                    tracking_status="READY_TO_SHIP"))
    db.commit()
    db.close()
    c = _client(monkeypatch, mk)
    try:
        tok = c.post("/api/v1/auth/login",
                     json={"email": "ip-h@t.in", "password": "x"}).json()["data"]["token"]
        r = c.get("/api/v1/shipsagar/health",
headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["unregistered_shipments"] == 1
    finally:
        app.dependency_overrides.clear()


# --- review round 1: pin the date bound, the 400 path and the facet scope ---

def _utc(day, hour, minute, second=0, microsecond=0):
    from datetime import datetime as _dt
    return _dt(day.year, day.month, day.day, hour, minute, second,
               microsecond, tzinfo=timezone.utc)


def _seed_rows_at(mk, moments, *, courier="IP", email="lt@t.in", prefix="LT",
                  statuses=None):
    """Seed shipments whose created_at is an explicit instant, not "now".

    SQLite drops the tz offset when it stores a DateTime, so the aware
    instants below are persisted as their UTC wall clock and compared against
    _day_bounds the same way. That keeps the date-bound assertions independent
    of the time of day the suite happens to run at.
    """
    from app.models.business import Business
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="LT", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    cols = statuses or ["IN_TRANSIT"] * len(moments)
    for i, moment in enumerate(moments):
        o = Order(business_id=b.id, internal_order_number=f"{prefix}-{i}",
                  shopify_order_id=f"MANUAL-{prefix}-{i}", order_date=moment)
        db.add(o)
        db.commit()
        db.refresh(o)
        p = Parcel(business_id=b.id, order_id=o.id, parcel_code=f"{prefix}P{i}",
                   barcode_value=f"{prefix}{i}IN")
        db.add(p)
        db.commit()
        db.refresh(p)
        db.add(Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id,
                        carrier_code=courier, awb_number=f"{prefix}{i}IN",
                        tracking_status=cols[i],
                        shipsagar_tracking_id=f"SS-{prefix}{i}IN",
                        created_at=moment))
        db.commit()
    bid = b.id
    db.close()
    return bid


def test_date_bounds_include_the_named_days_final_microsecond(monkeypatch):
    """The end bound covers the whole named day, to its last microsecond.

    The earlier date test seeded at the current wall-clock time, which is
    mid-day, so it produced identical counts under an inclusive and an
    exclusive reading and could not tell them apart. These rows sit at 23:59:30
    and at exactly 23:59:59.999999 on the named day: the first proves the rest
    of the evening is not dropped, the second is the row that ``<=`` returns
    and ``<`` does not, so flipping the bound to an exclusive one turns this
    test red.
    """
    from datetime import timedelta
    mk = _mk()
    day = datetime.now(timezone.utc).date() - timedelta(days=1)
    _seed_rows_at(mk, [_utc(day, 23, 59, 30), _utc(day, 23, 59, 59, 999999)],
                  email="edge@t.in", prefix="ED")
    c, h, _ = _authed_for_list(monkeypatch, mk, email="edge@t.in")
    try:
        d = day.isoformat()
        earlier = (day - timedelta(days=1)).isoformat()
        r = c.get(f"/api/v1/shipments?date_to={d}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["total"] == 2, "date_to must include the whole day"
        r = c.get(f"/api/v1/shipments?date_from={d}&date_to={d}", headers=h)
        assert r.json()["data"]["total"] == 2, "a single named day must be closed"
        r = c.get(f"/api/v1/shipments?date_from={d}", headers=h)
        assert r.json()["data"]["total"] == 2
        r = c.get(f"/api/v1/shipments?date_to={earlier}", headers=h)
        assert r.json()["data"]["total"] == 0
        r = c.get(f"/api/v1/shipments?date_from={d}&date_to={(day + timedelta(days=1)).isoformat()}",
                  headers=h)
        assert r.json()["data"]["total"] == 2
    finally:
        app.dependency_overrides.clear()


def test_list_rejects_a_malformed_date_with_a_clean_400(monkeypatch):
    """A garbage date param must not surface as a 500.

    date_from / date_to are plain str params, so FastAPI never validates them
    and datetime.fromisoformat raised ValueError straight through the handler.
    """
    mk = _mk()
    _seed_list_rows(mk, n=1, email="bad@t.in", prefix="BAD")
    c, h, _ = _authed_for_list(monkeypatch, mk, email="bad@t.in")
    try:
        for qs in ("date_from=garbage", "date_to=2026-13-45",
                   "date_from=2026-02-30", "date_to=not-a-date-at-all"):
            r = c.get(f"/api/v1/shipments?{qs}", headers=h)
            assert r.status_code == 400, (qs, r.status_code, r.text)
            body = r.json()
            assert body["success"] is False, qs
            assert body["error"]["code"] == "INVALID_DATE", (qs, body)
            assert r.headers["X-Error-Code"] == "INVALID_DATE", qs
    finally:
        app.dependency_overrides.clear()


def test_list_status_filter_narrows_items_and_facets(monkeypatch):
    """status goes through the same explicit-column path as carrier.

    Both were broken by filter_by binding to the joined Order; only carrier had
    a test.
    """
    mk = _mk()
    _seed_list_rows(mk, n=3, courier="IP", email="st@t.in", prefix="ST")
    c, h, _ = _authed_for_list(monkeypatch, mk, email="st@t.in")
    try:
        data = c.get("/api/v1/shipments?status=DELIVERED", headers=h).json()["data"]
        assert data["total"] == 1
        assert data["items"][0]["awb_number"] == "EG0IN"
        assert {x["code"]: x["count"] for x in data["facets"]["statuses"]} == {"DELIVERED": 1}
        assert {x["code"]: x["count"] for x in data["facets"]["carriers"]} == {"IP": 1}
        lower = c.get("/api/v1/shipments?status=delivered", headers=h).json()["data"]
        assert lower["total"] == 1
        empty = c.get("/api/v1/shipments?status=RTO", headers=h).json()["data"]
        assert empty["total"] == 0
        assert empty["items"] == []
        assert empty["facets"]["statuses"] == []
        assert empty["facets"]["carriers"] == []
    finally:
        app.dependency_overrides.clear()


def test_facet_counts_never_include_another_tenants_shipments(monkeypatch):
    """The chips inherit their tenant scope from facet_q, and nothing else.

    The facet queries carry no business_id predicate of their own; they are
    safe only because the subquery they join is already scoped. If that scoping
    is ever dropped the chips would leak another tenant's counts while the
    paged items stayed correct, so this pins the chips directly across every
    filter shape - including the join-heavy q path and the narrow page.
    """
    from datetime import timedelta
    mk = _mk()
    day = datetime.now(timezone.utc).date() - timedelta(days=3)
    mine = [_utc(day, 9, 0), _utc(day, 9, 5)]
    theirs = [_utc(day, 10, 0), _utc(day, 11, 0), _utc(day, 12, 0), _utc(day, 13, 0)]
    _seed_rows_at(mk, mine, email="iso@t.in", prefix="M2",
                  statuses=["DELIVERED", "IN_TRANSIT"])
    _seed_rows_at(mk, theirs, email="notmine@t.in", prefix="N2", courier="DTDC",
                  statuses=["RTO", "RTO", "RTO", "RTO"])
    c, h, _ = _authed_for_list(monkeypatch, mk, email="iso@t.in")
    try:
        d = day.isoformat()
        for qs in ("", f"?page_size=1", "?q=IN", "?carrier=IP",
                   "?status=DELIVERED", f"?date_from={d}", "?order_no=M2-0"):
            data = c.get(f"/api/v1/shipments{qs}", headers=h).json()["data"]
            carriers = {x["code"]: x["count"] for x in data["facets"]["carriers"]}
            statuses = {x["code"]: x["count"] for x in data["facets"]["statuses"]}
            assert sum(carriers.values()) == data["total"], (qs, data)
            assert sum(statuses.values()) == data["total"], (qs, data)
            assert "DTDC" not in carriers, (qs, carriers)
            assert "RTO" not in statuses, (qs, statuses)
            assert set(carriers) <= {"IP"}, (qs, carriers)
            assert set(statuses) <= {"DELIVERED", "IN_TRANSIT"}, (qs, statuses)
    finally:
        app.dependency_overrides.clear()


def test_every_courier_alias_target_is_a_supported_courier():
    """A dangling alias would make the health counter over-report.

    ACCEPTED_COURIER_CODES drives unregistered_shipments; an alias pointing at
    a courier register_tracking refuses would count shipments that can never be
    registered, and the endpoint would read healthy forever.
    """
    from app.services import shipsagar_service as ss
    assert ss.COURIER_ALIASES, "the alias map should not be empty"
    for alias, target in ss.COURIER_ALIASES.items():
        assert target in ss.SUPPORTED_COURIERS, (alias, target)
        assert ss.resolve_courier(alias) == target
        assert alias in ss.ACCEPTED_COURIER_CODES
        assert target in ss.ACCEPTED_COURIER_CODES
    assert (set(ss.ACCEPTED_COURIER_CODES)
            == set(ss.SUPPORTED_COURIERS) | set(ss.COURIER_ALIASES))


# ---------------------------------------------------------------------------
# Final whole-branch review, round 1
# ---------------------------------------------------------------------------

def _hist(action_date, action_time, description, location=""):
    return {"ActionDate": action_date, "ActionTime": action_time,
            "ActionLocation": location, "ActionDescription": description}


def _track_response(history, awb="AWB-PRE", courier="IP"):
    return {"status": "SUCCESS", "message": "Data has been recorded successfully",
            "TrackingDetails": [{"ClientCode": "C1001", "TrackingNo": awb,
                                 "CourierCode": courier,
                                 "TrackingHistory": history}]}


# CRITICAL 1: the synthesized event id must not encode position in the array.

def test_track_shipment_event_ids_do_not_move_when_a_scan_is_prepended(monkeypatch):
    """ShipSagar documents no ordering for TrackingHistory, so the id may not
    be derived from position at all: one prepended scan shifts every index and
    used to re-derive every historical id."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    booked = _hist("16-May-2023", "12:27", "Item Booked", "Mumbai NSH")
    ofd = _hist("16-May-2023", "15:51", "Out for Delivery", "Pune HO")
    delivered = _hist("17-May-2023", "09:05", "Item Delivered", "Delhi SP")
    newest = _hist("17-May-2023", "19:43", "Item Delivered", "Delhi SP")

    monkeypatch.setattr(ss, "_post", lambda p, pl: _track_response([booked, ofd, delivered]))
    before = ss.track_shipment("AWB-PRE")
    monkeypatch.setattr(ss, "_post",
lambda p, pl: _track_response([newest, booked, ofd, delivered]))
    after = ss.track_shipment("AWB-PRE")

    def _key(ev):
        return (ev["status_raw"], ev["location"])

    assert [_key(e) for e in after["events"]] == (
        [_key(after["events"][0])] + [_key(e) for e in before["events"]])
    ids_before = {e["event_id"] for e in before["events"]}
    ids_after = {e["event_id"] for e in after["events"]}
    assert ids_before <= ids_after, "a prepended scan must not re-key the history"
    assert len(ids_after) == 4, "the new scan must add exactly one id"


def test_track_shipment_event_ids_separate_two_scans_at_the_same_instant(monkeypatch):
    """Two genuinely distinct scans sharing a timestamp still get two ids."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda p, pl: _track_response([
        _hist("16-May-2023", "12:27", "Out for Delivery", "Mumbai NSH"),
        _hist("16-May-2023", "12:27", "Out for Delivery", "Thane HO"),
    ]))
    ids = [e["event_id"] for e in ss.track_shipment("AWB-PRE")["events"]]
    assert len(set(ids)) == 2, ids


def test_polling_a_prepended_scan_does_not_re_ingest_the_history(monkeypatch):
    """End-to-end shape of the defect: 4 checkpoints must yield 4 rows, not 7."""
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services import shipsagar_service as ss
    from app.services.shipment_service import ingest_event
    _configured(monkeypatch)
    mk = _mk()
    sid, _ = _seed_pushed_shipment(mk, awb="AWB-PRE")
    booked = _hist("16-May-2023", "12:27", "Item Booked", "Mumbai NSH")
    ofd = _hist("16-May-2023", "15:51", "Out for Delivery", "Pune HO")
    delivered = _hist("17-May-2023", "09:05", "Item Delivered", "Delhi SP")
    newest = _hist("17-May-2023", "19:43", "Item Delivered", "Delhi SP")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        for history in ([booked, ofd, delivered], [newest, booked, ofd, delivered]):
            monkeypatch.setattr(ss, "_post", lambda p, pl, h=history: _track_response(h))
            for ev in ss.track_shipment("AWB-PRE")["events"]:
                ingest_event(db, s, ev["status_raw"], ev["message"], ev["location"],
                             ev["event_time"], ev["event_id"], "API", ev)
            db.commit()
        assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 4
        assert s.tracking_status == "DELIVERED"
    finally:
        db.close()


# CRITICAL 2: the polling path needs the same terminal/rank guard as the webhook.

def test_polled_checkpoint_never_regresses_a_delivered_shipment(monkeypatch):
    """Spec section 8: an out-of-order history entry cannot regress a delivery."""
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event
    mk = _mk()
    sid, _ = _seed_pushed_shipment(mk, awb="IP-REG-1", status="DELIVERED")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        stamp = datetime.now(timezone.utc)
        ingest_event(db, s, "Item Booked", "Item Booked", "Mumbai NSH", stamp,
                     "poll-late-booked", "API")
        db.commit()
        assert s.tracking_status == "DELIVERED"
        # The regressing checkpoint is still recorded as history.
        assert db.query(Shipment).filter_by(id=sid).first().tracking_status == "DELIVERED"
        from app.models.shipment import ShipmentEvent
        assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 1
    finally:
        db.close()


def test_polled_newest_first_history_still_ends_on_the_final_state(monkeypatch):
    """A newest-first history must land on DELIVERED, not on its first entry."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event
    mk = _mk()
    history = [
        ("Item Delivered", "DELIVERED"),
        ("Out for Delivery", "OUT_FOR_DELIVERY"),
        ("Item Booked", "READY_TO_SHIP"),
    ]
    for order in ("newest-first", "oldest-first"):
        sid, _ = _seed_pushed_shipment(mk, awb=f"IP-ORDER-{order}", status="READY_TO_SHIP")
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            rows = list(history)
            if order == "oldest-first":
                rows.reverse()
            base = datetime.now(timezone.utc) - _td(hours=6)
            for i, (raw, _) in enumerate(rows):
                ingest_event(db, s, raw, raw, "Delhi SP", base + _td(hours=i),
                             f"poll-{order}-{i}", "API")
            db.commit()
            assert s.tracking_status == "DELIVERED", (order, s.tracking_status)
            assert s.delivered_at is not None, order
        finally:
            db.close()


def test_polled_rank_regress_with_a_newer_timestamp_is_not_rolled_up(monkeypatch):
    """The rank guard holds even when the regressing scan claims to be newer."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event
    mk = _mk()
    sid, _ = _seed_pushed_shipment(mk, awb="IP-RANK-1", status="DELIVERED")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        ingest_event(db, s, "Out for Delivery", "Out for Delivery", "Delhi SP",
                     datetime.now(timezone.utc) + _td(hours=1), "poll-rank-1", "API")
        db.commit()
        assert s.tracking_status == "DELIVERED"
    finally:
        db.close()


# CRITICAL 3: one failed operation must leave exactly one job advancing.

def test_retry_queue_does_not_fork_a_second_job_on_every_drain(monkeypatch):
    """register_tracking scheduled a NEW job and re-raised; the drain then
    advanced the ORIGINAL job, so every failure left two PENDING rows."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-FORK", order_no="MAN-FORK")
    db = mk()
    s = db.query(Shipment).filter_by(id=sid).first()
    bid = s.business_id
    db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                             shipment_id=sid, attempts=1, max_attempts=4,
                             status="PENDING",
                             next_retry_at=datetime.now(timezone.utc) - _td(seconds=5)))
    db.commit()

    def _boom(**kw):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

    monkeypatch.setattr(ss, "push_shipment", _boom)
    try:
        pending_per_drain = []
        for _ in range(6):
            for job in db.query(ShipsagarRetryJob).filter_by(status="PENDING").all():
                job.next_retry_at = datetime.now(timezone.utc) - _td(seconds=5)
            db.commit()
            ss.drain_retry_queue(db)
            db.commit()
            pending_per_drain.append(
                db.query(ShipsagarRetryJob).filter_by(status="PENDING").count())
        assert max(pending_per_drain) == 1, pending_per_drain
        assert db.query(ShipsagarRetryJob).count() == 1, "the queue forked"
        dead = db.query(ShipsagarRetryJob).filter_by(status="DEAD_LETTER").all()
        assert len(dead) == 1 and dead[0].attempts == 4
        assert pending_per_drain[-1] == 0, pending_per_drain
    finally:
        db.close()


# IMPORTANT 4 + 5: the health endpoint must be tenant scoped, and rejected_pushes
# must be able to clear.

def _seed_health_tenant(mk, email, courier="DTDC", registered=False, awb="H-1"):
    """A Business plus one shipment. The User is left to _authed_for_list."""
    from app.models.business import Business
    db = mk()
    b = db.query(Business).filter_by(email=email).first()
    if b is None:
        b = Business(name="H", email=email)
        db.add(b)
        db.commit()
        db.refresh(b)
    db.add(ShipmentFixture(business_id=b.id, order_id=f"o-{awb}", parcel_id=f"p-{awb}",
                           courier=courier, awb=awb, registered=registered))
    db.commit()
    bid = b.id
    db.close()
    return bid


def ShipmentFixture(*, business_id, order_id, parcel_id, courier, awb, registered):
    from app.models.shipment import Shipment
    return Shipment(business_id=business_id, order_id=order_id, parcel_id=parcel_id,
                    carrier_code=courier, awb_number=awb, tracking_status="READY_TO_SHIP",
                    shipsagar_tracking_id=(f"SS-{awb}" if registered else None))


def test_health_counters_never_include_another_tenants_rows(monkeypatch):
    """All five counters must answer for the caller's tenant only.

    failed_webhooks / failed_jobs / pending_jobs / unregistered_shipments were
    global while rejected_pushes was scoped, so a tenant read every other
    tenant's failure and backlog counts out of one response.
    """
    from app.models.shipment_event import (ShipsagarRetryJob,
                                           ShipsagarWebhookFailure)
    mk = _mk()
    _seed_health_tenant(mk, "mine@h.in", awb="MINE-1")
    _seed_health_tenant(mk, "theirs@h.in", awb="THEM-1")
    db = mk()
    from app.models.business import Business
    other = db.query(Business).filter_by(email="theirs@h.in").first().id
    db.add_all([
        ShipsagarWebhookFailure(business_id=other, reason="INVALID_SIGNATURE",
                                detail="x"),
        ShipsagarWebhookFailure(business_id=None, reason="UNKNOWN_BUSINESS", detail="x"),
        ShipsagarRetryJob(business_id=other, operation="register_tracking",
                          shipment_id=None, attempts=4, max_attempts=4,
                          status="DEAD_LETTER"),
        ShipsagarRetryJob(business_id=other, operation="register_tracking",
                          shipment_id=None, attempts=1, max_attempts=4,
                          status="PENDING"),
    ])
    db.commit()
    db.close()
    c, h, _ = _authed_for_list(monkeypatch, mk, email="mine@h.in")
    try:
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["failed_webhooks"] == 0, data
        assert data["failed_jobs"] == 0, data
        assert data["pending_jobs"] == 0, data
        assert data["unregistered_shipments"] == 1, data
        assert data["rejected_pushes"] == 0, data
    finally:
        app.dependency_overrides.clear()


def test_health_endpoint_counts_own_pending_and_dead_letter_jobs(monkeypatch):
    """The scoping fix must not zero out a tenant's own backlog."""
    from app.models.business import Business
    from app.models.shipment_event import ShipsagarRetryJob, ShipsagarWebhookFailure
    mk = _mk()
    _seed_health_tenant(mk, "own@h.in", awb="OWN-1")
    db = mk()
    bid = db.query(Business).filter_by(email="own@h.in").first().id
    db.add_all([
        ShipsagarWebhookFailure(business_id=bid, reason="INVALID_SIGNATURE", detail="x"),
        ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                          shipment_id=None, attempts=4, max_attempts=4,
                          status="DEAD_LETTER"),
        ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                          shipment_id=None, attempts=1, max_attempts=4,
                          status="PENDING"),
    ])
    db.commit()
    db.close()
    c, h, _ = _authed_for_list(monkeypatch, mk, email="own@h.in")
    try:
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["failed_webhooks"] == 1, data
        assert data["failed_jobs"] == 1, data
        assert data["pending_jobs"] == 1, data
        assert data["status"] == "warning"
    finally:
        app.dependency_overrides.clear()


def test_rejected_pushes_clears_once_the_parcel_is_registered(monkeypatch):
    """A refusal is not permanent state, and the counter has to be able to say so.

    It counted append-only audit rows with no resolution state, so one refusal
    pinned the tenant to status "warning" forever. It now counts refusals with no
    later accepted push and no DONE retry job for that shipment.
    """
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        db = mk()
        db.add_all([
            Shipment(business_id=bid, order_id="o1", parcel_id="p1",
                     carrier_code="DTDC", awb_number="D-CLEAR", tracking_status="READY_TO_SHIP"),
            Shipment(business_id=bid, order_id="o2", parcel_id="p2",
                     carrier_code="DTDC", awb_number="D-STUCK", tracking_status="READY_TO_SHIP"),
        ])
        db.commit()
        clear_id = db.query(Shipment).filter_by(awb_number="D-CLEAR").first().id
        db.close()

        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "Invalid AWB for the courier"})
        assert c.post(f"/api/v1/shipments/{clear_id}/register-tracking",
                      headers=h).status_code == 200
        assert c.get("/api/v1/shipsagar/health", headers=h).json()["data"]["rejected_pushes"] == 1

        # A later successful push resolves it; the other parcel stays refused.
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": True, "message": "Data has been recorded successfully"})
        assert c.post(f"/api/v1/shipments/{clear_id}/register-tracking",
                      headers=h).status_code == 200
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["rejected_pushes"] == 0, data
        assert data["status"] == "healthy", data
    finally:
        app.dependency_overrides.clear()


def test_rejected_pushes_clears_on_a_done_retry_job(monkeypatch):
    """The other half of resolution: a retry that eventually landed."""
    from datetime import timedelta as _td
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    try:
        db = mk()
        s = Shipment(business_id=bid, order_id="o1", parcel_id="p1", carrier_code="DTDC",
                     awb_number="D-JOB", tracking_status="READY_TO_SHIP")
        db.add(s)
        db.commit()
        sid = s.id
        db.close()
        _configured(monkeypatch)
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "please try again later"})
        assert c.post(f"/api/v1/shipments/{sid}/register-tracking", headers=h).status_code == 200
        assert c.get("/api/v1/shipsagar/health", headers=h).json()["data"]["rejected_pushes"] == 1
        db = mk()
        db.add(ShipsagarRetryJob(business_id=bid, operation="register_tracking",
                                 shipment_id=sid, attempts=2, max_attempts=4,
                                 status="DONE",
                                 next_retry_at=datetime.now(timezone.utc) - _td(seconds=5)))
        db.commit()
        db.close()
        data = c.get("/api/v1/shipsagar/health", headers=h).json()["data"]
        assert data["rejected_pushes"] == 0, data
    finally:
        app.dependency_overrides.clear()


def test_terminal_status_vocabulary_is_shared_by_the_backend_and_the_page():
    """shipment_service.TERMINAL is the set both sync and poll-sweep stop on,
    and web/src/lib/shipments.ts TERMINAL_STATUSES is the set the page stops
    refreshing on. RTO was terminal to the page but not to the backend, so a
    ShipSagar RTO parcel stopped refreshing and could never reach RETURNED;
    RTO_DELIVERED and CLOSED were the reverse. The frontend test
    shipments-client.test.tsx pins the identical list."""
    from app.services.shipment_service import TERMINAL
    from app.services.shipsagar_service import STATUSES as SHIPSAGAR_STATUSES
    # Nothing in the ShipSagar vocabulary may be terminal to one side only.
    assert set(SHIPSAGAR_STATUSES) & set(TERMINAL) == {"DELIVERED", "RETURNED", "LOST"}
    # RTO is forward-progressible (RTO -> RETURNED), so it must not be terminal.
    assert "RTO" not in TERMINAL
    assert {"RTO_DELIVERED", "CLOSED"} <= set(TERMINAL)


def test_a_refused_push_for_an_already_shipped_order_is_reported(monkeypatch):
    """The dialog's already-has-a-shipment filter had to be removed.

    GET /api/v1/orders cannot say whether an order already has a shipment - the
    three fields that used to answer it are not in the committed serializer. So
    the picker can no longer pre-filter, and the push endpoint's own refusal is
    the only authority. This pins that refusal on the order field, which is
    where the dialog maps SHIPMENT_EXISTS, so a user who picks an already-pushed
    order is told on the Order control rather than silently accepted.
    """
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk, email="dupe@t.in")
    _configured(monkeypatch)
    try:
        first = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-DUP-1", "courier_code": "IP"})
        assert first.status_code == 200, first.text
        again = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-DUP-2", "courier_code": "IP"})
        assert again.status_code == 400, again.text
        assert again.json()["error"]["code"] == "SHIPMENT_EXISTS"
        assert "already has a shipment" in again.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


# IMPORTANT 8: the push dialog must read only what the orders serializer
# genuinely returns. The three fields it used to read (order_no, customer_name,
# shipment_id) are NOT in the committed serializer, so they were reverted out of
# the dialog rather than added to the serializer.

def test_orders_list_returns_the_fields_the_push_dialog_reads(monkeypatch):
    """Pin the real contract, not the aspirational one.

    The dialog used to read order_no / customer_name / shipment_id. None of the
    three is in the committed serializer, so the dialog's label and Customer
    preview were reading undefined while its own tests stubbed those exact fields
    and passed against a shape the backend cannot produce.

    Both order numbers are returned under their own column names, so the label
    the user sees is unchanged; the picker labels from those instead. The
    already-has-a-shipment filter cannot be derived from this endpoint at all
    (Shipment has no column on Order and _to_dict is a pure function of one), so
    the dialog now lets the push endpoint's own SHIPMENT_EXISTS refusal be the
    authority - see test_a_refused_push_for_an_already_shipped_order_is_reported
    on the order field. Re-apply the pair when the India Post work lands.
    """
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk, email="ord2@t.in")
    try:
        # Same tenant this time, so both orders are visible in one page.
        db = mk()
        pushed = Order(business_id=bid, internal_order_number="MAN-PUSHED",
                       shopify_order_id="MANUAL-PUSHED",
                       order_date=datetime.now(timezone.utc))
        db.add(pushed)
        db.commit()
        db.refresh(pushed)
        p = Parcel(business_id=bid, order_id=pushed.id, parcel_code="PO",
                   barcode_value="PO-IN")
        db.add(p)
        db.commit()
        db.refresh(p)
        s = Shipment(business_id=bid, order_id=pushed.id, parcel_id=p.id,
                     carrier_code="IP", awb_number="PO-IN", tracking_status="IN_TRANSIT")
        db.add(s)
        db.commit()
        sid = s.id
        db.refresh(pushed)
        db.close()
        pushed_id = pushed.id

        r = c.get("/api/v1/orders?page_size=100", headers=h)
        assert r.status_code == 200, r.text
        items = {row["id"]: row for row in r.json()["data"]["items"]}
        assert oid in items and pushed_id in items
        # DELIBERATE UPDATE (fix wave 2, item 1). This test used to assert the
        # serializer grew order_no / customer_name / shipment_id, and the shipped
        # half of that fix lived only in an UNCOMMITTED edit to app/api/orders.py
        # (mixed into another feature's India Post hunk), so the committed branch
        # asserted fields its own serializer never returned and failed at HEAD.
        # The human ruled twice on this exact class of problem - revert the
        # committed side now, re-apply the pair once the other feature lands - so
        # the assertions below now pin what the dialog must genuinely be able to
        # read instead. Both order numbers ARE returned by the committed
        # serializer under their own column names, which is what the dialog now
        # reads; the label a user sees is therefore the same string either way.
        assert items[oid]["internal_order_number"] == "MAN-P1"
        assert items[oid]["shopify_order_name"] is not None
        assert items[pushed_id]["internal_order_number"] == "MAN-PUSHED"
        # And it must NOT claim the three fields the committed tree does not
        # send, so a future reader cannot mistake them for available again.
        for row in items.values():
            assert "order_no" not in row
            assert "customer_name" not in row
            assert "shipment_id" not in row
    finally:
        app.dependency_overrides.clear()


# IMPORTANT 6: db_normalize must key on the courier a tenant configures.

def test_courier_status_mapping_still_applies_after_a_parcel_is_pushed(monkeypatch):
    """A tenant keys CourierStatusMapping on the courier code they configure.

    After Task 4 a pushed shipment resolves provider SHIPSAGAR while its
    carrier_code stays the courier code, so keying the lookup on the provider
    silently dropped every such mapping the moment a parcel was pushed.
    """
    from app.models.courier_meta import CourierStatusMapping
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event
    mk = _mk()
    sid, _ = _seed_pushed_shipment(mk, awb="IP-MAP-1", courier="IP")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        bid = s.business_id
        # Provider-keyed (what the app used to ask for) and courier-keyed.
        db.add_all([
            CourierStatusMapping(business_id=bid, provider="SHIPSAGAR",
                                  provider_status_code="Item Delivered",
                                  normalized_status="DELIVERED"),
            CourierStatusMapping(business_id=bid, provider="IP",
                                  provider_status_code="Item Booked",
                                  normalized_status="READY_TO_SHIP"),
        ])
        db.commit()
        ingest_event(db, s, "Item Booked", "Item Booked", "Mumbai NSH", None,
                     "map-1", "API")
        db.commit()
        assert s.tracking_status == "READY_TO_SHIP"
        # And a global (business_id NULL) mapping keyed on the courier applies.
        db.add(CourierStatusMapping(business_id=None, provider="IP",
                                    provider_status_code="Out for delivery",
                                    normalized_status="OUT_FOR_DELIVERY"))
        db.commit()
        ingest_event(db, s, "Out for delivery", "Out for delivery", "Pune HO", None,
                     "map-2", "API")
        db.commit()
        assert s.tracking_status == "OUT_FOR_DELIVERY"
    finally:
        db.close()


# IMPORTANT 7: one dedupe scope across the webhook and the polling path.

def test_one_provider_event_id_is_recorded_once_for_each_shipment(monkeypatch):
    """The webhook probe was keyed globally on (provider, provider_event_id).

    Each shipment now records a checkpoint once for itself, and the two paths
    share one probe, so a repeat delivery to either shipment dedupes. The one
    thing still blocked is storing the SAME provider event id against a second
    shipment: shipment_events carries UniqueConstraint(provider,
    provider_event_id) from plan #20/#53, which is global, so that case is a
    mis-delivery and is reported as deduped rather than crashing on the
    constraint (see find_provider_event).
    """
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services import shipsagar_service as ss
    mk = _mk()
    s1, bid = _seed_shipment(mk, carrier="INDIA_POST", awb="SHARED-1")
    db = mk()
    db.add(Shipment(business_id=bid, order_id="o2", parcel_id="p2",
                    carrier_code="INDIA_POST", awb_number="SHARED-2",
                    tracking_status="READY_TO_SHIP"))
    db.commit()
    s2 = db.query(Shipment).filter_by(awb_number="SHARED-2").first().id
    db.close()
    c = _client(monkeypatch, mk)
    try:
        for sid, awb in ((s1, "SHARED-1"), (s2, "SHARED-2")):
            r = _post(c, {"event_id": f"evt-{sid}",
                          "tracking_number": awb,
                          "courier": "INDIA_POST", "status": "Item Delivered",
                          "event_time": datetime.now(timezone.utc).isoformat()},
                      bid=bid)
            assert r.status_code == 200, r.text
            assert r.json()["data"]["created"] is True, (sid, r.text)
        db = mk()
        try:
            assert db.query(ShipmentEvent).filter_by(provider="SHIPSAGAR").count() == 2
            for sid in (s1, s2):
                assert db.query(Shipment).filter_by(
                    id=sid).first().tracking_status == "DELIVERED"
                # A repeat delivery to the same shipment still dedupes.
                dup = ss.ingest_shipsagar_event(
                    db, db.query(Shipment).filter_by(id=sid).first(),
                    event_id=f"evt-{sid}", courier="INDIA_POST",
                    raw_status="Item Delivered")
                assert dup[1] is False
            db.commit()
            assert db.query(ShipmentEvent).filter_by(provider="SHIPSAGAR").count() == 2
            # The global constraint is a mis-delivery, not a crash.
            other = ss.ingest_shipsagar_event(
                db, db.query(Shipment).filter_by(id=s2).first(),
                event_id="evt-" + s1, courier="INDIA_POST", raw_status="Item Delivered")
            assert other[1] is False
            db.commit()
            assert db.query(ShipmentEvent).filter_by(provider="SHIPSAGAR").count() == 2
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_a_checkpoint_delivered_by_both_paths_is_recorded_once(monkeypatch):
    """Webhook and polling are both live; the same checkpoint is one row."""
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services import shipsagar_service as ss
    from app.services.shipment_service import ingest_event
    mk = _mk()
    sid, bid = _seed_pushed_shipment(mk, awb="IP-BOTH-1", courier="IP")
    c = _client(monkeypatch, mk)
    try:
        r = _post(c, {"event_id": "both-evt-1", "tracking_number": "IP-BOTH-1",
                      "courier": "IP", "status": "Item Delivered",
                      "event_time": datetime.now(timezone.utc).isoformat()}, bid=bid)
        assert r.status_code == 200, r.text
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            ingest_event(db, s, "Item Delivered", "Item Delivered", "Delhi SP",
                         datetime.now(timezone.utc), "both-evt-1", "API")
            db.commit()
            assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 1
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


# MINOR: _day_bounds accepted compact and ISO-week spellings.

def test_list_rejects_compact_and_iso_week_date_spellings(monkeypatch):
    """datetime.fromisoformat accepts "20261003" and "2026-W40-1" on 3.11+.

    Neither is len 10, so the whole-day branch was skipped and a bare
    date_to silently meant midnight - the row at 23:59 that day was dropped.
    """
    mk = _mk()
    _seed_list_rows(mk, n=1, email="compact@t.in", prefix="CMP")
    c, h, _ = _authed_for_list(monkeypatch, mk, email="compact@t.in")
    try:
        for qs in ("date_from=20261003", "date_to=20261003", "date_from=2026-W40-1",
                   "date_to=20261003T00:00:00+00:00"):
            r = c.get(f"/api/v1/shipments?{qs}", headers=h)
            assert r.status_code == 400, (qs, r.status_code, r.text)
            assert r.json()["error"]["code"] == "INVALID_DATE", (qs, r.text)
    finally:
        app.dependency_overrides.clear()


# IMPORTANT 9: a courier the push dialog offers must be registrable by the retry.

def test_a_pushed_couriers_queued_retry_can_actually_register_it(monkeypatch):
    """FEDEX is in COURIER_OPTIONS, so a FEDEX push must complete.

    The push accepted any courier but the retry it queued dispatched through
    register_tracking, which only accepted SUPPORTED_COURIERS, so a FEDEX
    shipment burned all four attempts on UNSUPPORTED_COURIER and was never
    registered.
    """
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    _configured(monkeypatch)

    def _boom(**kw):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

    monkeypatch.setattr(ss, "push_shipment", _boom)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "FZ-PUSH-1", "courier_code": "FEDEX"})
        assert r.status_code == 502, r.text
        db = mk()
        try:
            job = db.query(ShipsagarRetryJob).filter_by(status="PENDING").first()
            assert job is not None
            job.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=5)
            db.commit()

            seen = {}

            def _recovered(*, tracking_no, courier_code, order):
                seen["courier"] = courier_code
                return {"ok": True, "message": "Data has been recorded successfully"}

            monkeypatch.setattr(ss, "push_shipment", _recovered)
            out = ss.drain_retry_queue(db)
            db.commit()
            assert seen == {"courier": "FEDEX"}, seen
            assert out["succeeded"] == 1 and out["dead_lettered"] == 0
            s = db.query(Shipment).filter_by(business_id=bid).first()
            assert s.shipsagar_tracking_id == "SS-FZ-PUSH-1"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


# MINOR: the courier-specific matrix matched "rto" as a substring, and the Task 7
# alias routed the DEFAULT courier (IP) into those rows.

def test_ip_no_longer_normalizes_a_carton_as_rto():
    """Task 3 froze plain substring matching in _MATRIX on purpose, because no
    row was reachable yet. The Task 7 alias then routed IP - the push dialog's
    default courier - into exactly those rows, so the looseness became live:
    norm("IP", "Packed in carton") == "RTO". The generic matrix already solved
    this with word-boundary matching; the courier rows now use it too."""
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("IP", "Packed in carton") != "RTO"
    assert norm("IP", "Carton sealed") != "RTO"
    assert norm("IP", "Carton sealed and shipped") == norm("INDIA_POST", "Carton sealed and shipped")
    # Real RTO phrasings on the aliased courier still resolve.
    for raw in ("RTO", "RTO initiated", "RTO in transit", "Return to sender"):
        assert norm("IP", raw) == "RTO", raw
    assert norm("INDIA_POST", "Return to sender") == "RTO"
    assert norm("DTDC", "RTO Delivered back to shipper") == "RETURNED"
    assert norm("IP", "Door Locked") == "FAILED_ATTEMPT"
    assert norm("IP", "Redirected to another address") == "RTO"


def _seed_shipment_under(mk, business_id, awb, status):
    from app.models.shipment import Shipment
    db = mk()
    s = Shipment(business_id=business_id, order_id="o-manual", parcel_id="p-manual",
                 carrier_code="IP", awb_number=awb, tracking_status=status,
                 shipsagar_tracking_id=f"SS-{awb}")
    db.add(s)
    db.commit()
    sid = s.id
    db.close()
    return sid

# --- manual checkpoint corrections must not silently no-op ---

def test_manual_correction_on_a_terminal_shipment_is_reported_not_silently_dropped(monkeypatch):
    """A warehouse user overriding a DELIVERED status used to get 200 with
    created:true and an unchanged tracking_status, with nothing signalling the
    roll-up had been suppressed. It must be reported."""
    from app.models.shipment import Shipment
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    sid = _seed_shipment_under(mk, bid, awb="EG-MANUAL-1", status="DELIVERED")
    try:
        r = c.post(f"/api/v1/shipments/{sid}/events", headers=h, json={
            "carrier_event_id": "manual-1",
            "carrier_status_raw": "In Transit",
            "message": "customer says it is not delivered",
        })
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["created"] is True
        assert data["rollup_applied"] is False
        assert data["tracking_status"] == "DELIVERED"
        assert data["rollup_suppressed_reason"]
    finally:
        app.dependency_overrides.clear()


def test_manual_checkpoint_that_does_apply_is_reported_as_applied(monkeypatch):
    mk = _mk()
    c, h, bid = _authed(monkeypatch, mk)
    sid = _seed_shipment_under(mk, bid, awb="EG-MANUAL-2", status="IN_TRANSIT")
    try:
        r = c.post(f"/api/v1/shipments/{sid}/events", headers=h, json={
            "carrier_event_id": "manual-2",
            "carrier_status_raw": "Out for delivery",
            "message": "out for delivery today",
        })
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["rollup_applied"] is True
        assert data["tracking_status"] == "OUT_FOR_DELIVERY"
    finally:
        app.dependency_overrides.clear()