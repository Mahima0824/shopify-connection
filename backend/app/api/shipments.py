from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/shipments", tags=["shipments"])


def _sdict(s) -> dict:
    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {
        "id": s.id,
        "business_id": s.business_id,
        "order_id": s.order_id,
        "parcel_id": s.parcel_id,
        "carrier_code": s.carrier_code,
        "awb_number": s.awb_number,
        "tracking_status": s.tracking_status,
        "carrier_status_raw": s.carrier_status_raw,
        "current_location": s.current_location,
        "last_checkpoint_message": s.last_checkpoint_message,
        "last_checkpoint_at": iso(s.last_checkpoint_at),
        "tracking_url": s.tracking_url,
        "estimated_delivery_at": iso(s.estimated_delivery_at),
        "shipped_at": iso(s.shipped_at),
        "delivered_at": iso(s.delivered_at),
        "rto_at": iso(s.rto_at),
        "returned_at": iso(s.returned_at),
        "last_synced_at": iso(s.last_synced_at),
    }


class ShipmentIn(BaseModel):
    parcel_id: str | None = None
    barcode: str | None = None
    carrier_code: str = "MANUAL"
    awb_number: str


class CorrectAwbIn(BaseModel):
    awb_number: str
    reason: str


@router.post("")
def create_shipment(body: ShipmentIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    bid = u.get("business_id")
    if body.parcel_id:
        p = db.query(Parcel).filter_by(id=body.parcel_id, business_id=bid).first()
    elif body.barcode:
        p = db.query(Parcel).filter_by(barcode_value=body.barcode.strip(), business_id=bid).first()
    else:
        raise HTTPException(400, "parcel_id or barcode is required")
    if p is None:
        raise HTTPException(404, "Parcel not found")
    awb = (body.awb_number or "").strip()
    if not awb:
        raise HTTPException(400, "awb_number is required")
    s = Shipment(business_id=bid, order_id=p.order_id, parcel_id=p.id,
                 carrier_code=(body.carrier_code or "MANUAL").upper(), awb_number=awb,
                 tracking_status="BOOKED", shipped_at=datetime.now(timezone.utc))
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "AWB already linked")
    db.refresh(s)
    return {"success": True, "data": _sdict(s)}


@router.get("")
def list_shipments(status: str | None = None, carrier: str | None = None, order_id: str | None = None,
                   page: int = 1, page_size: int = 20,
                   db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.shipment import Shipment
    q = db.query(Shipment).filter_by(business_id=u.get("business_id"))
    if status:
        q = q.filter_by(tracking_status=status)
    if carrier:
        q = q.filter_by(carrier_code=carrier)
    if order_id:
        q = q.filter_by(order_id=order_id)
    total = q.count()
    rows = q.order_by(Shipment.created_at.desc()).offset(
        (max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    return {"success": True, "data": {"items": [_sdict(s) for s in rows], "total": total, "page": max(int(page or 1), 1)}}


@router.get("/{sid}")
def get_shipment(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.shipment import Shipment
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    return {"success": True, "data": _sdict(s)}


@router.post("/{sid}/correct-awb")
def correct_awb(sid: str, body: CorrectAwbIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.audit_service import log_audit
    if u.get("role") != "ADMIN":
        raise HTTPException(403, "Admin role required")
    if not (body.reason or "").strip():
        raise HTTPException(400, "Reason is required")
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    old = s.awb_number
    new = (body.awb_number or "").strip()
    if not new:
        raise HTTPException(400, "awb_number is required")
    if new == old:
        return {"success": True, "data": _sdict(s)}
    dup = db.query(Shipment).filter_by(business_id=s.business_id, carrier_code=s.carrier_code, awb_number=new).first()
    if dup is not None:
        raise HTTPException(400, "AWB already linked")
    s.awb_number = new
    db.add(ShipmentEvent(business_id=s.business_id, shipment_id=s.id, carrier_event_id="",
                         normalized_status=s.tracking_status,
                         message=f"AWB corrected: {old} -> {new}. Reason: {body.reason.strip()}",
                         source="MANUAL"))
    log_audit(db, s.business_id, u.get("user_id"), "shipment", s.id, "AWB_CORRECTED",
              {"awb_number": old}, {"awb_number": new, "reason": body.reason.strip()})
    db.commit()
    db.refresh(s)
    return {"success": True, "data": _sdict(s)}


class CheckpointIn(BaseModel):
    carrier_event_id: str = ''
    carrier_status_raw: str = ''
    message: str | None = None
    location: str | None = None
    event_time: str | None = None


@router.post('/{sid}/events')
def add_event(sid: str, body: CheckpointIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event, edict
    if u.get('role') not in ('ADMIN', 'WAREHOUSE'):
        raise HTTPException(403, 'Warehouse role required')
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get('business_id')).first()
    if s is None:
        raise HTTPException(404, 'Shipment not found')
    et = None
    if body.event_time:
        try:
            et = datetime.fromisoformat(body.event_time)
        except ValueError:
            raise HTTPException(400, 'Invalid event_time')
    ev, created = ingest_event(db, s, body.carrier_status_raw, body.message, body.location, et, body.carrier_event_id, 'MANUAL')
    db.commit()
    db.refresh(s)
    return {'success': True, 'data': {'event': edict(ev), 'created': created, 'tracking_status': s.tracking_status}}


@router.get('/{sid}/events')
def list_events(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.shipment_service import edict
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get('business_id')).first()
    if s is None:
        raise HTTPException(404, 'Shipment not found')
    rows = db.query(ShipmentEvent).filter_by(shipment_id=s.id).order_by(ShipmentEvent.event_time).all()
    return {'success': True, 'data': {'items': [edict(e) for e in rows]}}


@router.post('/{sid}/sync')
def sync_shipment(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment
    from app.services.shipment_service import TERMINAL, ingest_event
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get('business_id')).first()
    if s is None:
        raise HTTPException(404, 'Shipment not found')
    if (s.tracking_status or '') in TERMINAL:
        return {'success': True, 'data': {'synced': False, 'reason': 'terminal'}}
    try:
        provider = get_provider(s.carrier_code)
        data = provider.get_tracking(s.awb_number)
    except CarrierError as e:
        return {'success': True, 'data': {'synced': False, 'reason': e.code}}
    n = 0
    for raw_ev in (data.get('events') or []):
        ingest_event(db, s, raw_ev.get('status_raw'), raw_ev.get('message'), raw_ev.get('location'), raw_ev.get('event_time'), raw_ev.get('event_id', ''), 'API', raw_ev)
        n += 1
    s.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    return {'success': True, 'data': {'synced': True, 'new_events': n}}

