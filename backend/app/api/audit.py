from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])

@router.get("")
def list_audit(entity_type: str | None = None, entity_id: str | None = None,
               db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.audit_log import AuditLog
    q = db.query(AuditLog).filter_by(business_id=u.get("business_id")).order_by(AuditLog.created_at.desc())
    if entity_type: q = q.filter_by(entity_type=entity_type)
    if entity_id: q = q.filter_by(entity_id=entity_id)
    rows = q.limit(100).all()
    return {"success": True, "data": {"items": [
        {"id": a.id, "entity_type": a.entity_type, "entity_id": a.entity_id, "action": a.action,
         "old_data": a.old_data, "new_data": a.new_data,
         "old_values": getattr(a, "old_values", None), "new_values": getattr(a, "new_values", None),
         "ip_address": getattr(a, "ip_address", None),
         "user_agent": getattr(a, "user_agent", None),
         "created_at": a.created_at.isoformat() if a.created_at else None} for a in rows]}}
