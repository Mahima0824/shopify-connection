from datetime import datetime, timezone


def sla_status(clock: dict, now: datetime | None = None) -> dict:
    """Pure SLA band calculator. clock = {start, allowed_days, warning_days}."""
    now = now or datetime.now(timezone.utc)
    start = clock.get("start")
    allowed = int(clock.get("allowed_days") or 45)
    warning = int(clock.get("warning_days") or 7)
    if start is None:
        return {"status": "NORMAL", "days_used": 0, "deadline": None}
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    days_used = (now - start).days
    deadline = start_plus(start, allowed)
    if days_used >= allowed:
        status = "BREACHED"
    elif days_used >= allowed - warning:
        status = "APPROACHING"
    else:
        status = "NORMAL"
    return {"status": status, "days_used": max(days_used, 0), "deadline": deadline}


def start_plus(start: datetime, days: int) -> datetime:
    from datetime import timedelta
    return start + timedelta(days=days)


def shipment_clock(db, shipment, rule=None) -> dict:
    """Resolve the SLA clock start for a shipment (RTO → delivery → shipped fallback)."""
    start = shipment.rto_at
    if start is None:
        from app.models.shipment import ShipmentEvent
        ev = db.query(ShipmentEvent).filter_by(shipment_id=shipment.id).filter(
            ShipmentEvent.normalized_status.in_(["RTO_INITIATED", "RTO_IN_TRANSIT"])).order_by(
            ShipmentEvent.event_time).first()
        start = ev.event_time if ev is not None else None
    if start is None:
        start = shipment.shipped_at
    allowed = rule.allowed_days if rule is not None else 45
    warning = rule.warning_days if rule is not None else 7
    return {"start": start, "allowed_days": allowed, "warning_days": warning}
