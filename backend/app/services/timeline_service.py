# backend/app/services/timeline_service.py
def build_timeline(db, business_id: str, order_id: str) -> list[dict]:
    from app.models.order import Order
    from app.models.scan_event import ScanEvent
    from app.models.audit_log import AuditLog
    o = db.query(Order).filter_by(id=order_id, business_id=business_id).first()
    if o is None:
        return []
    nodes: list[dict] = []
    nodes.append({"at": o.order_date.isoformat() if o.order_date else None, "kind": "CREATED",
                  "label": f"Order {o.shopify_order_name} created", "detail": None})
    nodes.append({"at": None, "kind": "PAYMENT", "label": f"Payment {o.financial_status}", "detail": None})
    evs = db.query(ScanEvent).filter_by(order_id=o.id, business_id=business_id).order_by(ScanEvent.created_at).all()
    for e in evs:
        at = e.created_at.isoformat() if e.created_at else None
        if e.event_type == "DISPATCHED":
            nodes.append({"at": at, "kind": "DISPATCHED", "label": "Dispatched", "detail": None})
        elif e.event_type in ("RETURN_RECEIVED", "RTO_RECEIVED"):
            nodes.append({"at": at, "kind": "RETURN", "label": "Return received" if e.event_type == "RETURN_RECEIVED" else "RTO received", "detail": None})
        else:
            nodes.append({"at": at, "kind": e.event_type, "label": e.event_type, "detail": None})
    for a in db.query(AuditLog).filter_by(business_id=business_id).all():
        nodes.append({"at": a.created_at.isoformat() if a.created_at else None, "kind": "AUDIT",
                      "label": f"{a.action} on {a.entity_type}", "detail": a.entity_id})
    return nodes
