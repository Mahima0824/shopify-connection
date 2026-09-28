def money_at_risk(db, business_id: str) -> dict:
    """Single owner of money-at-risk bucketing. First matching bucket wins per order."""
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial
    from app.services.sla_service import sla_status, shipment_clock
    from datetime import datetime, timezone
    buckets: list[dict] = []
    counted: set[str] = set()

    def add(bucket: str, order_id: str, amount: float, label: str):
        if order_id in counted:
            return
        counted.add(order_id)
        buckets.append({"bucket": bucket, "order_id": order_id, "amount": round(float(amount or 0), 2), "label": label})

    for p in db.query(Payment).filter_by(business_id=business_id, method="COD").all():
        if (p.payment_status or "").upper() not in ("PAID", "COLLECTED"):
            continue
        fin = db.query(ShipmentFinancial).filter_by(business_id=business_id, order_id=p.order_id).first()
        if fin is not None and (fin.status or "").upper() == "SETTLED":
            continue
        add("UNSETTLED_COD", p.order_id, p.amount, "COD collected, not settled")

    ret_order_ids = {r.order_id for r in db.query(ReturnRecord).filter_by(
        business_id=business_id).filter(ReturnRecord.status != "CLOSED").all()}
    refunded = {r.order_id for r in db.query(Refund).filter_by(business_id=business_id).all()}
    for oid in ret_order_ids - refunded:
        o = db.query(Order).filter_by(id=oid).first()
        add("PENDING_REFUND", oid, o.total_amount if o else 0, "Return received, refund pending")

    now = datetime.now(timezone.utc)
    for s in db.query(Shipment).filter_by(business_id=business_id).all():
        if (s.tracking_status or "") in ("DELIVERED", "RETURNED", "LOST", "CLOSED"):
            continue
        st = sla_status(shipment_clock(db, s), now)
        if st["status"] == "BREACHED":
            o = db.query(Order).filter_by(id=s.order_id).first()
            add("BREACHED_SHIPMENT", s.order_id, o.total_amount if o else 0, "SLA-breached shipment value")

    total = round(sum(b["amount"] for b in buckets), 2)
    return {"total": total, "buckets": buckets}
