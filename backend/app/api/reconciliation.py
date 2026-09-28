# backend/app/api/reconciliation.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/reconciliation", tags=["reconciliation"])

def _j(r, order_name=None) -> dict:
    return {"id": r.id, "order_id": r.order_id, "order_name": order_name,
            "issue_code": r.issue_code, "severity": r.severity, "issue_message": r.issue_message,
            "resolved": r.resolved,
            "detected_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None}

@router.get("/issues")
def issues(status: str = "OPEN", severity: str | None = None, issue_code: str | None = None,
           page: int = 1, page_size: int = 20,
           db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.reconciliation import Reconciliation
    from app.models.order import Order
    q = db.query(Reconciliation).filter_by(business_id=u.get("business_id"))
    if status == "OPEN": q = q.filter_by(resolved=False)
    elif status == "RESOLVED": q = q.filter_by(resolved=True)
    if severity: q = q.filter_by(severity=severity)
    if issue_code: q = q.filter_by(issue_code=issue_code)
    total = q.count()
    rows = q.order_by(Reconciliation.created_at.desc()).offset(
        (max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    onames = {o.id: o.shopify_order_name for o in db.query(Order).filter(
        Order.id.in_([r.order_id for r in rows])).all()} if rows else {}
    return {"success": True, "data": {"items": [_j(r, onames.get(r.order_id)) for r in rows],
                                      "total": total, "page": max(int(page or 1), 1)}}

@router.post("/order/{order_id}")
def run_one(order_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.reconciliation_service import reconcile_order
    from app.models.order import Order
    if db.query(Order).filter_by(id=order_id, business_id=u.get("business_id")).first() is None:
        raise HTTPException(404, "Order not found")
    return {"success": True, "data": reconcile_order(db, order_id)}

@router.post("/run")
def run_all(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    from app.models.order import Order
    from app.services.reconciliation_service import reconcile_order
    rec = exc = 0
    for o in db.query(Order).filter_by(business_id=u.get("business_id")).all():
        out = reconcile_order(db, o.id)
        if out["status"] == "RECONCILED": rec += 1
        else: exc += 1
    return {"success": True, "data": {"reconciled": rec, "exceptions": exc}}

class ResolveIn(BaseModel):
    reason: str

@router.post("/issues/{issue_id}/resolve")
def resolve(issue_id: str, body: ResolveIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.reconciliation import Reconciliation
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    if not (body.reason or "").strip():
        raise HTTPException(400, "Reason is required")
    r = db.query(Reconciliation).filter_by(id=issue_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Issue not found")
    if r.resolved:
        raise HTTPException(400, "Issue already resolved")
    r.resolved = True; r.resolved_by = u.get("user_id"); r.resolved_at = datetime.now(timezone.utc)
    log_audit(db, r.business_id, u.get("user_id"), "reconciliation", r.id, "EXCEPTION_RESOLVED",
              {"resolved": False}, {"resolved": True, "reason": body.reason.strip()})
    db.commit()
    return {"success": True, "data": {"id": r.id, "resolved": True}}
