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
    carrier_code: str | None = None
    awb_number: str | None = None

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
    if body.carrier_code and body.awb_number:
        out["shipment_warning"] = _link_shipment(
            db, u.get("business_id"), out["parcel"]["id"],
            body.carrier_code, body.awb_number)
    return {"success": True, "data": out}


def _link_shipment(db, business_id: str, parcel_id: str, carrier_code: str, awb_number: str) -> str | None:
    from datetime import datetime, timezone
    from sqlalchemy.exc import IntegrityError
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    p = db.query(Parcel).filter_by(id=parcel_id, business_id=business_id).first()
    if p is None:
        return "Parcel not found for shipment"
    s = Shipment(business_id=business_id, order_id=p.order_id, parcel_id=p.id,
                 carrier_code=(carrier_code or "MANUAL").upper(), awb_number=awb_number.strip(),
                 tracking_status="BOOKED", shipped_at=datetime.now(timezone.utc))
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return "AWB already linked"
    return None

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
