from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/v1/webhooks", tags=["carrier-webhooks"])


@router.post("/{carrier}", response_class=PlainTextResponse)
async def receive_carrier(carrier: str, request: Request, db: Session = Depends(get_db)):
    from app.models.business import Business
    from app.models.shipment import Shipment
    from app.services.shipment_service import ingest_event
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    try:
        provider = get_provider(carrier)
    except CarrierError:
        return PlainTextResponse("unknown carrier", status_code=404)
    try:
        body = await request.json()
    except Exception:
        body = {}
    bid = request.headers.get("X-Business-Id", "")
    if not bid or db.query(Business).filter_by(id=bid).first() is None:
        return PlainTextResponse("unknown business", status_code=401)
    awb = str(body.get("awb_number") or "").strip()
    if not awb:
        return PlainTextResponse("missing awb", status_code=400)
    s = db.query(Shipment).filter_by(
        business_id=bid, carrier_code=provider.code, awb_number=awb).first()
    if s is None:
        return PlainTextResponse("awb not found", status_code=404)
    from datetime import datetime
    et = None
    if body.get("event_time"):
        try:
            et = datetime.fromisoformat(str(body["event_time"]))
        except ValueError:
            et = None
    ingest_event(db, s, body.get("status_raw") or "", body.get("message"),
                 body.get("location"), et, str(body.get("event_id") or ""),
                 "WEBHOOK", body)
    db.commit()
    return PlainTextResponse("ok")
