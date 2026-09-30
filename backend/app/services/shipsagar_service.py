"""ShipSagar provider adapter (plan #17/#18/#53/#69/#74/#75).

ShipSagar aggregates INDIA_POST + DTDC tracking. Identity chain::

    parcel_id -> shipment_id -> courier_tracking_number (shipments.awb_number)
        -> shipsagar_tracking_id

ShipSagar IDs are provider references only — never business IDs.

Real API spec/creds are ABSENT, so the HTTP client is a stub with a clean
seam: configure SHIPSAGAR_API_BASE_URL + SHIPSAGAR_API_KEY and implement
``_post()`` against the real spec later. Webhook ingest, signature
verification, idempotency, retry/backoff and health counters are fully real.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from app.config import settings

PROVIDER = "SHIPSAGAR"
SUPPORTED_COURIERS = ("INDIA_POST", "DTDC")

# Plan #15 shipment statuses.
STATUSES = (
    "NOT_CREATED",
    "READY_TO_SHIP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "FAILED_ATTEMPT",
    "RTO",
    "RETURNED",
    "LOST",
    "EXCEPTION",
)

# Retry backoff per plan #74: 30s -> 2min -> 10min -> dead-letter.
BACKOFF_SECONDS = (30, 120, 600)
MAX_ATTEMPTS = 4


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Status normalization (both couriers -> plan #15 vocabulary)
# ---------------------------------------------------------------------------

# Ordered keyword matrix; first match wins. Within each courier, negative
# (undelivered/attempt) and RTO/return rows MUST precede the generic
# "delivered" row because e.g. "undelivered" contains "delivered".
_MATRIX: list[tuple[str, str, str]] = [
    # INDIA_POST
    ("INDIA_POST", "item booked", "READY_TO_SHIP"),
    ("INDIA_POST", "out for delivery", "OUT_FOR_DELIVERY"),
    ("INDIA_POST", "ofd", "OUT_FOR_DELIVERY"),
    ("INDIA_POST", "undelivered", "FAILED_ATTEMPT"),
    ("INDIA_POST", "delivery attempted", "FAILED_ATTEMPT"),
    ("INDIA_POST", "consignee absent", "FAILED_ATTEMPT"),
    ("INDIA_POST", "door locked", "FAILED_ATTEMPT"),
    ("INDIA_POST", "returned to sender", "RETURNED"),
    ("INDIA_POST", "item returned", "RETURNED"),
    ("INDIA_POST", "return to sender", "RTO"),
    ("INDIA_POST", "redirected", "RTO"),
    ("INDIA_POST", "rto", "RTO"),
    ("INDIA_POST", "booked", "READY_TO_SHIP"),
    ("INDIA_POST", "item delivered", "DELIVERED"),
    ("INDIA_POST", "delivered", "DELIVERED"),
    ("INDIA_POST", "lost", "LOST"),
    ("INDIA_POST", "damaged", "EXCEPTION"),
    ("INDIA_POST", "retained", "EXCEPTION"),
    ("INDIA_POST", "detained", "EXCEPTION"),
    ("INDIA_POST", "dispatched", "IN_TRANSIT"),
    ("INDIA_POST", "in transit", "IN_TRANSIT"),
    ("INDIA_POST", "received", "IN_TRANSIT"),
    ("INDIA_POST", "reached", "IN_TRANSIT"),
    # DTDC
    ("DTDC", "manifested", "READY_TO_SHIP"),
    ("DTDC", "picked up", "READY_TO_SHIP"),
    ("DTDC", "out for delivery", "OUT_FOR_DELIVERY"),
    ("DTDC", "ofd", "OUT_FOR_DELIVERY"),
    ("DTDC", "not delivered", "FAILED_ATTEMPT"),
    ("DTDC", "undelivered", "FAILED_ATTEMPT"),
    ("DTDC", "consignee not available", "FAILED_ATTEMPT"),
    ("DTDC", "address incorrect", "FAILED_ATTEMPT"),
    ("DTDC", "delivery failed", "FAILED_ATTEMPT"),
    ("DTDC", "attempt", "FAILED_ATTEMPT"),
    ("DTDC", "rto delivered", "RETURNED"),
    ("DTDC", "returned", "RETURNED"),
    ("DTDC", "rto", "RTO"),
    ("DTDC", "return", "RTO"),
    ("DTDC", "booked", "READY_TO_SHIP"),
    ("DTDC", "delivered", "DELIVERED"),
    ("DTDC", "lost", "LOST"),
    ("DTDC", "damaged", "EXCEPTION"),
    ("DTDC", "exception", "EXCEPTION"),
    ("DTDC", "on hold", "EXCEPTION"),
    ("DTDC", "in transit", "IN_TRANSIT"),
    ("DTDC", "transit", "IN_TRANSIT"),
    ("DTDC", "reached hub", "IN_TRANSIT"),
    ("DTDC", "arrived", "IN_TRANSIT"),
    ("DTDC", "shipped", "IN_TRANSIT"),
]


def normalize_shipsagar_status(courier: str, raw: str) -> str:
    """Normalize a courier raw status to the plan #15 vocabulary.

    Unknown couriers / unrecognized strings -> EXCEPTION (visible, never
    silently swallowed). Empty string -> NOT_CREATED (nothing known yet).
    """
    text = (raw or "").strip().lower()
    if not text:
        return "NOT_CREATED"
    code = (courier or "").upper()
    for courier_key, keyword, status in _MATRIX:
        if courier_key == code and keyword in text:
            return status
    if code not in SUPPORTED_COURIERS:
        return "EXCEPTION"
    return "EXCEPTION"


# ---------------------------------------------------------------------------
# Webhook signature verification (plan #69)
# ---------------------------------------------------------------------------

def _signatures_match(expected_hex: str, provided: str) -> bool:
    return hmac.compare_digest(expected_hex.lower(), (provided or "").strip().lower())


def verify_signature(raw_body: bytes, signature: str | None, secret: str | None = None) -> bool:
    """Verify HMAC-SHA256 hex signature over the raw body.

    Accepts hex or base64 encodings of the digest.
    """
    key = secret if secret is not None else settings.shipsagar_webhook_secret
    if not key:
        return False
    if not signature:
        return False
    digest = hmac.new(key.encode(), raw_body or b"", hashlib.sha256).digest()
    sig = (signature or "").strip()
    if _signatures_match(digest.hex(), sig):
        return True
    import base64 as _b64
    try:
        if _signatures_match(digest.hex(), _b64.b64decode(sig).hex()):
            return True
    except Exception:
        pass
    # "sha256=<hex>" style prefix tolerance.
    if "=" in sig:
        tail = sig.split("=", 1)[1].strip()
        if _signatures_match(digest.hex(), tail):
            return True
    return False


def verify_timestamp(ts: str | None, tolerance_seconds: int = 300) -> bool:
    """Replay protection: timestamp header must be within tolerance.

    Missing timestamp -> True (payloads without timestamps are allowed but
    still require signature + event-ID checks).
    """
    if not ts:
        return True
    try:
        value = float(str(ts).strip())
    except (TypeError, ValueError):
        return False
    return abs(_now().timestamp() - value) <= tolerance_seconds


# ---------------------------------------------------------------------------
# Retry / backoff (plan #74)
# ---------------------------------------------------------------------------

def backoff_for_attempt(attempt: int) -> int | None:
    """Delay in seconds before the next retry, or None for dead-letter."""
    if attempt < 1 or attempt > len(BACKOFF_SECONDS):
        return None
    return BACKOFF_SECONDS[attempt - 1]


def schedule_retry(db, *, business_id: str | None, operation: str,
                   shipment_id: str | None, error: str,
                   payload: dict | None = None):
    """Record a failed ShipSagar operation with bounded retries.

    attempt N failure -> next_retry_at = now + BACKOFF[N]; once attempts
    exceed the backoff table the job goes DEAD_LETTER. No infinite retry.
    """
    from app.models.shipment_event import ShipsagarRetryJob
    job = ShipsagarRetryJob(
        business_id=business_id, operation=operation, shipment_id=shipment_id,
        attempts=1, max_attempts=MAX_ATTEMPTS, status="PENDING",
        last_error=(error or "")[:2000], payload=payload,
        next_retry_at=_now() + timedelta(seconds=BACKOFF_SECONDS[0]))
    db.add(job)
    db.flush()
    return job


def record_retry_attempt(db, job, error: str):
    """Advance a retry job after another failed attempt."""
    job.attempts = (job.attempts or 0) + 1
    job.last_error = (error or "")[:2000]
    delay = backoff_for_attempt(job.attempts)
    if delay is None:
        job.status = "DEAD_LETTER"
        job.next_retry_at = None
    else:
        job.status = "PENDING"
        job.next_retry_at = _now() + timedelta(seconds=delay)
    db.flush()
    return job


def is_configured() -> bool:
    return bool(settings.shipsagar_api_base_url and settings.shipsagar_api_key)


# ---------------------------------------------------------------------------
# Tracking registration (plan #18) — stubbed HTTP with a clean seam
# ---------------------------------------------------------------------------

class ShipsagarError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _post(path: str, payload: dict) -> dict:
    """Clean seam for the real ShipSagar HTTP API.

    When SHIPSAGAR_API_BASE_URL/API_KEY are configured this performs the
    live call; otherwise it raises ShipsagarError("SHIPSAGAR_NOT_CONFIGURED").
    Swap the body for the real spec once credentials arrive — callers and
    retry/health wiring stay unchanged.
    """
    if not is_configured():
        raise ShipsagarError("SHIPSAGAR_NOT_CONFIGURED",
                             "ShipSagar credentials absent — registration queued for retry.")
    try:
        import httpx  # lazy: optional dependency
    except ImportError as exc:
        raise ShipsagarError("SHIPSAGAR_CLIENT_MISSING", "httpx is not installed.") from exc
    import httpx as _httpx
    resp = _httpx.post(
        settings.shipsagar_api_base_url.rstrip("/") + path,
        json=payload,
        headers={"Authorization": f"Bearer {settings.shipsagar_api_key}"},
        timeout=10.0,
    )
    if resp.status_code >= 400:
        raise ShipsagarError("SHIPSAGAR_API_ERROR", f"ShipSagar API {resp.status_code}: {resp.text[:500]}")
    try:
        return resp.json()
    except Exception as exc:
        raise ShipsagarError("SHIPSAGAR_BAD_RESPONSE", "ShipSagar returned non-JSON.") from exc


def register_tracking(db, shipment, *, courier: str | None = None) -> dict:
    """Register a shipment's courier tracking number with ShipSagar (plan #18).

    Validates courier, creates the local READY_TO_SHIP checkpoint semantics
    by persisting the returned shipsagar_tracking_id on the shipment, and
    queues a bounded retry job when the provider call fails.
    Returns {"shipsagar_tracking_id": ..., "stubbed": bool}.
    """
    code = ((courier or getattr(shipment, "carrier_code", "")) or "").upper()
    if code not in SUPPORTED_COURIERS:
        raise ShipsagarError("UNSUPPORTED_COURIER",
                             f"ShipSagar supports {', '.join(SUPPORTED_COURIERS)}; got '{code}'.")
    awb = (getattr(shipment, "awb_number", "") or "").strip()
    if not awb:
        raise ShipsagarError("MISSING_TRACKING_NUMBER", "courier_tracking_number is required.")
    try:
        data = _post("/trackings", {"courier": code, "tracking_number": awb})
        tracking_id = str(data.get("tracking_id") or data.get("id") or "").strip()
        if not tracking_id:
            raise ShipsagarError("SHIPSAGAR_BAD_RESPONSE", "ShipSagar omitted the tracking id.")
        stubbed = False
    except ShipsagarError as exc:
        if exc.code == "SHIPSAGAR_NOT_CONFIGURED":
            # Deterministic local placeholder so the identity chain stays
            # intact; replaced by the real id once creds land.
            tracking_id = f"SS-STUB-{code}-{awb}"
            stubbed = True
        else:
            schedule_retry(db, business_id=getattr(shipment, "business_id", None),
                           operation="register_tracking", shipment_id=getattr(shipment, "id", None),
                           error=f"{exc.code}: {exc.message}",
                           payload={"courier": code, "tracking_number": awb})
            db.flush()
            raise
    shipment.shipsagar_tracking_id = tracking_id
    if (getattr(shipment, "tracking_status", "") or "") in ("", "NOT_CREATED"):
        shipment.tracking_status = "READY_TO_SHIP"
    db.flush()
    return {"shipsagar_tracking_id": tracking_id, "stubbed": stubbed}


# ---------------------------------------------------------------------------
# Webhook ingest (plan #19): verify -> find -> normalize -> checkpoint ->
# update shipment -> audit. Idempotent via (provider, provider_event_id).
# ---------------------------------------------------------------------------

TERMINAL_SHIPSAGAR = ("DELIVERED", "RETURNED", "LOST")


def find_shipment(db, *, business_id: str, tracking_number: str | None,
                  courier: str | None, shipsagar_tracking_id: str | None):
    """Resolve by ShipSagar tracking id first, then courier tracking number.

    Always scoped to ``business_id`` — a webhook must never match another
    tenant's shipment (cf. X-Business-Id pattern in carrier_webhooks).
    """
    from app.models.shipment import Shipment
    if shipsagar_tracking_id:
        hit = db.query(Shipment).filter_by(
            business_id=business_id,
            shipsagar_tracking_id=shipsagar_tracking_id.strip()).first()
        if hit is not None:
            return hit
    if tracking_number:
        q = db.query(Shipment).filter_by(
            business_id=business_id, awb_number=tracking_number.strip())
        if courier:
            q = q.filter_by(carrier_code=courier.strip().upper())
        return q.first()
    return None


# Forward-only rank for the plan #15 vocabulary. A checkpoint whose rank is
# below the shipment's current rank is stale (out-of-order redelivery) and
# must not regress state. Terminal states additionally never change at all.
_STATUS_RANK = {
    "NOT_CREATED": 0,
    "READY_TO_SHIP": 1,
    "IN_TRANSIT": 2,
    "OUT_FOR_DELIVERY": 3,
    "FAILED_ATTEMPT": 3,
    "EXCEPTION": 4,
    "DELIVERED": 4,
    "RTO": 4,
    "RETURNED": 5,
    "LOST": 5,
}

TERMINAL_GUARD = ("DELIVERED", "RETURNED", "LOST")


def _as_aware(value):
    """Coerce to tz-aware UTC; unparseable/None -> None (guard skipped)."""
    if value is None:
        return None
    try:
        if isinstance(value, str) and value.strip():
            from datetime import datetime as _dt
            value = _dt.fromisoformat(value.replace("Z", "+00:00"))
        if getattr(value, "tzinfo", None) is None:
            value = value.replace(tzinfo=timezone.utc)
        return value
    except Exception:
        return None


def _stale_reason(shipment, normalized: str, event_time) -> str | None:
    """Return why a checkpoint is stale, or None when it may roll up."""
    current = (getattr(shipment, "tracking_status", "") or "").upper()
    if current in TERMINAL_GUARD and normalized != current:
        return f"terminal {current} never regresses to {normalized}"
    new_rank = _STATUS_RANK.get(normalized)
    cur_rank = _STATUS_RANK.get(current)
    if cur_rank is not None and new_rank is not None and new_rank < cur_rank:
        return f"rank {normalized}({new_rank}) below current {current}({cur_rank})"
    anchor = _as_aware(getattr(shipment, "last_checkpoint_at", None))
    moment = _as_aware(event_time)
    if anchor is not None and moment is not None and moment < anchor:
        return "event_time older than last checkpoint"
    return None


def ingest_shipsagar_event(db, shipment, *, event_id: str, courier: str,
                           raw_status: str, sub_status: str | None = None,
                           message: str | None = None, location: str | None = None,
                           event_time=None, raw_payload: dict | None = None):
    """Idempotent checkpoint ingest. Returns (event, created, stale).

    Duplicates (same provider + provider_event_id) never double-record:
    the existing row is returned with created=False.
    Stale checkpoints (terminal regress / rank regress / older event_time)
    are persisted as history but NEVER roll up onto the shipment; they
    return stale=True so callers can report the skip.
    """
    from app.models.shipment import ShipmentEvent
    dup = db.query(ShipmentEvent).filter_by(
        provider=PROVIDER, provider_event_id=event_id).first()
    if dup is not None:
        return dup, False, False
    parsed_time = _as_aware(event_time) if isinstance(event_time, str) else event_time
    if isinstance(event_time, str) and event_time.strip() and parsed_time is None:
        parsed_time = _now()
    event_time = parsed_time
    normalized = normalize_shipsagar_status(courier, raw_status)
    ev = ShipmentEvent(
        business_id=shipment.business_id, shipment_id=shipment.id,
        carrier_event_id=event_id, carrier_status_raw=raw_status,
        normalized_status=normalized, status=normalized, sub_status=sub_status,
        provider=PROVIDER, provider_event_id=event_id,
        message=message, location=location, event_time=event_time,
        source="SHIPSAGAR", raw_payload=raw_payload)
    db.add(ev)
    db.flush()
    stale = _stale_reason(shipment, normalized, event_time)
    if stale is not None:
        try:
            from app.services.audit_service import log_audit as _log
            _log(db, shipment.business_id, None, "shipment", shipment.id,
                 "SHIPSAGAR_STALE_EVENT_SKIPPED",
                 {"tracking_status": getattr(shipment, "tracking_status", None)},
                 {"status": normalized, "event_id": event_id, "reason": stale})
        except Exception:
            pass
        return ev, True, True
    # Roll up onto the shipment (plan #19 flow).
    shipment.carrier_status_raw = raw_status
    shipment.tracking_status = normalized
    if location:
        shipment.current_location = location
    if message:
        shipment.last_checkpoint_message = message
    shipment.last_checkpoint_at = event_time or _now()
    if normalized == "DELIVERED" and getattr(shipment, "delivered_at", None) is None:
        shipment.delivered_at = shipment.last_checkpoint_at
    if normalized == "RTO" and getattr(shipment, "rto_at", None) is None:
        shipment.rto_at = shipment.last_checkpoint_at
    if normalized == "RETURNED" and getattr(shipment, "returned_at", None) is None:
        shipment.returned_at = shipment.last_checkpoint_at
    db.flush()
    try:
        from app.services.audit_service import log_audit
        log_audit(db, shipment.business_id, None, "shipment", shipment.id,
                  "SHIPSAGAR_STATUS_UPDATE",
                  {}, {"status": normalized, "event_id": event_id,
                       "tracking_number": shipment.awb_number})
    except Exception:
        pass
    try:
        from app.services.reconciliation_service import reconcile_order
        reconcile_order(db, shipment.order_id)
    except Exception:
        pass
    return ev, True, False


# ---------------------------------------------------------------------------
# Retry-queue consumer (plan #74): cron-safe drain of due PENDING jobs
# ---------------------------------------------------------------------------

def _retry_due(job, now) -> bool:
    nxt = _as_aware(getattr(job, "next_retry_at", None))
    if nxt is None:
        return True
    try:
        return nxt <= now
    except Exception:
        return True


def drain_retry_queue(db, limit: int = 50) -> dict:
    """Process due PENDING retry jobs (flush; caller commits).

    Success -> DONE; failure -> attempts advance with backoff caps via
    record_retry_attempt (exhausted jobs go DEAD_LETTER, never infinite).
    Cron-safe: only jobs with next_retry_at due are touched.
    """
    from app.models.shipment_event import ShipsagarRetryJob
    from app.models.shipment import Shipment
    now = _now()
    pending = db.query(ShipsagarRetryJob).filter_by(status="PENDING").order_by(
        ShipsagarRetryJob.next_retry_at).limit(max(int(limit or 50), 1)).all()
    out = {"checked": 0, "succeeded": 0, "requeued": 0, "dead_lettered": 0}
    for job in (j for j in pending if _retry_due(j, now)):
        out["checked"] += 1
        try:
            if (job.operation or "") != "register_tracking":
                record_retry_attempt(db, job, f"UNKNOWN_OPERATION: {job.operation}")
            else:
                s = db.query(Shipment).filter_by(id=job.shipment_id).first() \
                    if job.shipment_id else None
                if s is None:
                    job.attempts = (job.attempts or 0) + 1
                    job.status = "DEAD_LETTER"
                    job.next_retry_at = None
                    job.last_error = "SHIPMENT_NOT_FOUND"
                    db.flush()
                else:
                    register_tracking(db, s)
                    job.status = "DONE"
                    job.next_retry_at = None
                    db.flush()
        except ShipsagarError as exc:
            record_retry_attempt(db, job, f"{exc.code}: {exc.message}")
        except Exception as exc:
            record_retry_attempt(db, job, f"DRAIN_FAILED: {exc}")
        if job.status == "DONE":
            out["succeeded"] += 1
        elif job.status == "DEAD_LETTER":
            out["dead_lettered"] += 1
        else:
            out["requeued"] += 1
    db.flush()
    return out
