from fastapi import APIRouter, Request, BackgroundTasks, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/v1/shopify", tags=["shopify-webhooks"])

@router.post("/webhooks", response_class=PlainTextResponse)
async def receive(request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    from datetime import datetime, timezone
    from app.config import settings
    from app.models.webhook_event import ShopifyWebhookEvent
    from app.services.webhook_service import verify_hmac, process_webhook
    raw = await request.body()
    if not verify_hmac(raw, request.headers.get("X-Shopify-Hmac-Sha256", ""),
                       settings.shopify_client_secret):
        return PlainTextResponse("invalid signature", status_code=401)
    wid = request.headers.get("X-Shopify-Webhook-Id", "")
    if wid and db.query(ShopifyWebhookEvent).filter_by(webhook_id=wid).first() is not None:
        return PlainTextResponse("ok")
    import json as _json
    try:
        payload = _json.loads(raw or b"{}")
    except Exception:
        payload = {}
    ev = ShopifyWebhookEvent(
        business_id=_biz_for(db, request.headers.get("X-Shopify-Shop-Domain", "")),
        webhook_id=wid or f"noid-{datetime.now(timezone.utc).timestamp()}",
        topic=request.headers.get("X-Shopify-Topic", ""),
        shop_domain=request.headers.get("X-Shopify-Shop-Domain", ""),
        payload=payload, processing_status="RECEIVED",
        received_at=datetime.now(timezone.utc), attempts=0)
    db.add(ev); db.commit(); db.refresh(ev)
    background.add_task(_run, ev.id)
    return PlainTextResponse("ok")

def _biz_for(db, domain: str):
    from app.models.shopify_store import ShopifyStore
    s = db.query(ShopifyStore).filter_by(shop_domain=domain).first()
    return s.business_id if s else None

def _run(event_id: str):
    from app.database import SessionLocal
    from app.services.webhook_service import process_webhook
    db = SessionLocal()
    try:
        process_webhook(db, event_id)
    finally:
        db.close()
