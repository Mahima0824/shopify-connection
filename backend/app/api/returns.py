from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/returns", tags=["returns"])

@router.get("")
def list_returns(order_id: str | None = None, status: str | None = None,
                 page: int = 1, page_size: int = 20,
                 db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.return_record import ReturnRecord
    q = db.query(ReturnRecord).filter_by(business_id=u.get("business_id"))
    if order_id: q = q.filter_by(order_id=order_id)
    if status: q = q.filter_by(status=status)
    total = q.count()
    rows = q.offset((max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    return {"success": True, "data": {"items": [
        {"id": r.id, "order_id": r.order_id, "parcel_id": r.parcel_id, "return_type": r.return_type,
         "condition": r.condition, "status": r.status} for r in rows], "total": total, "page": max(int(page or 1), 1)}}

@router.get("/{return_id}")
def get_return(return_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.return_record import ReturnRecord, ReturnItem
    r = db.query(ReturnRecord).filter_by(id=return_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Return not found")
    items = db.query(ReturnItem).filter_by(return_id=r.id).all()
    return {"success": True, "data": {"id": r.id, "order_id": r.order_id, "return_type": r.return_type,
        "condition": r.condition, "reason": r.reason, "status": r.status,
        "items": [{"order_item_id": i.order_item_id, "quantity": i.quantity} for i in items]}}


class InspectIn(BaseModel):
    condition: str | None = None
    notes: str | None = None


@router.post("/{return_id}/inspect")
def inspect_return(return_id: str, body: InspectIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.return_record import ReturnRecord
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    r = db.query(ReturnRecord).filter_by(id=return_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Return not found")
    if r.status == "CLOSED":
        raise HTTPException(400, "Return already closed")
    old = r.status
    r.status = "INSPECTED"
    r.inspected_at = datetime.now(timezone.utc)
    if body.condition:
        r.condition = body.condition
    log_audit(db, r.business_id, u.get("user_id"), "return", r.id, "RETURN_INSPECTED",
              {"status": old}, {"status": "INSPECTED", "notes": body.notes})
    db.commit()
    return {"success": True, "data": {"id": r.id, "status": "INSPECTED"}}
