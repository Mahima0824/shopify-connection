class ScanError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code; self.message = message; self.status = status

def dispatch_parcel(db, business_id: str, barcode: str, user_id: str, device_id=None, override: bool = False, reason: str | None = None) -> dict:
    from sqlalchemy import select
    from app.models.parcel import Parcel
    from app.models.order import Order
    from app.models.scan_event import ScanEvent
    from app.models.user import User
    u = db.query(User).filter_by(id=user_id).first()
    if u is None or not u.is_active:
        raise ScanError("USER_NOT_AUTHORIZED", "User is inactive or unknown.", 403)
    with db.begin_nested():
        p = db.execute(select(Parcel).where(Parcel.business_id == business_id, Parcel.barcode_value == barcode).with_for_update()).scalar_one_or_none()
        if p is None:
            raise ScanError("INVALID_BARCODE", f"No parcel found for barcode {barcode}.", 404)
        o = db.query(Order).filter_by(id=p.order_id).first()
        if o is None:
            raise ScanError("INVALID_BARCODE", "Parcel has no order.", 404)
        if o.cancelled_at is not None:
            raise ScanError("ORDER_CANCELLED", f"Order {o.shopify_order_name} is cancelled. Do not dispatch.", 400)
        prior = db.query(ScanEvent).filter_by(parcel_id=p.id, event_type="DISPATCHED").count()
        if prior > 0:
            raise ScanError("PARCEL_ALREADY_DISPATCHED", "This parcel was already dispatched.", 400)
        if (o.financial_status in ("REFUNDED", "VOIDED")) and not (override and (u.role == "ADMIN") and reason):
            raise ScanError("DISPATCH_NOT_ALLOWED", "Order is refunded/void. Admin override with reason required.", 400)
        if override:
            from app.services.audit_service import log_audit
            log_audit(db, business_id, user_id, "parcel", p.id, "DISPATCH_OVERRIDE",
                      {"financial_status": o.financial_status}, {"reason": reason})
        db.add(ScanEvent(business_id=business_id, parcel_id=p.id, order_id=o.id,
                         event_type="DISPATCHED", performed_by=user_id, device_id=device_id,
                         event_metadata={"override": bool(override), "reason": reason} if override else None))
        p.status = "DISPATCHED"
        o.operational_status = "DISPATCHED"
    db.commit()
    db.refresh(p); db.refresh(o)
    try:
        from app.services.reconciliation_service import reconcile_order
        reconcile_order(db, o.id)
    except Exception: pass
    return {"parcel": {"id": p.id, "barcode_value": p.barcode_value, "status": p.status},
            "order": {"id": o.id, "shopify_order_name": o.shopify_order_name, "operational_status": o.operational_status}}
