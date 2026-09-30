"""ShipSagar webhook + health + registration endpoints (plan #19/#75)."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.auth import get_current_user

# Exact plan path (no /v1 prefix).
webhook_router = APIRouter(prefix="/api/webhooks", tags=["shipsagar-webhook"])
# Authenticated operational endpoints.
router = APIRouter(prefix="/api/v1/shipsagar", tags=["shipsagar"])


def _err(code: str, message: str, status: int = 400, **extra):
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message, **extra}},
        headers={"X-Error-Code": code},
    )


def _ok(data: dict, status: int = 200):
    return JSONResponse(status_code=status, content={"success": True, "data": data})


@webhook_router.post("/shipsagar")
async def receive_shipsagar(request: Request, db: Session = Depends(get_db)):
    from app.models.business import Business
    from app.services import shipsagar_service as ss
    from app.models.shipment_event import ShipsagarWebhookFailure

    raw = await request.body()
    sig = request.headers.get("X-ShipSagar-Signature") or request.headers.get("X-Signature")
    ts = request.headers.get("X-ShipSagar-Timestamp") or request.headers.get("X-Timestamp")
    tenant = (request.headers.get("X-Business-Id") or "").strip()

    def _fail(reason: str, detail: str, status: int, payload=None, business_id=None):
        try:
            db.add(ShipsagarWebhookFailure(business_id=business_id, reason=reason,
                                           detail=detail[:2000], raw_payload=payload))
            db.commit()
        except Exception:
            db.rollback()
        return _err(reason, detail, status)

    # 1. Verify signature (plan #69).
    if not ss.verify_signature(raw, sig):
        return _fail("INVALID_SIGNATURE", "ShipSagar webhook signature verification failed.", 401)
    # 2. Replay protection.
    if not ss.verify_timestamp(ts):
        return _fail("STALE_TIMESTAMP", "Webhook timestamp outside tolerance; possible replay.", 401)

    import json as _json
    try:
        body = _json.loads(raw or b"{}")
    except Exception:
        return _fail("INVALID_PAYLOAD", "Webhook body is not valid JSON.", 400)
    if not isinstance(body, dict):
        return _fail("INVALID_PAYLOAD", "Webhook body must be a JSON object.", 400, payload=None)

    # Tenant scope (X-Business-Id pattern, cf. carrier_webhooks): lookups
    # below must never match another tenant's shipment.
    business = db.query(Business).filter_by(id=tenant).first() if tenant else None
    if business is None:
        return _fail("UNKNOWN_BUSINESS",
                     "Unknown or missing X-Business-Id; tenant scope is required.",
                     401, payload=body)

    # 3. Validate event ID / shipment / tracking / courier.
    event_id = str(body.get("event_id") or body.get("id") or body.get("eventId") or "").strip()
    tracking = str(body.get("tracking_number") or body.get("courier_tracking_number")
                   or body.get("awb_number") or body.get("trackingNumber") or "").strip()
    courier = str(body.get("courier") or body.get("courier_code") or "").strip().upper()
    ss_tracking_id = str(body.get("shipsagar_tracking_id") or body.get("tracking_id") or "").strip()
    raw_status = str(body.get("status") or body.get("raw_status") or body.get("event") or "")
    if not event_id:
        return _fail("MISSING_EVENT_ID", "Webhook is missing the event ID.", 400, payload=body)
    if not tracking and not ss_tracking_id:
        return _fail("MISSING_TRACKING", "Webhook is missing the tracking number.", 400, payload=body)
    if courier and courier not in ss.SUPPORTED_COURIERS:
        return _fail("UNSUPPORTED_COURIER", f"Unsupported courier '{courier}'.", 400, payload=body)

    shipment = ss.find_shipment(db, business_id=business.id,
                                tracking_number=tracking or None,
                                courier=courier or None,
                                shipsagar_tracking_id=ss_tracking_id or None)
    if shipment is None:
        return _fail("SHIPMENT_NOT_FOUND",
                     "No shipment matches the webhook tracking reference.", 404,
                     payload=body, business_id=business.id)
    if not courier:
        courier = (shipment.carrier_code or "").upper()
    if courier not in ss.SUPPORTED_COURIERS:
        return _fail("UNSUPPORTED_COURIER",
                     f"Shipment courier '{courier}' is not ShipSagar-supported.", 400, payload=body)

    # 4-6. Normalize -> checkpoint -> update shipment (+ audit), idempotent.
    try:
        ev, created, stale = ss.ingest_shipsagar_event(
            db, shipment, event_id=event_id, courier=courier, raw_status=raw_status,
            sub_status=(body.get("sub_status") or None),
            message=(body.get("message") or body.get("remarks") or None),
            location=(body.get("location") or None),
            event_time=(body.get("event_time") or body.get("timestamp") or None),
            raw_payload=body)
        db.commit()
    except Exception as exc:
        db.rollback()
        try:
            db.add(ShipsagarWebhookFailure(business_id=getattr(shipment, "business_id", None),
                                           reason="PROCESSING_FAILED", detail=str(exc)[:2000],
                                           raw_payload=body))
            db.commit()
        except Exception:
            db.rollback()
        return _err("PROCESSING_FAILED", "Webhook processing failed; payload stored.", 500)
    return _ok({"event_id": event_id, "created": created, "stale": stale,
                "tracking_status": shipment.tracking_status,
                "deduped": not created})


@router.post("/retry-drain")
def retry_drain(limit: int = 50, db: Session = Depends(get_db),
                u: dict = Depends(get_current_user)):
    """Cron-safe drain of due ShipSagar retry jobs (plan #74). ADMIN only."""
    from app.services import shipsagar_service as ss
    if (u.get("role") or "") != "ADMIN":
        return _err("FORBIDDEN", "Admin role required.", 403)
    out = ss.drain_retry_queue(db, limit=limit)
    db.commit()
    return _ok(out)


@router.get("/health")
def shipsagar_health(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """Integration health counters (plan #75)."""
    from sqlalchemy import func as _func
    from app.models.shipment import Shipment
    from app.models.shipment_event import ShipsagarRetryJob, ShipsagarWebhookFailure
    from app.services import shipsagar_service as ss
    failed_webhooks = db.query(_func.count(ShipsagarWebhookFailure.id)).scalar() or 0
    failed_jobs = db.query(_func.count(ShipsagarRetryJob.id)).filter(
        ShipsagarRetryJob.status == "DEAD_LETTER").scalar() or 0
    pending_jobs = db.query(_func.count(ShipsagarRetryJob.id)).filter(
        ShipsagarRetryJob.status == "PENDING").scalar() or 0
    unregistered = db.query(_func.count(Shipment.id)).filter(
        Shipment.shipsagar_tracking_id.is_(None),
        Shipment.carrier_code.in_(list(ss.SUPPORTED_COURIERS))).scalar() or 0
    healthy = (failed_jobs == 0 and pending_jobs == 0)
    return {"success": True, "data": {
        "provider": "SHIPSAGAR", "configured": ss.is_configured(),
        "status": "healthy" if healthy else "warning",
        "failed_webhooks": failed_webhooks,
        "failed_jobs": failed_jobs,
        "pending_jobs": pending_jobs,
        "unregistered_shipments": unregistered,
    }}
