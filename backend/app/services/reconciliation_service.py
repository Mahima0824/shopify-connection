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


CATEGORY = {
    'courier': {'DISPATCHED_WITHOUT_SHIPMENT', 'AWB_MISSING', 'SHIPMENT_STUCK', 'RTO_DELAY', 'COURIER_STATUS_UNKNOWN', 'COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED'},
    'money': {'DELIVERED_COD_NOT_SETTLED', 'SETTLEMENT_AMOUNT_MISMATCH', 'RETURNED_REFUND_MISSING', 'DUPLICATE_SETTLEMENT'},
    'returns': {'RETURN_DELAY', 'RETURNED_REFUND_MISSING', 'COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED'},
    'sla': {'RTO_DELAY', 'SLA_BREACHED'},
}


def _shipments(db, o):
    from app.models.shipment import Shipment
    return db.query(Shipment).filter_by(business_id=o.business_id, order_id=o.id).all()


def check_r009(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    disp = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(Parcel.order_id == o.id, ScanEvent.event_type == 'DISPATCHED').count()
    if disp > 0 and not _shipments(db, o):
        return [_open(db, o, 'DISPATCHED_WITHOUT_SHIPMENT', 'HIGH', 'Dispatched but no shipment/AWB record exists.')]
    return []


def check_r010(db, o):
    for s in _shipments(db, o):
        if not (s.awb_number or '').strip():
            return [_open(db, o, 'AWB_MISSING', 'HIGH', 'Shipment without AWB.')]
    return []


def check_r011(db, o):
    from datetime import datetime, timezone, timedelta
    for s in _shipments(db, o):
        if (s.tracking_status or '') in ('DELIVERED', 'RETURNED', 'LOST', 'CLOSED'):
            continue
        if s.last_checkpoint_at and datetime.now(timezone.utc) - s.last_checkpoint_at.replace(tzinfo=timezone.utc) > timedelta(days=7):
            return [_open(db, o, 'SHIPMENT_STUCK', 'MEDIUM', f'Shipment {s.awb_number} idle over 7 days.')]
    return []


def check_r012(db, o):
    from datetime import datetime, timezone
    from app.models.sla import SLARule
    from app.services.sla_service import sla_status, shipment_clock
    for s in _shipments(db, o):
        if (s.tracking_status or '') not in ('RTO_INITIATED', 'RTO_IN_TRANSIT', 'RETURN_AT_HUB'):
            continue
        rule = db.query(SLARule).filter_by(business_id=o.business_id, carrier_code=s.carrier_code).first()
        if rule is None:
            rule = db.query(SLARule).filter_by(business_id=o.business_id, carrier_code='*').first()
        st = sla_status(shipment_clock(db, s, rule), datetime.now(timezone.utc))
        if st['status'] in ('APPROACHING', 'BREACHED'):
            return [_open(db, o, 'RTO_DELAY', 'HIGH', f'RTO shipment {s.awb_number} aged {st["days_used"]}d.')]
    return []



def check_r013(db, o):
    from datetime import datetime, timezone, timedelta
    from app.models.return_record import ReturnRecord
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    for r in db.query(ReturnRecord).filter_by(order_id=o.id, business_id=o.business_id).filter(ReturnRecord.status == 'RECEIVED').all():
        verified = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(Parcel.order_id == o.id, ScanEvent.event_type == 'REFUND_VERIFIED').count()
        age = datetime.now(timezone.utc) - (r.received_at.replace(tzinfo=timezone.utc) if r.received_at and r.received_at.tzinfo is None else (r.received_at or datetime.now(timezone.utc)))
        if verified == 0 and age > timedelta(days=7):
            return [_open(db, o, 'RETURN_DELAY', 'MEDIUM', 'Return received over 7 days without inspection.')]
    return []


def check_r014(db, o):
    from app.models.payment import Payment
    from app.models.sla import ShipmentFinancial
    cod = db.query(Payment).filter_by(business_id=o.business_id, order_id=o.id, method='COD').first()
    if cod is None:
        return []
    for s in _shipments(db, o):
        if (s.tracking_status or '') != 'DELIVERED':
            continue
        fin = db.query(ShipmentFinancial).filter_by(shipment_id=s.id).first()
        if fin is None or (fin.status or '').upper() != 'SETTLED':
            return [_open(db, o, 'DELIVERED_COD_NOT_SETTLED', 'HIGH', 'COD delivered but settlement missing.')]
    return []


def check_r015(db, o):
    from app.models.sla import ShipmentFinancial
    for fin in db.query(ShipmentFinancial).filter_by(business_id=o.business_id, order_id=o.id).all():
        if (fin.status or '').upper() not in ('SETTLED', 'PARTIALLY_SETTLED'):
            continue
        try:
            exp = float(fin.expected_cod_amount or 0) or float(o.total_amount or 0)
            net = float(fin.net_settlement or 0)
            fee = float(fin.fee_amount or 0)
            other = float(fin.other_deduction or 0)
        except (TypeError, ValueError):
            continue
        base = exp if float(fin.expected_cod_amount or 0) else float(o.total_amount or 0)
        if abs(net - (base - fee - other)) > 1.0:
            return [_open(db, o, 'SETTLEMENT_AMOUNT_MISMATCH', 'HIGH', 'Settled net does not match expected minus fees.')]
    return []


def check_r016(db, o):
    from datetime import datetime, timezone, timedelta
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    rets = db.query(ReturnRecord).filter_by(order_id=o.id, business_id=o.business_id).filter(ReturnRecord.status != 'CLOSED').all()
    if not rets:
        return []
    if db.query(Refund).filter_by(order_id=o.id).count() > 0:
        return []
    oldest = min((r.received_at for r in rets if r.received_at), default=None)
    if oldest is None:
        return []
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - oldest > timedelta(days=3):
        return [_open(db, o, 'RETURNED_REFUND_MISSING', 'HIGH', 'Return over 3 days without refund.')]
    return []


def check_r018(db, o):
    from datetime import datetime, timezone, timedelta
    for s in _shipments(db, o):
        if (s.tracking_status or '') == 'UNKNOWN' and s.last_synced_at and datetime.now(timezone.utc) - s.last_synced_at.replace(tzinfo=timezone.utc) > timedelta(hours=24):
            return [_open(db, o, 'COURIER_STATUS_UNKNOWN', 'MEDIUM', f'Shipment {s.awb_number} status unknown over 24h.')]
    return []


def check_r019(db, o):
    from app.models.statement import StatementRow
    for r in db.query(StatementRow).filter_by(matched_order_id=o.id).filter(StatementRow.reconciliation_status == 'UNMATCHED').all():
        return [_open(db, o, 'STATEMENT_ROW_UNMATCHED', 'MEDIUM', 'Statement row references this order but is unmatched.')]
    return []


def check_r020(db, o):
    from app.models.sla import ShipmentFinancial
    seen = {}
    for fin in db.query(ShipmentFinancial).filter_by(business_id=o.business_id, order_id=o.id).all():
        if (fin.status or '').upper() not in ('SETTLED', 'PARTIALLY_SETTLED'):
            continue
        key = fin.shipment_id
        ref = fin.settlement_reference or ''
        if key in seen and seen[key] != ref:
            return [_open(db, o, 'DUPLICATE_SETTLEMENT', 'HIGH', 'Multiple settlements for one shipment.')]
        seen[key] = ref
    return []


def check_r021(db, o):
    from app.models.scan_event import ScanEvent
    from app.models.parcel import Parcel
    for s in _shipments(db, o):
        if (s.tracking_status or '') != 'RETURNED':
            continue
        got = db.query(ScanEvent).join(Parcel, ScanEvent.parcel_id == Parcel.id).filter(Parcel.order_id == o.id, ScanEvent.event_type.in_(['RETURN_RECEIVED', 'RTO_RECEIVED'])).count()
        if got == 0:
            return [_open(db, o, 'COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED', 'HIGH', 'Courier returned, warehouse has no scan.')]
    return []


def check_r022(db, o):
    from datetime import datetime, timezone
    from app.models.sla import SLARule, ShipmentCase
    from app.services.sla_service import sla_status, shipment_clock
    for s in _shipments(db, o):
        if (s.tracking_status or '') in ('DELIVERED', 'RETURNED', 'LOST', 'CLOSED'):
            continue
        rule = db.query(SLARule).filter_by(business_id=o.business_id, carrier_code=s.carrier_code).first()
        if rule is None:
            rule = db.query(SLARule).filter_by(business_id=o.business_id, carrier_code='*').first()
        if sla_status(shipment_clock(db, s, rule), datetime.now(timezone.utc))['status'] != 'BREACHED':
            continue
        open_case = db.query(ShipmentCase).filter_by(shipment_id=s.id).filter(ShipmentCase.status != 'RESOLVED').count()
        if open_case == 0:
            return [_open(db, o, 'SLA_BREACHED', 'CRITICAL', f'Shipment {s.awb_number} breached SLA.')]
    return []


CHECKS = (check_r001, check_r002, check_r003, check_r004, check_r005, check_r006, check_r007, check_r008,
           check_r009, check_r010, check_r011, check_r012, check_r013, check_r014, check_r015, check_r016,
           check_r018, check_r019, check_r020, check_r021, check_r022)

