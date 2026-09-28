# backend/app/services/return_service.py
from app.services.scanning_service import ScanError as ReturnError

VALID_TYPES = ("CUSTOMER_RETURN", "RTO", "PARTIAL_RETURN")
VALID_CONDITIONS = ("GOOD", "DAMAGED", "USED", "WRONG_PRODUCT", "MISSING_ITEM")

def record_return(db, business_id: str, barcode: str, user_id: str, return_type: str,
                  condition: str | None, reason: str | None = None, device_id=None,
                  items: list[dict] | None = None) -> dict:
    from sqlalchemy import select
    from app.models.parcel import Parcel
    from app.models.order import Order, OrderItem
    from app.models.scan_event import ScanEvent
    from app.models.return_record import ReturnRecord, ReturnItem
    from app.models.user import User
    from app.services.audit_service import log_audit
    if return_type not in VALID_TYPES:
        raise ReturnError("INVALID_RETURN_ITEM", f"Unknown return_type {return_type}.", 400)
    if condition is not None and condition not in VALID_CONDITIONS:
        raise ReturnError("INVALID_RETURN_ITEM", f"Unknown condition {condition}.", 400)
    u = db.query(User).filter_by(id=user_id).first()
    if u is None or not u.is_active:
        raise ReturnError("USER_NOT_AUTHORIZED", "User is inactive or unknown.", 403)
    with db.begin_nested():
        p = db.execute(select(Parcel).where(
            Parcel.business_id == business_id,
            Parcel.barcode_value == barcode).with_for_update()).scalar_one_or_none()
        if p is None:
            raise ReturnError("INVALID_BARCODE", f"No parcel found for barcode {barcode}.", 404)
        o = db.query(Order).filter_by(id=p.order_id).first()
        if o is None:
            raise ReturnError("INVALID_BARCODE", "Parcel has no order.", 404)
        if db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="DISPATCHED").count() == 0:
            raise ReturnError("RETURN_WITHOUT_DISPATCH", "Parcel was never dispatched; cannot record return.", 400)
        if db.query(ReturnRecord).filter_by(parcel_id=p.id).filter(ReturnRecord.status != "CLOSED").count() > 0:
            raise ReturnError("RETURN_ALREADY_RECORDED", "A return is already recorded for this parcel.", 400)
        oitems = db.query(OrderItem).filter_by(order_id=o.id).all()
        by_id = {i.id: i for i in oitems}
        wanted = items if items is not None else [{"order_item_id": i.id, "quantity": i.quantity} for i in oitems]
        for w in wanted:
            oi = by_id.get(w["order_item_id"])
            if oi is None:
                raise ReturnError("INVALID_RETURN_ITEM", "Return item does not belong to this order.", 400)
            if int(w["quantity"]) < 0 or int(w["quantity"]) > oi.quantity:
                raise ReturnError("RETURN_QUANTITY_MISMATCH",
                                  f"Return qty {w['quantity']} exceeds ordered {oi.quantity} for {oi.title}.", 400)
        old_p, old_o = p.status, o.operational_status
        ret = ReturnRecord(business_id=business_id, order_id=o.id, parcel_id=p.id,
                           return_type=return_type, reason=reason, condition=condition,
                           status="RECEIVED", created_by=user_id)
        db.add(ret); db.flush()
        rows = []
        for w in wanted:
            ri = ReturnItem(return_id=ret.id, order_item_id=w["order_item_id"],
                            quantity=int(w["quantity"]), condition=condition)
            db.add(ri); db.flush()
            rows.append({"order_item_id": ri.order_item_id, "quantity": ri.quantity})
        ev = "RTO_RECEIVED" if return_type == "RTO" else "RETURN_RECEIVED"
        db.add(ScanEvent(business_id=business_id, parcel_id=p.id, order_id=o.id,
                         event_type=ev, performed_by=user_id, device_id=device_id))
        p.status = "RETURN_RECEIVED"
        o.operational_status = "RTO" if return_type == "RTO" else "RETURN_RECEIVED"
        log_audit(db, business_id, user_id, "parcel", p.id, "RETURN_RECORDED",
                  {"parcel": old_p, "order": old_o},
                  {"parcel": p.status, "order": o.operational_status, "return_id": ret.id})
    db.commit()
    db.refresh(ret); db.refresh(p); db.refresh(o)
    try:
        from app.services.reconciliation_service import reconcile_order
        reconcile_order(db, o.id)
    except Exception: pass
    return {"return": {"id": ret.id, "return_type": ret.return_type, "status": ret.status},
            "items": rows,
            "parcel": {"id": p.id, "barcode_value": p.barcode_value, "status": p.status},
            "order": {"id": o.id, "shopify_order_name": o.shopify_order_name,
                      "operational_status": o.operational_status}}
