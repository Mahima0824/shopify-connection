import json
from datetime import date, datetime, timezone


def _now():
    return datetime.now(timezone.utc)


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _json_safe(value):
    """Round-trip a provider event payload into JSON-safe values.

    Endpoints hand the provider's own event dict straight to the ``raw_payload``
    JSON column, and providers are free to carry real ``datetime`` objects in it.
    Doing the conversion once here keeps every provider working instead of each
    one having to remember, and keeps the timestamps — ISO 8601, timezone
    included — rather than dropping them.
    """
    if value is None:
        return None
    return json.loads(json.dumps(value, default=_json_default))


TERMINAL = ("DELIVERED", "RETURNED", "RTO_DELIVERED", "LOST", "CLOSED")

TERMINAL_EVENT_MAP = {
    "DELIVERED": "delivered_at",
    "RTO_INITIATED": "rto_at",
    "RTO_IN_TRANSIT": "rto_at",
    "RETURN_AT_HUB": "returned_at",
    "RETURNED": "returned_at",
}


def _db_normalize(db, shipment, raw_text: str) -> str | None:
    """First tenant CourierStatusMapping that matches this shipment's raw status.

    Tried on carrier_code first and on the resolved provider code second, so a
    mapping keyed on the courier a tenant configured keeps applying after the
    parcel is pushed (which resolves the provider to SHIPSAGAR), and a mapping
    keyed on the provider still applies.
    """
    from app.carriers.registry import db_normalize, provider_code_for_shipment
    keys = []
    for key in ((getattr(shipment, "carrier_code", "") or "").strip().upper(),
                provider_code_for_shipment(shipment)):
        if key and key not in keys:
            keys.append(key)
    for key in keys:
        mapped = db_normalize(db, shipment.business_id, key, raw_text)
        if mapped:
            return mapped
    return None


def ingest_event(db, shipment, raw: str | None, message: str | None = None,
                 location: str | None = None, event_time=None, carrier_event_id: str = "",
                 source: str = "MANUAL", raw_payload: dict | None = None):
    """Upsert a shipment event (dedupe by carrier_event_id) and roll up shipment fields.

    Roll-up is forward-only, through the same guard the ShipSagar webhook uses
    (shipsagar_service._stale_reason): a terminal state never changes, and a
    checkpoint that ranks below the shipment's current status is persisted as
    history but never rolled up. Without it the polling path contradicted spec
    section 8 outright — a DELIVERED parcel regressed to READY_TO_SHIP on the
    next poll, and a newest-first ShipSagar history ended on its first entry.
    The rank table is imported rather than re-declared so the two paths cannot
    drift apart.

    A status the table does not know (BOOKED, CANCELLED, NDR_REATTEMPT, ...) has
    no rank, so it is not treated as stale and still applies — the guard only
    governs the ShipSagar vocabulary.
    """
    from app.models.shipment import ShipmentEvent
    from app.services.shipsagar_service import find_shipment_event, stale_reason
    if carrier_event_id:
        existing = find_shipment_event(db, shipment.id, carrier_event_id)
        if existing is not None:
            return existing, False
    if isinstance(event_time, str) and event_time.strip():
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except ValueError:
            event_time = _now()

    raw_text = raw or ""
    try:
        # A tenant's CourierStatusMapping is keyed on the courier they configured,
        # which is the shipment's carrier_code. Keying on the provider instead
        # silently dropped every mapping the moment a parcel was pushed, because
        # pushing resolves the provider to SHIPSAGAR.
        norm = _db_normalize(db, shipment, raw_text)
    except Exception:
        norm = None
    if not norm:
        from app.carriers.registry import normalize_for_shipment
        norm = normalize_for_shipment(shipment, raw_text)
    ev = ShipmentEvent(
        business_id=shipment.business_id, shipment_id=shipment.id,
        carrier_event_id=carrier_event_id or "", carrier_status_raw=raw,
        normalized_status=norm, message=message, location=location,
        event_time=event_time, source=source, raw_payload=_json_safe(raw_payload))
    db.add(ev)
    db.flush()
    if stale_reason(shipment, norm, event_time) is not None:
        # Recorded as history, deliberately not rolled up onto the shipment.
        db.flush()
        return ev, True
    shipment.carrier_status_raw = raw
    shipment.tracking_status = norm
    if location:
        shipment.current_location = location
    if message:
        shipment.last_checkpoint_message = message
    if event_time:
        shipment.last_checkpoint_at = event_time
    else:
        shipment.last_checkpoint_at = _now()
    terminal_field = TERMINAL_EVENT_MAP.get(norm)
    if terminal_field and getattr(shipment, terminal_field) is None:
        setattr(shipment, terminal_field, shipment.last_checkpoint_at)
    db.flush()
    try:
        from app.services.reconciliation_service import reconcile_order
        reconcile_order(db, shipment.order_id)
    except Exception:
        pass
    return ev, True


def edict(ev) -> dict:
    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {
        "id": ev.id, "shipment_id": ev.shipment_id, "carrier_event_id": ev.carrier_event_id,
        "carrier_status_raw": ev.carrier_status_raw, "normalized_status": ev.normalized_status,
        "message": ev.message, "location": ev.location, "event_time": iso(ev.event_time),
        "received_at": iso(ev.received_at), "source": ev.source,
    }
