from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/shipments", tags=["shipments"])


def _err(status: int, code: str, message: str) -> JSONResponse:
    """Envelope error (ledger pattern): {success:false, error:{code,message}}."""
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message}},
                        headers={"X-Error-Code": code})


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
        "shipsagar_tracking_id": getattr(s, "shipsagar_tracking_id", None),
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
                   q: str | None = None,
                   page: int = 1, page_size: int = 20,
                   db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from sqlalchemy import or_
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    qy = db.query(Shipment).filter_by(business_id=u.get("business_id"))
    if status:
        qy = qy.filter_by(tracking_status=status)
    if carrier:
        qy = qy.filter_by(carrier_code=carrier)
    if order_id:
        qy = qy.filter_by(order_id=order_id)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        qy = qy.outerjoin(Order, Order.id == Shipment.order_id
                          ).outerjoin(Parcel, Parcel.id == Shipment.parcel_id
                                       ).filter(or_(Shipment.awb_number.ilike(pattern),
                                                    Order.shopify_order_name.ilike(pattern),
                                                    Parcel.barcode_value.ilike(pattern)))
    total = qy.count()
    rows = qy.order_by(Shipment.created_at.desc()).offset(
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
    from fastapi.responses import JSONResponse
    from app.models.shipment import Shipment
    from app.services.shipment_service import TERMINAL, ingest_event
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get('business_id')).first()
    if s is None:
        raise HTTPException(404, 'Shipment not found')
    if (s.tracking_status or '') in TERMINAL:
        return {'success': True, 'data': {'synced': False, 'reason': 'terminal'}}
    now = datetime.now(timezone.utc)
    last = s.last_synced_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        age = (now - last).total_seconds()
        if age < 60:
            retry_after = int(60 - age)
            return JSONResponse(
                status_code=429,
                content={"success": False, "error": {"code": "REFRESH_COOLDOWN",
                         "message": f"Refresh cooldown: retry after {retry_after}s",
                         "retry_after": retry_after}},
                headers={"X-Error-Code": "REFRESH_COOLDOWN", "Retry-After": str(retry_after)},
            )
    try:
        provider = get_provider(s.carrier_code)
        data = provider.get_tracking(s.awb_number)
    except CarrierError as e:
        s.last_synced_at = now
        db.commit()
        return {'success': True, 'data': {'synced': False, 'reason': e.code}}
    n = 0
    for raw_ev in (data.get('events') or []):
        ingest_event(db, s, raw_ev.get('status_raw'), raw_ev.get('message'), raw_ev.get('location'), raw_ev.get('event_time'), raw_ev.get('event_id', ''), 'API', raw_ev)
        n += 1
    s.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    return {'success': True, 'data': {'synced': True, 'new_events': n}}


@router.post('/{sid}/register-tracking')
def register_tracking(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """Register the shipment's courier tracking number with ShipSagar (plan #18).

    Identity chain: parcel_id -> shipment_id -> awb_number
    (courier_tracking_number) -> shipsagar_tracking_id. ShipSagar tracking
    ids are provider references only, never business ids.
    """
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    if u.get('role') not in ('ADMIN', 'WAREHOUSE'):
        return _err(403, 'FORBIDDEN', 'Warehouse role required')
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get('business_id')).first()
    if s is None:
        return _err(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found')
    try:
        result = ss.register_tracking(db, s)
    except ss.ShipsagarError as e:
        db.commit()
        return _err(400, e.code, e.message)
    db.commit()
    db.refresh(s)
    return {'success': True, 'data': {**_sdict(s),
            'shipsagar_tracking_id': result['shipsagar_tracking_id'],
            'shipsagar_stubbed': result['stubbed']}}


@router.post('/poll-sweep')
def poll_sweep(limit: int = 100, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment, CarrierConnection
    from app.services.shipment_service import TERMINAL, ingest_event
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    if u.get('role') != 'ADMIN':
        raise HTTPException(403, 'Admin role required')
    bid = u.get('business_id')
    rows = db.query(Shipment).filter_by(business_id=bid).all()
    rows = [s for s in rows if (s.tracking_status or '') not in TERMINAL]
    rows.sort(key=lambda s: s.last_checkpoint_at or s.created_at or datetime.now(timezone.utc))
    rows = rows[:max(int(limit or 100), 1)]
    checked = synced = skipped = errors = 0
    details: list[dict] = []
    for s in rows:
        checked += 1
        if (s.carrier_code or '').upper() == 'MANUAL':
            skipped += 1
            continue
        try:
            provider = get_provider(s.carrier_code)
            data = provider.get_tracking(s.awb_number)
        except CarrierError as e:
            errors += 1
            details.append({'shipment_id': s.id, 'error': e.code})
            conn = db.query(CarrierConnection).filter_by(
                business_id=bid, carrier_code=(s.carrier_code or '').upper()).first()
            if conn is not None:
                conn.last_error_at = datetime.now(timezone.utc)
                conn.last_error_message = f"{e.code}: {e.message}"
            continue
        except Exception as e:
            errors += 1
            details.append({'shipment_id': s.id, 'error': 'POLL_FAILED'})
            continue
        try:
            n = 0
            for raw_ev in (data.get('events') or []):
                ingest_event(db, s, raw_ev.get('status_raw'), raw_ev.get('message'),
                             raw_ev.get('location'), raw_ev.get('event_time'),
                             raw_ev.get('event_id', ''), 'API', raw_ev)
                n += 1
            s.last_synced_at = datetime.now(timezone.utc)
            conn = db.query(CarrierConnection).filter_by(
                business_id=bid, carrier_code=(s.carrier_code or '').upper()).first()
            if conn is not None:
                conn.last_success_at = datetime.now(timezone.utc)
            synced += 1
        except Exception:
            errors += 1
            details.append({'shipment_id': s.id, 'error': 'POLL_FAILED'})
            continue
    db.commit()
    return {'success': True, 'data': {'checked': checked, 'synced': synced,
                                     'skipped': skipped, 'errors': errors, 'details': details}}


class BookIn(BaseModel):
    carrier_code: str
    service: str | None = None
    awb_number: str | None = None


class CancelIn(BaseModel):
    reason: str | None = None


class NdrIn(BaseModel):
    action: str
    reason: str | None = None


@router.post("/{parcel_id}/book")
def book(parcel_id: str, body: BookIn, request: Request, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.parcel import Parcel
    from app.models.order import Order
    from app.models.customer import Customer
    from app.models.payment import Payment
    from app.models.shipment import Shipment, ShipmentEvent
    from app.models.courier_meta import BookingIdempotency, ShipmentAttempt
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    bid = u.get("business_id")
    key = request.headers.get("Idempotency-Key", "").strip() or None
    if key:
        hit = db.query(BookingIdempotency).filter_by(business_id=bid, key=key).first()
        if hit is not None:
            s = db.query(Shipment).filter_by(id=hit.shipment_id).first()
            return {"success": True, "data": {**_sdict(s), "deduped": True}}
    p = db.query(Parcel).filter_by(id=parcel_id, business_id=bid).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    if (p.status or "CREATED") in ("CLOSED", "RETURN_RECEIVED", "RTO", "DELIVERED", "DISPATCHED"):
        raise HTTPException(400, "Parcel not dispatchable")
    o = db.query(Order).filter_by(id=p.order_id).first()
    if o is None or o.cancelled_at is not None:
        raise HTTPException(400, "Order not bookable")
    if db.query(Shipment).filter_by(parcel_id=p.id).count() > 0:
        raise HTTPException(400, "Shipment already exists for parcel")
    missing = []
    cust = db.query(Customer).filter_by(id=o.customer_id).first() if o.customer_id else None
    if not (cust and cust.phone):
        missing.append("customer phone")
    cod = db.query(Payment).filter_by(business_id=bid, order_id=o.id, method="COD").first()
    carrier = (body.carrier_code or "").upper()
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    try:
        get_provider(carrier)
    except CarrierError:
        raise HTTPException(400, "Unknown carrier")
    service = (body.service or "").strip() or None
    awb = (body.awb_number or "").strip()
    if carrier == "MANUAL" and not awb:
        missing.append("awb_number (manual carrier)")
    if missing:
        db.add(ShipmentAttempt(business_id=bid, parcel_id=p.id, carrier_code=carrier,
                               provider_message="; ".join(f"missing {m}" for m in missing)))
        db.commit()
        raise HTTPException(400, f"Cannot book: missing {', '.join(missing)}")
    if carrier != "MANUAL":
        from app.models.shipment import CarrierConnection
        conn = db.query(CarrierConnection).filter_by(business_id=bid, carrier_code=carrier).first()
        if conn is None or not conn.is_active:
            db.add(ShipmentAttempt(business_id=bid, parcel_id=p.id, carrier_code=carrier,
                                   provider_message="CARRIER_NOT_CONNECTED"))
            db.commit()
            raise HTTPException(400, "CARRIER_NOT_CONNECTED: save provider credentials first")
        if not awb:
            db.add(ShipmentAttempt(business_id=bid, parcel_id=p.id, carrier_code=carrier,
                                   provider_message="AWB_REQUIRED"))
            db.commit()
            raise HTTPException(400, "AWB_REQUIRED: provide awb_number from the carrier channel")
    s = Shipment(business_id=bid, order_id=o.id, parcel_id=p.id, carrier_code=carrier,
                 awb_number=awb, tracking_status="BOOKED", shipped_at=datetime.now(timezone.utc))
    db.add(s)
    db.flush()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "AWB already linked")
    db.refresh(s)
    if key:
        db.add(BookingIdempotency(business_id=bid, key=key, shipment_id=s.id))
        db.commit()
    msg = f"Booked via {carrier} AWB {awb}"
    if service:
        msg += f" service {service}"
    import uuid as _uuid
    db.add(ShipmentEvent(business_id=bid, shipment_id=s.id, carrier_event_id=f"book-{_uuid.uuid4().hex[:12]}",
                         normalized_status="BOOKED", message=msg, source="MANUAL"))
    log_audit(db, bid, u.get("user_id"), "shipment", s.id, "SHIPMENT_BOOKED",
              {"parcel": p.barcode_value}, {"carrier": carrier, "awb": awb, "service": service})
    db.commit()
    db.refresh(s)
    return {"success": True, "data": _sdict(s)}


@router.post("/{sid}/cancel")
def cancel_shipment(sid: str, body: CancelIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    if (s.tracking_status or "") != "BOOKED":
        raise HTTPException(400, "Only BOOKED shipments can be cancelled")
    s.tracking_status = "CANCELLED"
    reason = (body.reason or "").strip()
    import uuid as _uuid2
    db.add(ShipmentEvent(business_id=s.business_id, shipment_id=s.id, carrier_event_id=f"cancel-{_uuid2.uuid4().hex[:12]}",
                         normalized_status="CANCELLED",
                         message=f"Booking cancelled. Reason: {reason}" if reason else "Booking cancelled.",
                         source="MANUAL"))
    log_audit(db, s.business_id, u.get("user_id"), "shipment", s.id, "SHIPMENT_CANCELLED",
              {"tracking_status": "BOOKED"}, {"tracking_status": "CANCELLED", "reason": reason})
    db.commit()
    db.refresh(s)
    return {"success": True, "data": _sdict(s)}


@router.post("/{sid}/ndr")
def ndr_action(sid: str, body: NdrIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        raise HTTPException(403, "Warehouse role required")
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    action = (body.action or "").strip().lower()
    if action not in ("reattempt", "return"):
        raise HTTPException(400, "action must be reattempt or return")
    reason = (body.reason or "").strip()
    import uuid as _uuid3
    if action == "reattempt":
        s.tracking_status = "NDR_REATTEMPT"
        db.add(ShipmentEvent(business_id=s.business_id, shipment_id=s.id, carrier_event_id=f"ndr-{_uuid3.uuid4().hex[:12]}",
                             normalized_status="NDR_REATTEMPT",
                             message=f"NDR reattempt. Reason: {reason}" if reason else "NDR reattempt.",
                             source="MANUAL"))
        from app.models.sla import ShipmentCase
        db.add(ShipmentCase(business_id=s.business_id, shipment_id=s.id,
                            case_type="DELIVERY_EXCEPTION", priority="HIGH",
                            notes=reason or None, created_by=u.get("user_id")))
        log_audit(db, s.business_id, u.get("user_id"), "shipment", s.id, "NDR_REATTEMPT",
                  {}, {"reason": reason})
    else:
        now = datetime.now(timezone.utc)
        s.tracking_status = "RTO_INITIATED"
        s.rto_at = now
        s.last_checkpoint_at = now
        if reason:
            s.last_checkpoint_message = reason
        db.add(ShipmentEvent(business_id=s.business_id, shipment_id=s.id, carrier_event_id=f"rto-{_uuid3.uuid4().hex[:12]}",
                             normalized_status="RTO_INITIATED",
                             message=f"RTO initiated. Reason: {reason}" if reason else "RTO initiated.",
                             source="MANUAL"))
        log_audit(db, s.business_id, u.get("user_id"), "shipment", s.id, "RTO_INITIATED",
                  {}, {"reason": reason})
        try:
            from app.services.reconciliation_service import reconcile_order
            reconcile_order(db, s.order_id)
        except Exception:
            pass
    db.commit()
    db.refresh(s)
    return {"success": True, "data": _sdict(s)}

