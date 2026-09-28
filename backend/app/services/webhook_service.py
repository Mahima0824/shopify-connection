import base64
import hashlib
import hmac as hmac_mod

def verify_hmac(raw: bytes, header_sig: str, secret: str) -> bool:
    if not secret or not header_sig:
        return False
    digest = hmac_mod.new(secret.encode(), raw, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac_mod.compare_digest(expected, header_sig)

def process_webhook(db, event_id: str) -> str:
    from datetime import datetime, timezone
    from app.models.webhook_event import ShopifyWebhookEvent
    ev = db.query(ShopifyWebhookEvent).filter_by(id=event_id).first()
    if ev is None:
        return "SKIPPED"
    if ev.processing_status == "DONE":
        return "DONE"
    ev.processing_status = "PROCESSING"
    try:
        _apply(db, ev)
    except ValueError as e:
        ev.processing_status = "SKIPPED"; ev.error_message = str(e)[:500]
        db.commit(); return "SKIPPED"
    except Exception as e:
        ev.attempts = (ev.attempts or 0) + 1
        ev.error_message = f"{type(e).__name__}: {e}"[:500]
        ev.processing_status = "FAILED" if ev.attempts < 3 else "SKIPPED"
        db.commit(); return ev.processing_status
    ev.processing_status = "DONE"; ev.processed = True
    ev.processed_at = datetime.now(timezone.utc)
    db.commit()
    try:
        from app.services.reconciliation_service import reconcile_order
        o = _resolve_order(db, ev)
        if o is not None:
            reconcile_order(db, o.id)
    except Exception:
        pass
    return "DONE"


def _business_id(db, ev) -> str:
    """Resolve owning business via shop domain. Unknown domain -> ValueError (SKIPPED, no retry)."""
    from app.models.shopify_store import ShopifyStore
    if ev.shop_domain:
        s = db.query(ShopifyStore).filter_by(shop_domain=ev.shop_domain).first()
        if s is not None:
            return s.business_id
    raise ValueError(f"unknown shop domain: {ev.shop_domain!r}")


def _find_order(db, business_id: str, shopify_order_id: str):
    from app.models.order import Order
    return db.query(Order).filter_by(business_id=business_id, shopify_order_id=shopify_order_id).first()


def _apply(db, ev) -> None:
    from datetime import datetime, timezone
    topic = ev.topic or ""
    payload = ev.payload or {}
    business_id = _business_id(db, ev)
    if ev.business_id is None:
        ev.business_id = business_id
    if topic in ("orders/create", "orders/updated"):
        from app.services.shopify_service import upsert_order
        upsert_order(db, business_id, payload)
    elif topic == "orders/cancelled":
        from app.services.shopify_service import _parse_dt, upsert_order
        upsert_order(db, business_id, payload)
        o = _find_order(db, business_id, str(payload.get("id", "")))
        if o is not None:
            o.cancelled_at = _parse_dt(payload.get("cancelled_at")) or datetime.now(timezone.utc)
            o.cancel_reason = payload.get("cancel_reason")
            db.commit()
    elif topic == "refunds/create":
        from app.models.refund import Refund
        o = _find_order(db, business_id, str(payload.get("order_id", "")))
        if o is None:
            raise ValueError(f"order not found for refund: {payload.get('order_id')!r}")
        txns = payload.get("transactions") or []
        amount = sum(float(t.get("amount", 0) or 0) for t in txns if isinstance(t, dict))
        if not amount:
            try:
                amount = float(payload.get("amount", 0) or 0)
            except (TypeError, ValueError):
                amount = 0.0
        rid = str(payload.get("id", ""))
        r = db.query(Refund).filter_by(business_id=business_id, shopify_refund_id=rid).first()
        if r is None:
            r = Refund(business_id=business_id, order_id=o.id, shopify_refund_id=rid,
                       amount=amount, currency=str(payload.get("currency", "INR") or "INR"),
                       status="COMPLETED")
            db.add(r)
        else:
            r.amount = amount
            r.order_id = o.id
        try:
            total = float(o.total_amount or 0)
        except (TypeError, ValueError):
            total = 0.0
        o.financial_status = "REFUNDED" if total and amount >= total else "PARTIALLY_REFUNDED"
        o.payment_status = o.financial_status
        db.commit()
    elif topic in ("fulfillments/create", "fulfillments/update"):
        o = _find_order(db, business_id, str(payload.get("order_id", "")))
        if o is not None and str(payload.get("status", "")).lower() == "success":
            o.fulfillment_status = "FULFILLED"
            db.commit()
    else:
        pass  # unknown topic -> no-op


def _resolve_order(db, ev):
    """Return the Order touched by this event, or None."""
    payload = ev.payload or {}
    topic = ev.topic or ""
    if topic.startswith("orders/"):
        raw = payload.get("id")
    elif topic.startswith("refund") or topic.startswith("fulfillment"):
        raw = payload.get("order_id")
    else:
        return None
    if raw is None or ev.business_id is None:
        return None
    return _find_order(db, ev.business_id, str(raw))
