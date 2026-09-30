from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1", tags=["sla-money"])


class RuleIn(BaseModel):
    carrier_code: str = "*"
    event_type: str = "RTO"
    start_event: str = "RTO_INITIATED"
    allowed_days: int = 45
    warning_days: int = 7
    enabled: bool = True


class CaseIn(BaseModel):
    shipment_id: str
    case_type: str
    priority: str = "MEDIUM"
    complaint_reference: str | None = None
    next_followup_at: str | None = None
    notes: str | None = None


def _rdict(r) -> dict:
    return {"id": r.id, "carrier_code": r.carrier_code, "event_type": r.event_type,
            "start_event": r.start_event, "allowed_days": r.allowed_days,
            "warning_days": r.warning_days, "enabled": r.enabled}


@router.get("/sla/rules")
def list_rules(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.sla import SLARule
    rows = db.query(SLARule).filter_by(business_id=u.get("business_id")).all()
    return {"success": True, "data": {"items": [_rdict(r) for r in rows]}}


@router.post("/sla/rules")
def create_rule(body: RuleIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.sla import SLARule
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    r = SLARule(business_id=u.get("business_id"), carrier_code=body.carrier_code.upper(),
                event_type=body.event_type.upper(), start_event=body.start_event.upper(),
                allowed_days=body.allowed_days, warning_days=body.warning_days, enabled=body.enabled)
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"success": True, "data": _rdict(r)}


@router.put("/sla/rules/{rid}")
def update_rule(rid: str, body: RuleIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.sla import SLARule
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    r = db.query(SLARule).filter_by(id=rid, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Rule not found")
    r.carrier_code = body.carrier_code.upper()
    r.event_type = body.event_type.upper()
    r.start_event = body.start_event.upper()
    r.allowed_days = body.allowed_days
    r.warning_days = body.warning_days
    r.enabled = body.enabled
    db.commit()
    return {"success": True, "data": _rdict(r)}


@router.get("/shipments/outstanding")
def outstanding(status: str | None = None, carrier: str | None = None, sla: str | None = None,
                db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment
    from app.models.order import Order
    from app.models.sla import SLARule, ShipmentFinancial
    from app.services.sla_service import sla_status, shipment_clock
    bid = u.get("business_id")
    now = datetime.now(timezone.utc)
    rules = {r.carrier_code: r for r in db.query(SLARule).filter_by(business_id=bid, enabled=True).all()}
    items = []
    for s in db.query(Shipment).filter_by(business_id=bid).all():
        if (s.tracking_status or "") in ("DELIVERED", "RETURNED", "LOST", "CLOSED"):
            continue
        if status and s.tracking_status != status:
            continue
        if carrier and s.carrier_code != carrier:
            continue
        rule = rules.get(s.carrier_code) or rules.get("*")
        st = sla_status(shipment_clock(db, s, rule), now)
        if sla and st["status"] != sla:
            continue
        o = db.query(Order).filter_by(id=s.order_id).first()
        fin = db.query(ShipmentFinancial).filter_by(shipment_id=s.id).first()
        age = (now - s.shipped_at).days if s.shipped_at else 0
        items.append({"shipment_id": s.id, "order_id": s.order_id,
                      "order_name": o.shopify_order_name if o else None,
                      "carrier_code": s.carrier_code, "awb_number": s.awb_number,
                      "tracking_status": s.tracking_status, "location": s.current_location,
                      "last_event_at": s.last_checkpoint_at.isoformat() if s.last_checkpoint_at else None,
                      "age_days": max(age, 0), "sla_status": st["status"],
                      "sla_days_used": st["days_used"],
                      "sla_deadline": st["deadline"].isoformat() if st["deadline"] else None,
                      "amount": float(o.total_amount or 0) if o else 0,
                      "money_status": fin.status if fin else "NO_RECORD"})
    return {"success": True, "data": {"items": items, "total": len(items)}}


@router.get("/cases")
def list_cases(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.sla import ShipmentCase
    rows = db.query(ShipmentCase).filter_by(business_id=u.get("business_id")).order_by(
        ShipmentCase.created_at.desc()).all()
    return {"success": True, "data": {"items": [
        {"id": c.id, "shipment_id": c.shipment_id, "case_type": c.case_type, "priority": c.priority,
         "status": c.status, "complaint_reference": c.complaint_reference,
         "next_followup_at": c.next_followup_at.isoformat() if c.next_followup_at else None,
         "notes": c.notes} for c in rows]}}


@router.post("/cases")
def open_case(body: CaseIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentCase
    if u.get("role") not in ("ADMIN", "WAREHOUSE", "ACCOUNTANT"):
        raise HTTPException(403, "Staff role required")
    s = db.query(Shipment).filter_by(id=body.shipment_id, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    nf = None
    if body.next_followup_at:
        try:
            nf = datetime.fromisoformat(body.next_followup_at)
        except ValueError:
            raise HTTPException(400, "Invalid next_followup_at")
    c = ShipmentCase(business_id=u.get("business_id"), shipment_id=s.id, case_type=body.case_type.upper(),
                     priority=(body.priority or "MEDIUM").upper(),
                     complaint_reference=body.complaint_reference, next_followup_at=nf,
                     notes=body.notes, created_by=u.get("user_id"))
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"success": True, "data": {"id": c.id, "status": c.status}}


@router.post("/cases/{cid}/resolve")
def resolve_case(cid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.sla import ShipmentCase
    if u.get("role") not in ("ADMIN", "WAREHOUSE", "ACCOUNTANT"):
        raise HTTPException(403, "Staff role required")
    c = db.query(ShipmentCase).filter_by(id=cid, business_id=u.get("business_id")).first()
    if c is None:
        raise HTTPException(404, "Case not found")
    if c.status == "RESOLVED":
        raise HTTPException(400, "Case already resolved")
    c.status = "RESOLVED"
    c.resolved_by = u.get("user_id")
    c.resolved_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "data": {"id": c.id, "status": "RESOLVED"}}


@router.get("/money/at-risk")
def at_risk(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.money_service import money_at_risk
    return {"success": True, "data": money_at_risk(db, u.get("business_id"))}


def _open_issue(db, order, code: str, severity: str, message: str) -> bool:
    """Upsert a Reconciliation row by (order_id, issue_code). Returns True if newly opened."""
    from datetime import datetime, timezone
    from app.models.reconciliation import Reconciliation
    r = db.query(Reconciliation).filter_by(order_id=order.id, issue_code=code).first()
    if r is None:
        r = Reconciliation(business_id=order.business_id, order_id=order.id,
                           reconciliation_status="EXCEPTION", severity=severity,
                           issue_code=code, issue_message=message, resolved=False)
        db.add(r)
        return True
    r.severity = severity
    r.issue_message = message
    r.reconciliation_status = "EXCEPTION"
    r.resolved = False
    r.resolved_by = None
    r.resolved_at = None
    r.updated_at = datetime.now(timezone.utc)
    return False


def _aware(v):
    from datetime import timezone
    if v is None:
        return None
    try:
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    except Exception:
        return v


@router.post("/sla/evaluate")
def evaluate(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone, timedelta
    from app.models.shipment import Shipment
    from app.models.order import Order
    from app.models.reconciliation import Reconciliation
    from app.models.sla import SLARule
    from app.services.shipment_service import TERMINAL
    from app.services.sla_service import sla_status, shipment_clock
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    bid = u.get("business_id")
    now = datetime.now(timezone.utc)
    opened = 0
    checked = 0
    seen_orders: set[str] = set()
    for s in db.query(Shipment).filter_by(business_id=bid).all():
        if (s.tracking_status or "") in TERMINAL:
            continue
        checked += 1
        o = db.query(Order).filter_by(id=s.order_id).first()
        if o is None:
            continue
        # Reconcile checks (R011 stuck / R012 RTO delay / R022 breach) once per order.
        if o.id not in seen_orders:
            seen_orders.add(o.id)
            try:
                from app.services.reconciliation_service import reconcile_order
                before = {(r.order_id, r.issue_code)
                          for r in db.query(Reconciliation).filter_by(business_id=bid, resolved=False).all()}
                res = reconcile_order(db, o.id)
                after = {(r.order_id, r.issue_code)
                         for r in db.query(Reconciliation).filter_by(business_id=bid, resolved=False).all()}
                opened += len(after - before)
                _ = res
            except Exception:
                pass
        # WAREHOUSE_DELAY: hub-status + >24h idle.
        if (s.tracking_status or "") in ("AT_HUB", "RETURN_AT_HUB"):
            last = _aware(s.last_checkpoint_at)
            if last is not None and now - last > timedelta(hours=24):
                if _open_issue(db, o, "WAREHOUSE_DELAY", "HIGH",
                               f"Shipment {s.awb_number} idle at hub over 24h."):
                    opened += 1
        # TRACKING_STALE: UNKNOWN + >24h unsynced.
        if (s.tracking_status or "") == "UNKNOWN":
            sync_at = _aware(s.last_synced_at) or _aware(s.created_at) or _aware(s.shipped_at)
            if sync_at is not None and now - sync_at > timedelta(hours=24):
                if _open_issue(db, o, "TRACKING_STALE", "MEDIUM",
                               f"Shipment {s.awb_number} status unknown over 24h."):
                    opened += 1
        # RTO_DELAY fallback per SLA rules (covers no-rule 45d default via shipment_clock).
        if (s.tracking_status or "") in ("RTO_INITIATED", "RTO_IN_TRANSIT", "RETURN_AT_HUB"):
            rule = db.query(SLARule).filter_by(business_id=bid, carrier_code=s.carrier_code).first()
            if rule is None:
                rule = db.query(SLARule).filter_by(business_id=bid, carrier_code="*").first()
            try:
                st = sla_status(shipment_clock(db, s, rule), now)
            except Exception:
                st = {"status": "NORMAL", "days_used": 0}
            if st.get("status") in ("APPROACHING", "BREACHED"):
                if _open_issue(db, o, "RTO_DELAY", "HIGH",
                               f"RTO shipment {s.awb_number} aged {st.get('days_used', 0)}d."):
                    opened += 1
    db.commit()
    return {"success": True, "data": {"checked": checked, "opened": opened}}
