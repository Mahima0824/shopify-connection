from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc)


TERMINAL = ("DELIVERED", "RETURNED", "LOST", "CLOSED")

TERMINAL_EVENT_MAP = {
    "DELIVERED": "delivered_at",
    "RTO_INITIATED": "rto_at",
    "RTO_IN_TRANSIT": "rto_at",
    "RETURN_AT_HUB": "returned_at",
    "RETURNED": "returned_at",
}


def ingest_event(db, shipment, raw: str | None, message: str | None = None,
                 location: str | None = None, event_time=None, carrier_event_id: str = "",
                 source: str = "MANUAL", raw_payload: dict | None = None):
    """Upsert a shipment event (dedupe by carrier_event_id) and roll up shipment fields."""
    from app.models.shipment import ShipmentEvent
    from app.carriers.registry import normalize_status
    if carrier_event_id:
        existing = db.query(ShipmentEvent).filter_by(
            shipment_id=shipment.id, carrier_event_id=carrier_event_id).first()
        if existing is not None:
            return existing, False
    norm = normalize_status(shipment.carrier_code, raw or "")
    ev = ShipmentEvent(
        business_id=shipment.business_id, shipment_id=shipment.id,
        carrier_event_id=carrier_event_id or "", carrier_status_raw=raw,
        normalized_status=norm, message=message, location=location,
        event_time=event_time, source=source, raw_payload=raw_payload)
    db.add(ev)
    db.flush()
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
