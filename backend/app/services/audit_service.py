from sqlalchemy.orm import Session


def log_audit(db: Session, business_id: str, user_id: str | None, entity_type: str,
              entity_id: str, action: str, old_data: dict | None = None,
              new_data: dict | None = None, ip_address: str | None = None,
              user_agent: str | None = None, old_values: dict | None = None,
              new_values: dict | None = None):
    """Audit writer per #66. old_values/new_values mirror old_data/new_data (compat)."""
    from app.models.audit_log import AuditLog
    od = old_values if old_values is not None else old_data
    nd = new_values if new_values is not None else new_data
    a = AuditLog(business_id=business_id, user_id=user_id, entity_type=entity_type,
                 entity_id=entity_id, action=action, old_data=od, new_data=nd,
                 old_values=od, new_values=nd,
                 ip_address=(ip_address or "")[:64] or None,
                 user_agent=(user_agent or "")[:512] or None)
    db.add(a)
    db.flush()
    return a
