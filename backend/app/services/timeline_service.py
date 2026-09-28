# backend/app/services/timeline_service.py
def _iso(v):
    try:
        return v.isoformat() if v is not None else None
    except Exception:
        return None


def build_timeline(db, business_id: str, order_id: str) -> list[dict]:
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.scan_event import ScanEvent
    from app.models.payment import Payment
    from app.models.refund import Refund
    from app.models.audit_log import AuditLog
    from app.models.return_record import ReturnRecord
    o = db.query(Order).filter_by(id=order_id, business_id=business_id).first()
    if o is None:
        return []
    dated: list[tuple] = []
    pending: list[dict] = []

    dated.append((o.order_date, "CREATED", f"Order {o.shopify_order_name} created", None))

    pay = db.query(Payment).filter_by(order_id=o.id, business_id=business_id).order_by(Payment.created_at).first()
    if pay is not None:
        dated.append((pay.created_at, "PAYMENT", f"Payment {float(pay.amount or 0):.2f} {o.currency} received", pay.method))
    elif (o.financial_status or "").upper() == "PAID":
        dated.append((o.shopify_updated_at, "PAYMENT", "Marked PAID in Shopify (no local payment record)", None))
    else:
        pending.append({"at": None, "kind": "PAYMENT_PENDING", "label": "Payment pending", "detail": None})

    parcels = db.query(Parcel).filter_by(order_id=o.id, business_id=business_id).all()
    for p in parcels:
        if (p.status or "").upper() == "PACKED":
            dated.append((p.updated_at, "PACKED", f"Parcel {p.barcode_value} packed", None))

    evs = db.query(ScanEvent).filter_by(order_id=o.id, business_id=business_id).order_by(ScanEvent.created_at).all()
    for e in evs:
        if e.event_type == "DISPATCHED":
            dated.append((e.created_at, "DISPATCHED", "Dispatched", None))
        elif e.event_type == "PACKED":
            dated.append((e.created_at, "PACKED", "Packed", None))
        elif e.event_type in ("RETURN_RECEIVED", "RTO_RECEIVED"):
            dated.append((e.created_at, "RETURN",
                          "Return received" if e.event_type == "RETURN_RECEIVED" else "RTO received", None))
        else:
            dated.append((e.created_at, e.event_type, e.event_type, None))

    for r in db.query(Refund).filter_by(order_id=o.id, business_id=business_id).order_by(Refund.created_at).all():
        dated.append((r.created_at, "REFUND", f"Refund {float(r.amount or 0):.2f} {r.currency}", r.status))

    if o.cancelled_at is not None:
        reason = f" ({o.cancel_reason})" if o.cancel_reason else ""
        dated.append((o.cancelled_at, "CANCELLED", f"Cancelled{reason}", None))

    scope_ids = {o.id} | {p.id for p in parcels}
    scope_ids |= {r.id for r in db.query(ReturnRecord).filter_by(order_id=o.id, business_id=business_id).all()}
    for a in db.query(AuditLog).filter_by(business_id=business_id).order_by(AuditLog.created_at).all():
        if a.entity_id in scope_ids:
            dated.append((a.created_at, "AUDIT", f"{a.action} on {a.entity_type}", a.entity_id))

    dated.sort(key=lambda n: (n[0] is None, n[0]))
    created = [n for n in dated if n[1] == "CREATED"]
    rest = [n for n in dated if n[1] != "CREATED"]
    out = [{"at": _iso(at), "kind": k, "label": lb, "detail": d} for at, k, lb, d in created + rest]
    out.extend(pending)
    return out
