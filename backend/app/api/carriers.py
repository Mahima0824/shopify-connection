from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/carriers", tags=["carriers"])


class ConnectIn(BaseModel):
    credentials: dict = {}
    environment: str = "LIVE"


@router.get("")
def list_providers(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.carriers.registry import PROVIDERS
    from app.models.shipment import CarrierConnection
    conns = {c.carrier_code: c for c in db.query(CarrierConnection).filter_by(
        business_id=u.get("business_id")).all()}
    items = []
    for p in PROVIDERS.values():
        c = conns.get(p.code)
        items.append({"code": p.code, "name": p.name, "capabilities": p.capabilities(),
                      "connected": c is not None and bool(c.is_active)})
    return {"success": True, "data": {"items": items}}


@router.get("/health")
def health(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.carriers.registry import PROVIDERS
    from app.models.shipment import CarrierConnection
    conns = {c.carrier_code: c for c in db.query(CarrierConnection).filter_by(
        business_id=u.get("business_id")).all()}
    items = []
    for p in PROVIDERS.values():
        c = conns.get(p.code)
        items.append({"code": p.code, "name": p.name, "capabilities": p.capabilities(),
                      "configured": c is not None and bool(c.is_active),
                      "last_success": c.last_success_at.isoformat() if c is not None and c.last_success_at else None,
                      "last_error": c.last_error_message if c is not None else None,
                      "last_error_at": c.last_error_at.isoformat() if c is not None and c.last_error_at else None})
    return {"success": True, "data": {"items": items}}


@router.post("/{code}/connect")
def connect(code: str, body: ConnectIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    import json as _json
    from datetime import datetime, timezone
    from app.models.shipment import CarrierConnection
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    try:
        provider = get_provider(code)
    except CarrierError:
        raise HTTPException(404, "Unknown carrier")
    try:
        from app.services.shopify_service import encrypt_token
        enc = encrypt_token(_json.dumps(body.credentials or {}))
    except Exception:
        enc = ""
    c = db.query(CarrierConnection).filter_by(business_id=u.get("business_id"), carrier_code=provider.code).first()
    if c is None:
        c = CarrierConnection(business_id=u.get("business_id"), carrier_code=provider.code,
                              credentials_encrypted=enc, environment=body.environment, is_active=True)
        db.add(c)
    else:
        c.credentials_encrypted = enc
        c.environment = body.environment
        c.is_active = True
    c.last_success_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "data": {"code": provider.code, "connected": True}}


@router.post("/{code}/test")
def test_conn(code: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    try:
        provider = get_provider(code)
    except CarrierError:
        raise HTTPException(404, "Unknown carrier")
    return {"success": True, "data": {"code": provider.code, "capabilities": provider.capabilities(),
                                      "live": False, "note": "Live adapters activate with real credentials."}}


@router.delete("/{code}/disconnect")
def disconnect(code: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.shipment import CarrierConnection
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    c = db.query(CarrierConnection).filter_by(
        business_id=u.get("business_id"), carrier_code=code.upper()).first()
    if c is None:
        raise HTTPException(404, "Not connected")
    c.is_active = False
    db.commit()
    return {"success": True, "data": {"code": c.carrier_code, "connected": False}}
