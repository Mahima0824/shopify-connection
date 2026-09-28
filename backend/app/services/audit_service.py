from sqlalchemy.orm import Session

def log_audit(db: Session, business_id: str, user_id: str | None, entity_type: str,
              entity_id: str, action: str, old_data: dict | None = None,
              new_data: dict | None = None):
    from app.models.audit_log import AuditLog
    a = AuditLog(business_id=business_id, user_id=user_id, entity_type=entity_type,
                 entity_id=entity_id, action=action, old_data=old_data, new_data=new_data)
    db.add(a)
    db.flush()
    return a
