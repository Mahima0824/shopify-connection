from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/scan", tags=["scan"])

class DispatchIn(BaseModel):
    barcode: str
    device_id: str | None = None
    override: bool = False
    reason: str | None = None

class ReturnIn(BaseModel):
    barcode: str
    return_type: str = "CUSTOMER_RETURN"
    condition: str | None = None
    reason: str | None = None
    device_id: str | None = None
    items: list[dict] | None = None

@router.post("/dispatch")
def scan_dispatch(body: DispatchIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.scanning_service import dispatch_parcel, ScanError
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    try:
        out = dispatch_parcel(db, u.get("business_id"), body.barcode.strip(), u.get("user_id"),
                              body.device_id, body.override, body.reason)
    except ScanError as e:
        raise HTTPException(e.status, e.message, headers={"X-Error-Code": e.code})
    return {"success": True, "data": out}

@router.post("/return")
def scan_return(body: ReturnIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.return_service import record_return
    from app.services.scanning_service import ScanError
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    try:
        out = record_return(db, u.get("business_id"), body.barcode.strip(), u.get("user_id"),
                            body.return_type, body.condition, body.reason, body.device_id, body.items)
    except ScanError as e:
        raise HTTPException(e.status, e.message, headers={"X-Error-Code": e.code})
    return {"success": True, "data": out}
