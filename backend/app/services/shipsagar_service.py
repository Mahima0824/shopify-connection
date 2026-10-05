"""ShipSagar provider adapter.

ShipSagar aggregates courier tracking for many carriers. Identity chain::

    parcel_id -> shipment_id -> courier_tracking_number (shipments.awb_number)
        -> shipsagar_tracking_id

ShipSagar IDs are provider references only — never business IDs.

Two endpoints are integrated against https://app.shipsagar.com/api/Web:
``PushShipment`` (register a shipment) and ``TrackShipment`` (poll history).
Both authenticate with ``Token`` + ``ClientCode`` carried in the JSON body.

Webhook ingest, signature verification, idempotency, retry/backoff and health
counters are unchanged. ShipSagar's own key casing is inconsistent between its
success and failure bodies, so every status read goes through ``_status_of``.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import datetime, timedelta, timezone

from app.config import settings

PROVIDER = "SHIPSAGAR"
SUPPORTED_COURIERS = ("INDIA_POST", "DTDC")

# ShipSagar reports India Post as "IP" while this deployment stores and displays
# "IP", so the two spellings have to reach the same India Post code path. The map
# is one-directional: it never invents support, it only renames a code that is
# already supported under another spelling.
COURIER_ALIASES: dict[str, str] = {"IP": "INDIA_POST"}


def resolve_courier(code: str | None) -> str:
    """Canonicalize a courier code: trimmed, uppercased, alias-expanded.

    Returns the canonical SUPPORTED_COURIERS spelling when the code is one of
    them or an alias of one, and the normalized code unchanged otherwise, so an
    unknown courier behaves exactly as it did before the map existed.
    """
    canonical = (code or "").strip().upper()
    return COURIER_ALIASES.get(canonical, canonical)


# Every spelling the app accepts for a supported courier, canonical or alias.
# Queries that filter on shipments.carrier_code need the stored spelling, which
# resolve_courier cannot help with inside SQL.
ACCEPTED_COURIER_CODES = tuple(dict.fromkeys((*SUPPORTED_COURIERS, *COURIER_ALIASES)))

# Codes that name the absence of a courier rather than a courier. register_tracking
# refuses these and accepts every other code, because ShipSagar aggregates many
# carriers while SUPPORTED_COURIERS only lists the ones this app has hand-written
# status matrices for.
NON_COURIER_CODES = ("", "MANUAL")

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

DEFAULT_BASE_URL = "https://app.shipsagar.com/api/Web"
PUSH_SHIPMENT_PATH = "/PushShipment"
TRACK_SHIPMENT_PATH = "/TrackShipment"
SHIPSAGAR_NOT_CONFIGURED_MESSAGE = (
    "ShipSagar credentials absent — set SHIPSAGAR_TOKEN and SHIPSAGAR_CLIENT_CODE.")

# ShipSagar's PushShipment contract. Country and transport mode are fixed for
# this deployment; everything else is mapped from the Order at push time.
DEFAULT_COUNTRY = "India"
DEFAULT_SHIPMENT_TYPE = "Road"


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


# Fallback for every courier outside INDIA_POST / DTDC (ShipSagar aggregates many
# carriers and GetCourier is not integrated, so codes arrive unvalidated).
# Rows match on whole words only (see _GENERIC_MATCHERS), otherwise "rto" would
# also match "carton" and "attempt" would also match "reattempt".
# Plan #15's ordering rule applies in full: every negative/attempt and return row
# precedes every positive row, because "undelivered" contains "delivered" and
# "out for delivery - undelivered" contains both.
_GENERIC_MATRIX: list[tuple[str, str]] = [
    ("undelivered", "FAILED_ATTEMPT"),
    ("not delivered", "FAILED_ATTEMPT"),
    ("delivery attempted", "FAILED_ATTEMPT"),
    ("delivery failed", "FAILED_ATTEMPT"),
    ("attempted", "FAILED_ATTEMPT"),
    ("attempts", "FAILED_ATTEMPT"),
    ("attempt", "FAILED_ATTEMPT"),
    ("consignee absent", "FAILED_ATTEMPT"),
    ("consignee not available", "FAILED_ATTEMPT"),
    ("consignee unavailable", "FAILED_ATTEMPT"),
    ("consignee refused", "FAILED_ATTEMPT"),
    ("returned to sender", "RETURNED"),
    ("item returned", "RETURNED"),
    ("returning to sender", "RETURNED"),
    ("returned", "RETURNED"),
    ("rto", "RTO"),
    ("return to origin", "RTO"),
    ("returning to origin", "RTO"),
    ("out for delivery", "OUT_FOR_DELIVERY"),
    ("ofd", "OUT_FOR_DELIVERY"),
    ("booked", "READY_TO_SHIP"),
    ("label created", "READY_TO_SHIP"),
    ("picked up", "READY_TO_SHIP"),
    ("manifested", "READY_TO_SHIP"),
    ("delivered", "DELIVERED"),
    ("lost", "LOST"),
    ("damaged", "EXCEPTION"),
    ("exception", "EXCEPTION"),
    ("on hold", "EXCEPTION"),
    ("detained", "EXCEPTION"),
    ("in transit", "IN_TRANSIT"),
    ("transit", "IN_TRANSIT"),
    ("shipped", "IN_TRANSIT"),
    ("dispatched", "IN_TRANSIT"),
    ("arrived", "IN_TRANSIT"),
    ("reached", "IN_TRANSIT"),
    ("received", "IN_TRANSIT"),
]

_GENERIC_MATCHERS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(rf"\b{re.escape(keyword)}\b"), status)
    for keyword, status in _GENERIC_MATRIX
)

# Courier-specific rows match on whole words too, for the same reason: plain
# substring matching made "rto" match "carton". That looseness was frozen on
# purpose while no row could reach it, but COURIER_ALIASES routes IP - the push
# dialog's default courier - straight into the India Post rows, so it is live
# now. Row order is unchanged, so "undelivered" still beats "delivered".
_COURIER_MATCHERS: dict[str, tuple[tuple[re.Pattern[str], str], ...]] = {
    courier: tuple(
        (re.compile(rf"\b{re.escape(keyword)}\b"), status)
        for row_courier, keyword, status in _MATRIX if row_courier == courier)
    for courier in dict.fromkeys(row[0] for row in _MATRIX)
}


def normalize_shipsagar_status(courier: str, raw: str) -> str:
    """Normalize a courier raw status to the plan #15 vocabulary.

    Courier-specific rows win for INDIA_POST and DTDC (and for any alias of
    them, so "IP" reads the India Post matrix rather than the generic one);
    every other courier falls through to _GENERIC_MATRIX. Unrecognized
    strings -> EXCEPTION (visible, never silently swallowed). Empty string ->
    NOT_CREATED.
    """
    text = (raw or "").strip().lower()
    if not text:
        return "NOT_CREATED"
    code = resolve_courier(courier)
    if code in SUPPORTED_COURIERS:
        for pattern, status in _COURIER_MATCHERS.get(code, ()):
            if pattern.search(text):
                return status
        return "EXCEPTION"
    for pattern, status in _GENERIC_MATCHERS:
        if pattern.search(text):
            return status
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
    """Replay protection: timestamp header must be present and within tolerance.

    Strict: missing, empty, or unparseable timestamps fail verification
    (payloads without timestamps are rejected with STALE_TIMESTAMP).
    """
    if ts is None or not str(ts).strip():
        return False
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
    token = (settings.shipsagar_token or settings.shipsagar_api_key or "").strip()
    return bool(token and (settings.shipsagar_client_code or "").strip())


# ---------------------------------------------------------------------------
# Real ShipSagar HTTP client: PushShipment + TrackShipment
# ---------------------------------------------------------------------------

class ShipsagarError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _base_url() -> str:
    return (settings.shipsagar_api_base_url or DEFAULT_BASE_URL).rstrip("/")


def _auth_payload() -> dict:
    return {
        "Token": (settings.shipsagar_token or settings.shipsagar_api_key or "").strip(),
        "ClientCode": (settings.shipsagar_client_code or "").strip(),
    }


def _status_of(data: dict) -> str:
    """ShipSagar returns 'status' on success and 'Status' on failure."""
    d = data or {}
    return str(d.get("status") or d.get("Status") or "").strip().lower()


def _message_of(data: dict) -> str:
    d = data or {}
    return str(d.get("message") or d.get("Message") or "").strip()


def _is_ok(data: dict) -> bool:
    return _status_of(data) == "success"


def _post(path: str, payload: dict) -> dict:
    """POST a ShipSagar endpoint. Auth travels in the body, not a header.

    Raises ShipsagarError for configuration, transport and malformed-response
    failures. A provider-level ERROR body is returned to the caller so
    push_shipment can report it without raising.
    """
    if not is_configured():
        raise ShipsagarError("SHIPSAGAR_NOT_CONFIGURED", SHIPSAGAR_NOT_CONFIGURED_MESSAGE)
    try:
        import httpx as _httpx
    except ImportError as exc:
        raise ShipsagarError("SHIPSAGAR_CLIENT_MISSING", "httpx is not installed.") from exc
    body = {**_auth_payload(), **(payload or {})}
    try:
        resp = _httpx.post(_base_url() + path, json=body,
                           headers={"Content-Type": "application/json"}, timeout=10.0)
    except Exception as exc:
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             f"ShipSagar request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             f"ShipSagar API {resp.status_code}: {str(resp.text)[:500]}")
    try:
        return resp.json()
    except Exception as exc:
        raise ShipsagarError("SHIPSAGAR_BAD_RESPONSE",
                             "ShipSagar returned non-JSON.") from exc


def build_push_payload(*, tracking_no: str, courier_code: str, order) -> dict:
    """Map an Order onto the PushShipment business fields."""
    return {
        "CourierCode": (courier_code or "").strip().upper(),
        "TrackingNo": (tracking_no or "").strip(),
        "OrderNo": str(getattr(order, "internal_order_number", "")
                       or getattr(order, "shopify_order_name", "") or "").strip(),
        "CustomerName": str(getattr(order, "receiver_name", "") or "").strip(),
        "EmailID": str(getattr(order, "receiver_email", "") or "").strip(),
        "ShipmentType": DEFAULT_SHIPMENT_TYPE,
        "MobileNo": str(getattr(order, "receiver_mobile", "") or "").strip(),
        "CountryName": DEFAULT_COUNTRY,
        "CompanyName": str(getattr(order, "receiver_company", "") or "").strip(),
    }


def push_shipment(*, tracking_no: str, courier_code: str, order) -> dict:
    """Register a shipment with ShipSagar. Returns {"ok", "message"}.

    A provider-level ERROR is a returned result, not an exception — the local
    Shipment already exists by the time this is called.
    """
    data = _post(PUSH_SHIPMENT_PATH,
                 build_push_payload(tracking_no=tracking_no,
                                    courier_code=courier_code, order=order))
    return {"ok": _is_ok(data), "message": _message_of(data)}


# ShipSagar sends English month names ('16-May-2023'). strptime's %b/%B resolve
# those through the C library locale, so on a non-English host they fail to
# parse and the event is silently misdated as "now" while its id stays stable —
# worse than an obvious failure. Month names are therefore looked up here and
# rewritten to a number before parsing. Both the abbreviated ('Sep') and the
# full ('September') spelling are accepted, case-insensitively.
_MONTH_NUMBERS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
_EVENT_TIME_FORMATS = ("%d-%m-%Y %H:%M", "%d-%m-%Y %I:%M %p")


def _numeric_month_date(raw: str) -> str:
    """Rewrite a leading English month name to a number; leave anything else."""
    parts = str(raw or "").strip().split("-", 2)
    if len(parts) != 3:
        return str(raw or "").strip()
    month = _MONTH_NUMBERS.get(parts[1].strip().lower())
    if month is None:
        return str(raw or "").strip()
    return f"{parts[0].strip()}-{month:02d}-{parts[2].strip()}"


def _parse_event_time(date_str, time_str):
    """ShipSagar splits the timestamp into '16-May-2023' and '12:27'."""
    from datetime import datetime as _dt
    raw = f"{str(date_str or '').strip()} {str(time_str or '').strip()}".strip()
    if raw:
        normalized = _numeric_month_date(raw)
        for fmt in _EVENT_TIME_FORMATS:
            try:
                return _dt.strptime(normalized, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return _now()


def _event_id(awb: str, at_date: str, at_time: str, description: str,
              location: str) -> str:
    """Stable identity for one ShipSagar scan, derived only from the scan.

    ShipSagar sends no event identifier, so one has to be synthesized, and
    TrackingHistory's ordering is undocumented: a single new scan can arrive
    prepended, appended, or in the middle. An id built from the scan's index
    therefore changes identity for every historical scan the moment one is
    added, and the whole history re-ingests as new rows on the next poll.

    So the id is built from what belongs to the scan itself: the AWB, its own
    ActionDate and ActionTime, and a digest of its own ActionDescription and
    ActionLocation. Two scans that genuinely differ have to differ on at least
    one of those, and two that agree on all of them are indistinguishable to a
    reader anyway. Nothing positional can enter it.
    """
    digest = hashlib.sha1(
        f"{description}\x00{location}".encode("utf-8")).hexdigest()[:12]
    return f"ss-{awb}-{at_date}-{at_time}-{digest}"


def track_shipment(tracking_no: str, courier_code: str = "") -> dict:
    """Fetch tracking history for one AWB. Returns {"awb", "events"}.

    ShipSagar returns a TrackingDetails array for a single TrackingNo and no
    event identifier, so event_id is synthesized from the AWB, the event's own
    timestamp and a digest of its own text (see _event_id). That makes repeated
    polls dedupe cleanly through shipment_service.ingest_event, and it keeps
    doing so when a new scan is prepended to the array.
    """
    awb = (tracking_no or "").strip()
    data = _post(TRACK_SHIPMENT_PATH, {"TrackingNo": awb})
    if not _is_ok(data):
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             _message_of(data) or "ShipSagar TrackShipment failed.")
    details = data.get("TrackingDetails") or []
    if not details:
        return {"awb": awb, "events": []}
    detail = details[0] or {}
    resolved_courier = str(detail.get("CourierCode") or courier_code or "").strip()
    events = []
    for raw_ev in detail.get("TrackingHistory") or []:
        raw_ev = raw_ev or {}
        at_date = str(raw_ev.get("ActionDate") or "").strip()
        at_time = str(raw_ev.get("ActionTime") or "").strip()
        description = str(raw_ev.get("ActionDescription") or "").strip()
        location = str(raw_ev.get("ActionLocation") or "").strip()
        events.append({
            "event_id": _event_id(awb, at_date, at_time, description, location),
            "status_raw": description,
            "normalized_status": normalize_shipsagar_status(resolved_courier, description),
            "message": description,
            "location": location,
            "event_time": _parse_event_time(at_date, at_time),
        })
    return {"awb": awb, "events": events}


def register_tracking(db, shipment, *, courier: str | None = None,
                      queue_retry: bool = True) -> dict:
    """Register a shipment with ShipSagar via PushShipment.

    Any real courier code is accepted, not only the two in SUPPORTED_COURIERS:
    that tuple is the set this app has hand-written status matrices for, not
    the set ShipSagar aggregates, and the push dialog lets the user pick a
    ShipSagar courier code. Refusing a code the user was allowed to pick meant
    the queued retry could only ever dead-letter with UNSUPPORTED_COURIER, so
    the parcel was never registered at all. Only the internal "MANUAL"
    placeholder (and a blank code) is refused — it is not a courier. Status
    normalization already routes an unlisted courier to the generic matrix.

    Maps the shipment's Order onto the PushShipment body and persists the
    resulting shipsagar_tracking_id. A provider-level ERROR is reported in the
    return value rather than raised, because the Shipment already exists; a
    transport failure queues a bounded retry job and raises so the retry queue
    picks it up.

    A refusal queues no retry, because repeating it will not turn it into
    success. The tracking id is persisted all the same, which drops the parcel
    out of the health endpoint's unregistered_shipments count, so a refusal is
    recorded as a SHIPSAGAR_PUSH_REJECTED audit row; without that durable trace
    a permanently-rejected parcel would read as healthy forever.

    ``queue_retry`` is the side that gives up the duplicate. register_tracking
    creates its retry job when it fails, and drain_retry_queue advances the job
    it is already draining — so when the drain calls this function a failure
    must queue nothing, or one failed operation would leave two PENDING jobs,
    each of which forks two more on its own failure.

    Courier validation goes through resolve_courier, so an "IP" shipment is
    accepted, while the wire payload keeps the stored spelling because "IP" is
    what ShipSagar itself calls that courier.

    Returns {"shipsagar_tracking_id", "stubbed", "pushed", "message"}.
    """
    code = ((courier or getattr(shipment, "carrier_code", "")) or "").strip().upper()
    if code in NON_COURIER_CODES or resolve_courier(code) in NON_COURIER_CODES:
        raise ShipsagarError("UNSUPPORTED_COURIER",
                             f"'{code}' is not a ShipSagar courier code.")
    awb = (getattr(shipment, "awb_number", "") or "").strip()
    if not awb:
        raise ShipsagarError("MISSING_TRACKING_NUMBER", "courier_tracking_number is required.")

    if (getattr(shipment, "tracking_status", "") or "") in ("", "NOT_CREATED", "BOOKED"):
        shipment.tracking_status = "READY_TO_SHIP"

    if not is_configured():
        # Deterministic local placeholder so the identity chain stays intact;
        # replaced by the real id once credentials land.
        tracking_id = f"SS-STUB-{code}-{awb}"
        shipment.shipsagar_tracking_id = tracking_id
        db.flush()
        return {"shipsagar_tracking_id": tracking_id, "stubbed": True,
                "pushed": False, "message": SHIPSAGAR_NOT_CONFIGURED_MESSAGE}

    from app.models.order import Order
    order = db.query(Order).filter_by(id=shipment.order_id).first()
    try:
        result = push_shipment(tracking_no=awb, courier_code=code, order=order)
    except ShipsagarError as exc:
        if queue_retry:
            schedule_retry(db, business_id=getattr(shipment, "business_id", None),
                           operation="register_tracking",
                           shipment_id=getattr(shipment, "id", None),
                           error=f"{exc.code}: {exc.message}")
            db.flush()
        raise
    tracking_id = f"SS-{awb}"
    shipment.shipsagar_tracking_id = tracking_id
    db.flush()
    pushed = bool(result.get("ok"))
    message = result.get("message", "")
    try:
        from app.services.audit_service import log_audit
        if pushed:
            log_audit(db, shipment.business_id, None, "shipment", shipment.id,
                      "SHIPSAGAR_PUSH_ACCEPTED", {},
                      {"message": message, "courier": code, "tracking_number": awb,
                       "shipsagar_tracking_id": tracking_id})
        else:
            log_audit(db, shipment.business_id, None, "shipment", shipment.id,
                      "SHIPSAGAR_PUSH_REJECTED", {},
                      {"message": message, "courier": code, "tracking_number": awb,
                       "shipsagar_tracking_id": tracking_id})
    except Exception:
        pass
    return {"shipsagar_tracking_id": tracking_id, "stubbed": False,
            "pushed": pushed, "message": message}


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


def stale_reason(shipment, normalized: str, event_time) -> str | None:
    """Public alias for _stale_reason, so the polling path can share it."""
    return _stale_reason(shipment, normalized, event_time)


def find_shipment_event(db, shipment_id: str, event_id: str):
    """The dedupe probe both ShipSagar ingest paths share.

    Scoped to one shipment, and tolerant of which identity column the arriving
    path fills: the webhook writes provider_event_id, the polling path writes
    carrier_event_id, and the same checkpoint can arrive by either route. A
    probe that only knew about its own column let the two paths record the same
    checkpoint twice on one shipment, and a probe keyed on (provider,
    provider_event_id) alone could not see a row the other path had written at
    all - so the two paths had two different dedupe scopes.

    Returns the existing ShipmentEvent for this shipment, or None.
    """
    if not event_id:
        return None
    from sqlalchemy import or_
    from app.models.shipment import ShipmentEvent
    return db.query(ShipmentEvent).filter(
        ShipmentEvent.shipment_id == shipment_id,
        or_(ShipmentEvent.carrier_event_id == event_id,
            ShipmentEvent.provider_event_id == event_id)).first()


def find_provider_event(db, event_id: str):
    """Any row already holding this ShipSagar event id, whatever its shipment.

    shipment_events carries UniqueConstraint(provider, provider_event_id) from
    plan #20/#53, which is global: the same ShipSagar event id cannot be stored
    against a second shipment at all, and inserting one would raise
    IntegrityError instead of the current silent no-op. So the global probe
    still has to exist, but only as a second line of defence after the
    per-shipment one - it now runs after the shared probe rather than instead
    of it, and it is reached only for a genuine id collision.

    Lifting the constraint to (shipment_id, provider_event_id) would make the
    second line unnecessary. That needs an alembic revision, and the current
    head (0019_india_post_order_fields) is another feature's uncommitted work,
    so it cannot be chained here.
    """
    if not event_id:
        return None
    from app.models.shipment import ShipmentEvent
    return db.query(ShipmentEvent).filter_by(
        provider=PROVIDER, provider_event_id=event_id).first()


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

    Duplicates (same checkpoint, same shipment) never double-record, whichever
    path delivered them: the probe is find_shipment_event, shared with
    shipment_service.ingest_event.
    Stale checkpoints (terminal regress / rank regress / older event_time)
    are persisted as history but NEVER roll up onto the shipment; they
    return stale=True so callers can report the skip.
    """
    from app.models.shipment import ShipmentEvent
    dup = find_shipment_event(db, shipment.id, event_id)
    if dup is None:
        # Global id collision: the same ShipSagar event id is already stored
        # against another shipment. The (provider, provider_event_id) unique
        # constraint makes a second row impossible, so this is a mis-delivery
        # rather than a second copy of the checkpoint. See find_provider_event.
        dup = find_provider_event(db, event_id)
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

    register_tracking reports a ShipSagar refusal in its return value instead
    of raising, so "no exception" no longer means "pushed". A refusal is
    therefore treated as a failed attempt — bounded, like every other failure —
    rather than silently retiring a shipment the aggregator never accepted.
    The unconfigured stub path counts as success: there was nothing to push to.

    register_tracking is called with queue_retry=False: this loop already owns
    a job for the shipment and advances it via record_retry_attempt, so letting
    register_tracking schedule its own would leave a second PENDING job per
    failure and the queue would double on every cycle.
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
                    result = register_tracking(db, s, queue_retry=False)
                    if result.get("stubbed") or result.get("pushed"):
                        job.status = "DONE"
                        job.next_retry_at = None
                        db.flush()
                    else:
                        record_retry_attempt(
                            db, job, f"SHIPMENT_REJECTED: {result.get('message', '')}")
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
