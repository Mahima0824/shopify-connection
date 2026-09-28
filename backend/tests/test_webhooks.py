import hmac, hashlib, json
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel
import app.models.scan_event, app.models.return_record, app.models.audit_log
import app.models.shopify_store, app.models.webhook_event, app.models.payment
import app.models.refund, app.models.reconciliation
from app.main import app
from app.database import get_db

SECRET = "testsecret123"

def _client(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    from app.models.business import Business
    from app.models.shopify_store import ShopifyStore
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    db.add(ShopifyStore(business_id=b.id, shop_domain="t.myshopify.com", access_token_encrypted="", api_version="2026-01"))
    db.commit(); db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    # Route BackgroundTasks processing at a fresh test session, not the real SessionLocal.
    monkeypatch.setattr("app.database.SessionLocal", mk)
    return TestClient(app), mk

def _sig(raw: bytes) -> str:
    import base64
    return base64.b64encode(hmac.new(SECRET.encode(), raw, hashlib.sha256).digest()).decode()

def test_bad_hmac_rejected(monkeypatch):
    from app import config
    monkeypatch.setattr(config.settings, "shopify_client_secret", SECRET)
    c, _ = _client(monkeypatch)
    try:
        r = c.post("/api/v1/shopify/webhooks", content=b"{}", headers={"X-Shopify-Hmac-Sha256": "bad",
            "X-Shopify-Topic": "orders/create", "X-Shopify-Shop-Domain": "t.myshopify.com", "X-Shopify-Webhook-Id": "w1"})
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()

def test_duplicate_delivery_single_row(monkeypatch):
    from app import config
    from app.services.webhook_service import process_webhook
    monkeypatch.setattr(config.settings, "shopify_client_secret", SECRET)
    c, mk = _client(monkeypatch)
    try:
        body = json.dumps({"id": 1001, "name": "#W1"}).encode()
        h = {"X-Shopify-Hmac-Sha256": _sig(body), "Content-Type": "application/json",
             "X-Shopify-Topic": "orders/create", "X-Shopify-Shop-Domain": "t.myshopify.com", "X-Shopify-Webhook-Id": "w2"}
        assert c.post("/api/v1/shopify/webhooks", content=body, headers=h).status_code == 200
        assert c.post("/api/v1/shopify/webhooks", content=body, headers=h).status_code == 200
        from app.database import SessionLocal  # noqa - proves import surface only
        from app.models.webhook_event import ShopifyWebhookEvent
        db = mk()
        try:
            assert db.query(ShopifyWebhookEvent).filter_by(webhook_id="w2").count() == 1
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()
