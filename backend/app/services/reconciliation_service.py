# backend/app/services/reconciliation_service.py
from datetime import datetime, timezone, timedelta

GRACE = timedelta(minutes=15)


def _open(db, o, code, severity, message):
    from app.models.reconciliation import Reconciliation
    r = db.query(Reconciliation).filter_by(order_id=o.id, issue_code=code).first()
    if r is None:
        r = Reconciliation(business_id=o.business_id, order_id=o.id, reconciliation_status="EXCEPTION",
                           severity=severity, issue_code=code, issue_message=message, resolved=False)
        db.add(r)
    else:
        r.severity = severity; r.issue_message = message; r.reconciliation_status = "EXCEPTION"
        r.resolved = False; r.resolved_by = None; r.resolved_at = None
        r.updated_at = datetime.now(timezone.utc)
    return {"code": code, "severity": severity, "message": message}


def check_r001(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    if o.cancelled_at is None:
        return []
    disp = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if disp > 0:
        return [_open(db, o, "CANCELLED_BUT_DISPATCHED", "CRITICAL",
                      f"Order {o.shopify_order_name} cancelled after dispatch.")]
    packed = db.query(Parcel).filter_by(order_id=o.id).filter(Parcel.status != "CREATED").count()
    if packed > 0:
        return [_open(db, o, "CANCELLED_AFTER_PACK", "HIGH",
                      f"Order {o.shopify_order_name} cancelled after packing.")]
    return []


def check_r002(db, o):
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    rets = db.query(ReturnRecord).filter_by(order_id=o.id).filter(ReturnRecord.status != "CLOSED").count()
    if rets == 0:
        return []
    if o.financial_status != "PAID":
        return []
    if db.query(Refund).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "RETURN_WITHOUT_REFUND", "HIGH", "Return received but no refund found.")]


def check_r003(db, o):
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    if db.query(Refund).filter_by(order_id=o.id).count() == 0:
        return []
    if db.query(ReturnRecord).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "REFUND_WITHOUT_RETURN", "MEDIUM", "Refund exists without a recorded return (may be legitimate).")]


def check_r004(db, o):
    from app.models.payment import Payment
    if o.financial_status != "PAID":
        return []
    if db.query(Payment).filter_by(order_id=o.id).count() > 0:
        return []
    return [_open(db, o, "PAYMENT_DATA_MISSING", "HIGH", "Order marked PAID but no payment transaction found.")]


def check_r005(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    n = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if n > 1:
        return [_open(db, o, "DUPLICATE_DISPATCH_SCAN", "HIGH", f"{n} dispatch scans recorded.")]
    return []


def check_r006(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    ret = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type.in_(["RETURN_RECEIVED", "RTO_RECEIVED"])).count()
    disp = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(
        Parcel.order_id == o.id, ScanEvent.event_type == "DISPATCHED").count()
    if ret > 0 and disp == 0:
        return [_open(db, o, "RETURN_WITHOUT_DISPATCH", "HIGH", "Return recorded without any dispatch.")]
    return []


def check_r007(db, o):
    from app.models.order import OrderItem
    from app.models.return_record import ReturnRecord, ReturnItem
    ordered = sum(i.quantity for i in db.query(OrderItem).filter_by(order_id=o.id).all())
    rids = [r.id for r in db.query(ReturnRecord).filter_by(order_id=o.id).all()]
    returned = sum(i.quantity for i in db.query(ReturnItem).filter(ReturnItem.return_id.in_(rids)).all()) if rids else 0
    if returned > ordered:
        return [_open(db, o, "RETURN_QUANTITY_MISMATCH", "HIGH",
                      f"Returned {returned} exceeds ordered {ordered}.")]
    return []


def check_r008(db, o):
    if o.shopify_updated_at is None:
        return []
    now = datetime.now(timezone.utc)
    local = o.updated_at if hasattr(o, "updated_at") else None
    if local is not None and o.shopify_updated_at <= local:
        return []
    if now - o.shopify_updated_at.replace(tzinfo=timezone.utc) < GRACE:
        return []
    return [_open(db, o, "SYNC_DELAY", "MEDIUM", "Shopify is newer than local state beyond grace period.")]


CHECKS = (check_r001, check_r002, check_r003, check_r004, check_r005, check_r006, check_r007, check_r008)


def reconcile_order(db, order_id: str) -> dict:
    from app.models.order import Order
    from app.models.reconciliation import Reconciliation
    o = db.query(Order).filter_by(id=order_id).first()
    if o is None:
        return {"status": "RECONCILED", "issues": []}
    issues = []
    for fn in CHECKS:
        issues += fn(db, o)
    db.commit()
    # Auto-resolve fixed issues individually (system resolution: resolved_by NULL).
    now = datetime.now(timezone.utc)
    open_codes = {i["code"] for i in issues}
    for r in db.query(Reconciliation).filter_by(order_id=o.id, resolved=False).all():
        if r.issue_code not in open_codes:
            r.resolved = True; r.resolved_at = now
    db.commit()
    if not issues:
        return {"status": "RECONCILED", "issues": []}
    return {"status": "EXCEPTION", "issues": issues}
