import re
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/shipments", tags=["shipments"])

PARCEL_BARCODE_MAX_LEN = 32


def _err(status: int, code: str, message: str, data: dict | None = None) -> JSONResponse:
    """Envelope error (ledger pattern): {success:false, error:{code,message}}.

    ``data`` is for the failures a caller can still render something with — a
    502 on the courier catalogue carries an empty ``couriers`` list so the push
    dialog's dropdown falls back instead of having nothing to draw.
    """
    content = {"success": False, "error": {"code": code, "message": message}}
    if data is not None:
        content["data"] = data
    return JSONResponse(status_code=status, content=content,
                        headers={"X-Error-Code": code})


SHIPMENT_TYPE_DEFAULT = "Road"
COUNTRY_NAME_DEFAULT = "India"

# India Post is ours to route, so it is always accepted even when ShipSagar's
# GetCourier catalogue does not serve it.
INDIA_POST_COURIER_CODES = ("IP", "INDIA_POST")


def _order_fields(o) -> dict:
    """Display columns sourced from the Order. Every one of them is nullable.

    The four receiver_* columns are read through getattr with a None default.
    They arrive with the India Post order migration, so on a tree that does not
    carry it the attribute does not exist at all and a plain ``o.receiver_name``
    raised AttributeError on every shipment list and detail call. Reading them
    defensively keeps this serializer working on both trees, and a genuinely
    absent column is honestly reported as null rather than invented.
    """
    if o is None:
        return {"order_no": None, "customer_name": None, "customer_email": None,
                "customer_mobile": None, "company_name": None}
    return {
        "order_no": o.internal_order_number or o.shopify_order_name or None,
        "customer_name": getattr(o, "receiver_name", None) or None,
        "customer_email": getattr(o, "receiver_email", None) or None,
        "customer_mobile": getattr(o, "receiver_mobile", None) or None,
        "company_name": getattr(o, "receiver_company", None) or None,
    }


# Exactly YYYY-MM-DD, or that with a time component after a space or a T.
# datetime.fromisoformat also accepts the ISO 8601 basic and week-date spellings
# ("20261003", "2026-W40-1") on 3.11+, and neither is 10 characters, so the
# whole-day branch below was skipped and a bare date_to silently meant midnight -
# dropping the row it was supposed to include. Those spellings are rejected.
_DATE_ONLY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_DATE_TIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}[T ].+")


def _day_bounds(value: str, is_end: bool):
    """UTC bound for a date filter, covering the whole day at the end.

    A bare YYYY-MM-DD becomes 00:00:00.000000 at the start of the day and
    23:59:59.999999 at its end; a full timestamp is taken as given. Same
    semantics as the orders list filter, so the two date pickers cannot
    disagree about what a single day includes.

    Raises ValueError on any spelling that is not an extended ISO date or
    timestamp. The params are declared as plain str, so FastAPI never validates
    them and list_shipments maps the error to a 400 rather than letting it
    become a 500.
    """
    from datetime import datetime, timezone
    text = (value or "").strip()
    date_only = bool(_DATE_ONLY_RE.fullmatch(text))
    if not (date_only or _DATE_TIME_RE.fullmatch(text)):
        raise ValueError(f"unrecognised date spelling: {value!r}")
    dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if date_only:
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        else:
            dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt


def _fmt_action_date(value) -> str:
    """Timeline date, 'DD-Mon-YYYY'. Anything unformattable reads as blank."""
    try:
        return value.strftime("%d-%b-%Y")
    except Exception:
        return ""


def _fmt_action_time(value) -> str:
    """Timeline time, 'HH:MM'. Same blank-on-anything-else contract."""
    try:
        return value.strftime("%H:%M")
    except Exception:
        return ""


def _sdict(s, order=None) -> dict:
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
        "entry_datetime": iso(s.created_at),
        "shipment_type": SHIPMENT_TYPE_DEFAULT,
        "country_name": COUNTRY_NAME_DEFAULT,
        **_order_fields(order),
    }


class ShipmentIn(BaseModel):
    parcel_id: str | None = None
    barcode: str | None = None
    carrier_code: str = "MANUAL"
    awb_number: str


class PushShipmentIn(BaseModel):
    order_id: str
    tracking_no: str
    courier_code: str


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


@router.post("/push")
def push_shipment(body: PushShipmentIn, db: Session = Depends(get_db),
                  u: dict = Depends(get_current_user)):
    """Create the Parcel + Shipment for an order and register it with ShipSagar.

    Tracking numbers come from the India Post worker and are typed in by the
    user. The Parcel is auto-created so the NOT NULL parcel_id FK is satisfied,
    which makes parcels.barcode_value (String(32)) the narrowest column the
    tracking number touches; a longer one is rejected up front rather than
    raising inside MySQL, which SQLite would never catch. Both the shipments and
    the parcels uniqueness probes are kept: create_shipment can leave a Shipment
    owning an AWB whose Parcel carries an unrelated barcode, which only the
    shipment probe sees, and correct_awb can leave a Parcel holding a freed
    barcode, which only the parcel probe sees.

    A provider-level ERROR still persists both records and reports pushed=false;
    a transport failure queues a retry job and returns 502. That job is queued
    as "register_tracking" because it is the only operation drain_retry_queue
    dispatches, and register_tracking rebuilds the whole PushShipment call from
    the committed Shipment row. Any other operation dead-letters as
    UNKNOWN_OPERATION, which would lose a registration that only a transient
    outage had blocked.
    """
    from datetime import datetime, timezone
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    from app.services.order_service import (ShipmentOrderNoError,
                                            assign_shipment_order_no)
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        return _err(403, "FORBIDDEN", "Warehouse role required")
    bid = u.get("business_id")
    tracking_no = (body.tracking_no or "").strip()
    courier_code = (body.courier_code or "").strip().upper()
    if not tracking_no:
        return _err(400, "MISSING_TRACKING_NUMBER", "Tracking number is required.")
    if not courier_code:
        return _err(400, "MISSING_COURIER", "Courier code is required.")
    if len(tracking_no) > PARCEL_BARCODE_MAX_LEN:
        return _err(400, "INVALID_TRACKING_NUMBER_LENGTH",
                    f"Tracking number must be {PARCEL_BARCODE_MAX_LEN} characters or fewer.")
    # The catalogue decides what ShipSagar will accept, so it is checked before
    # the Order lookup and before anything is written. An unreachable catalogue
    # must not block a push, so the India Post allow-list stands alone.
    allowed = set(INDIA_POST_COURIER_CODES)
    try:
        allowed.update(
            str(row.get("courier_code") or "").strip().upper()
            for row in (ss.get_couriers() or []))
    except ss.ShipsagarError:
        pass
    if courier_code not in allowed:
        return _err(400, "UNSUPPORTED_COURIER",
                    f"ShipSagar does not serve courier '{courier_code}'.")
    order = db.query(Order).filter_by(id=body.order_id, business_id=bid).first()
    if order is None:
        return _err(404, "ORDER_NOT_FOUND", "Order not found in this business.")
    if db.query(Shipment).filter_by(order_id=order.id).first() is not None:
        return _err(400, "SHIPMENT_EXISTS", "This order already has a shipment.")
    if db.query(Shipment).filter_by(
            business_id=bid, carrier_code=courier_code,
            awb_number=tracking_no).first() is not None:
        return _err(400, "DUPLICATE_TRACKING",
                    f"Tracking number {tracking_no} is already used for {courier_code}.")
    if db.query(Parcel).filter_by(
            business_id=bid, barcode_value=tracking_no).first() is not None:
        return _err(400, "DUPLICATE_TRACKING",
                    f"Tracking number {tracking_no} already has a parcel.")

    # The OrderNo is a property of the shipment, not of the provider's answer, so
    # it is claimed before the parcel and shipment are built and is therefore the
    # same number on the success, not-configured and queued-retry paths alike.
    # Claiming it first also means the rollback a lost number race forces cannot
    # discard a half-built parcel or shipment.
    try:
        order_no = assign_shipment_order_no(db, order)
    except ShipmentOrderNoError as exc:
        return _err(503, "SHIPMENT_ORDER_NO_UNAVAILABLE", str(exc))

    parcel = Parcel(business_id=bid, order_id=order.id,
                    parcel_code=tracking_no, barcode_value=tracking_no,
                    status="CREATED")
    db.add(parcel)
    db.flush()
    shipment = Shipment(business_id=bid, order_id=order.id, parcel_id=parcel.id,
                        carrier_code=courier_code, awb_number=tracking_no,
                        tracking_status="READY_TO_SHIP",
                        shipped_at=datetime.now(timezone.utc))
    db.add(shipment)
    db.flush()

    if not ss.is_configured():
        shipment.shipsagar_tracking_id = f"SS-STUB-{courier_code}-{tracking_no}"
        db.commit()
        db.refresh(shipment)
        return {"success": True, "data": {**_sdict(shipment),
                                          "order_no": order_no,
                                          "pushed": False,
                                          "message": ss.SHIPSAGAR_NOT_CONFIGURED_MESSAGE}}
    try:
        result = ss.push_shipment(tracking_no=tracking_no,
                                  courier_code=courier_code, order=order)
    except ss.ShipsagarError as exc:
        if exc.code == "SHIPSAGAR_NOT_CONFIGURED":
            shipment.shipsagar_tracking_id = f"SS-STUB-{courier_code}-{tracking_no}"
            db.commit()
            db.refresh(shipment)
            return {"success": True, "data": {**_sdict(shipment),
                                              "order_no": order_no,
                                              "pushed": False,
                                              "message": exc.message}}
        ss.schedule_retry(db, business_id=bid, operation="register_tracking",
                          shipment_id=shipment.id,
                          error=f"{exc.code}: {exc.message}",
                          payload={"courier": courier_code, "tracking_number": tracking_no})
        db.commit()
        return _err(502, exc.code, exc.message)
    shipment.shipsagar_tracking_id = f"SS-{tracking_no}"
    db.commit()
    db.refresh(shipment)
    return {"success": True, "data": {**_sdict(shipment),
                                      "order_no": order_no,
                                      "pushed": bool(result.get("ok")),
                                      "message": result.get("message", "")}}


@router.get("")
def list_shipments(status: str | None = None, carrier: str | None = None, order_id: str | None = None,
                   q: str | None = None, date_from: str | None = None,
                   date_to: str | None = None, order_no: str | None = None,
                   page: int = 1, page_size: int = 20,
                   db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """One page of shipments plus facet counts for the whole filtered set.

    Customer, Company Name, Shipment Type and Country Name are display columns
    rather than stored data: the Order is outer-joined to supply the first two,
    and shipment_type / country_name are the fixed values this deployment
    pushes to ShipSagar. That join is unconditional so the display columns are
    populated on every code path, and it is on the Order's primary key, so it
    can never multiply a shipment row.

    Because the Order join is applied up front, every filter below names the
    Shipment column explicitly: ``filter_by`` binds to the last joined entity,
    so ``filter_by(tracking_status=...)`` would resolve against Order and raise.

    Facets are counted from a subquery of the filtered ids, not from the paged
    rows, so the carrier and status chips keep counting the whole result set
    however the caller paginates. That subquery is also the only thing scoping
    the facet queries: they join shipments to a set of ids and carry no
    business_id predicate of their own, so narrowing or dropping the filter on
    qy would leak another tenant's counts into the chips while the paged items
    stayed correct.
    """
    from sqlalchemy import func, or_
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    qy = (db.query(Shipment)
          .filter_by(business_id=u.get("business_id"))
          .outerjoin(Order, Order.id == Shipment.order_id))
    if status:
        qy = qy.filter(Shipment.tracking_status == status.strip().upper())
    if carrier:
        qy = qy.filter(Shipment.carrier_code == carrier.strip().upper())
    if order_id:
        qy = qy.filter(Shipment.order_id == order_id.strip())
    try:
        if date_from:
            qy = qy.filter(Shipment.created_at >= _day_bounds(date_from, False))
        if date_to:
            qy = qy.filter(Shipment.created_at <= _day_bounds(date_to, True))
    except ValueError:
        return _err(400, "INVALID_DATE",
                    "date_from and date_to must be ISO dates (YYYY-MM-DD) or timestamps.")
    text = f"%{q.strip()}%" if q and q.strip() else None
    order_text = f"%{order_no.strip()}%" if order_no and order_no.strip() else None
    if text:
        qy = (qy.outerjoin(Parcel, Parcel.id == Shipment.parcel_id)
                .filter(or_(Shipment.awb_number.ilike(text),
                            Order.internal_order_number.ilike(text),
                            Order.shopify_order_name.ilike(text),
                            Parcel.barcode_value.ilike(text))))
    if order_text:
        # order_no resolves against Order.internal_order_number, which a push
        # overwrites with the shipment's YYYYMMDD-NNN. So after a push this
        # filter finds the shipment by the number the order then carries; the
        # number the order held before the push is not retained anywhere, and
        # keeping it would need a column this task cannot add.
        qy = qy.filter(or_(Order.internal_order_number.ilike(order_text),
                            Order.shopify_order_name.ilike(order_text)))
    total = qy.count()

    facet_q = qy.with_entities(Shipment.id).subquery()

    def _facets(column):
        return (db.query(column, func.count(Shipment.id))
                .join(facet_q, facet_q.c.id == Shipment.id)
                .group_by(column)
                .order_by(func.count(Shipment.id).desc(), column.asc()).all())

    carrier_rows = _facets(Shipment.carrier_code)
    status_rows = _facets(Shipment.tracking_status)

    size = max(min(int(page_size or 20), 200), 1)
    page_no = max(int(page or 1), 1)
    rows = (qy.add_columns(Order)
            .order_by(Shipment.created_at.desc())
            .offset((page_no - 1) * size).limit(size).all())
    return {"success": True, "data": {
        "items": [_sdict(s, o) for s, o in rows],
        "total": total, "page": page_no, "page_size": size,
        "facets": {
            "carriers": [{"code": c, "count": n} for c, n in carrier_rows],
            "statuses": [{"code": s_, "count": n} for s_, n in status_rows],
        }}}


@router.get("/couriers")
def list_couriers(u: dict = Depends(get_current_user)):
    """The courier catalogue ShipSagar serves, for the push dialog's dropdown.

    Declared BEFORE the /{sid} route on purpose. Starlette matches in
    declaration order, so a /couriers route placed after the parameterised one is
    swallowed by it with sid="couriers" and the caller gets a shipment-not-found
    instead of a catalogue.
    """
    from app.services import shipsagar_service as ss
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        return _err(403, "FORBIDDEN", "Warehouse role required")
    try:
        rows = ss.get_couriers()
    except ss.ShipsagarError as exc:
        # get_couriers only raises when nothing is cached, so there is no
        # previous list to fall back to. The empty list is still returned so the
        # dialog renders rather than blowing up on a 502 body.
        return _err(502, exc.code, exc.message, data={"couriers": []})
    return {"success": True, "data": {"couriers": rows}}


@router.get("/{sid}")
def get_shipment(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.order import Order
    from app.models.shipment import Shipment
    row = (db.query(Shipment, Order)
           .outerjoin(Order, Order.id == Shipment.order_id)
           .filter(Shipment.id == sid, Shipment.business_id == u.get("business_id"))
           .first())
    if row is None:
        raise HTTPException(404, "Shipment not found")
    s, o = row
    return {"success": True, "data": _sdict(s, o)}


@router.get("/{sid}/history")
def shipment_history(sid: str, db: Session = Depends(get_db),
                     u: dict = Depends(get_current_user)):
    """Live tracking history for one shipment, straight from its provider.

    Read-only by contract: no ShipmentEvent row is written and
    shipment.tracking_status is left exactly as it was, so opening the timeline
    can never move a shipment's state. POST /{sid}/sync is the ingesting path.

    ShipSagar documents TrackingHistory oldest-first (its sample runs 12:27 ->
    15:51 -> 19:43 on one day), so the list is reversed for the response — the
    newest scan leads — and the reported status comes from the LAST entry of the
    provider's list, which is that newest, most advanced scan. Taking index 0
    instead would report a shipment as still booked hours after it was delivered.
    """
    from app.carriers.base import CarrierError
    from app.carriers.registry import provider_for_shipment
    from app.models.shipment import Shipment
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        return _err(404, "SHIPMENT_NOT_FOUND", "Shipment not found")
    awb = (s.awb_number or "").strip()
    if not awb:
        return _err(400, "NO_TRACKING_NUMBER",
                    "This shipment has no tracking number yet.")
    try:
        # provider_for_shipment, not the carrier code: a pushed shipment keeps
        # its ShipSagar courier (IP, FEDEX) in carrier_code and is discriminated
        # by shipsagar_tracking_id.
        provider = provider_for_shipment(s)
        data = provider.get_tracking(awb)
    except CarrierError as exc:
        return _err(502, exc.code, exc.message)
    raw_events = data.get("events") or []
    # normalize_status on the provider instance, not the ShipSagar matrix
    # directly: the instance carries the shipment's own courier, so an India Post
    # shipment reads the India Post rows while a direct DTDC one reads DTDC's.
    events = [{
        "action_date": _fmt_action_date(e.get("event_time")),
        "action_time": _fmt_action_time(e.get("event_time")),
        "action_location": e.get("location") or "",
        "action_description": e.get("status_raw") or "",
        "normalized_status": provider.normalize_status(e.get("status_raw") or ""),
    } for e in reversed(raw_events)]
    final_raw = (raw_events[-1].get("status_raw") or "") if raw_events else ""
    return {"success": True, "data": {
        "awb": awb, "courier_code": s.carrier_code,
        "status": provider.normalize_status(final_raw),
        "tracking_url": provider.build_tracking_url(awb),
        "events": events}}


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
    from app.services.shipsagar_service import normalize_shipsagar_status, stale_reason
    applied = bool(getattr(ev, 'rollup_applied', True))
    wanted = normalize_shipsagar_status(s.carrier_code, body.carrier_status_raw or "")
    suppressed = None if applied else (stale_reason(s, wanted, et)
                                       or 'a status the rank table does not govern')
    return {'success': True, 'data': {'event': edict(ev), 'created': created,
                                      'tracking_status': s.tracking_status,
                                      'rollup_applied': applied,
                                      'rollup_suppressed_reason': suppressed}}


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
    from app.carriers.registry import provider_for_shipment
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
        provider = provider_for_shipment(s)
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
            'shipsagar_stubbed': result['stubbed'],
            'pushed': result.get('pushed', False),
            'message': result.get('message', '')}}


@router.post('/poll-sweep')
def poll_sweep(limit: int = 100, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.shipment import Shipment, CarrierConnection
    from app.services.shipment_service import TERMINAL, ingest_event
    from app.carriers.registry import provider_for_shipment
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
            provider = provider_for_shipment(s)
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

