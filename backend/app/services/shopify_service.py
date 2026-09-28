"""Shopify sync service: normalize + idempotent upsert.

UPSERT key: (business_id, shopify_order_id). No duplicates on re-sync.
Route handlers stay thin; all business logic lives here.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import settings

log = logging.getLogger(__name__)


def _parse_dt(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _to_float(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def normalize_shopify_order(p: dict) -> dict:
    """Normalize raw Shopify order payload to Order column values.

    Uses ``*_amount`` keys per Task 2 Order model.
    """
    created = _parse_dt(p.get("created_at"))
    updated = _parse_dt(p.get("updated_at"))
    now = datetime.now(timezone.utc)
    shopify_order_id = str(p.get("id", ""))
    name = str(p.get("name", "") or "")
    internal = name.lstrip("#").strip() or shopify_order_id
    internal_order_number = f"ORD-{internal}"
    financial = str(p.get("financial_status", "pending") or "pending").upper()
    payment_map = {
        "PAID": "PAID",
        "PENDING": "PENDING",
        "REFUNDED": "REFUNDED",
        "PARTIALLY_PAID": "PARTIALLY_PAID",
        "PARTIALLY_REFUNDED": "PARTIALLY_REFUNDED",
        "VOIDED": "VOIDED",
    }
    return {
        "shopify_order_id": shopify_order_id,
        "shopify_order_name": name,
        "internal_order_number": internal_order_number,
        "currency": str(p.get("currency", "INR") or "INR"),
        "subtotal_amount": _to_float(p.get("subtotal", 0)),
        "discount_amount": _to_float(p.get("total_discounts", 0)),
        "shipping_amount": _to_float(p.get("total_shipping", 0)),
        "tax_amount": _to_float(p.get("total_tax", 0)),
        "total_amount": _to_float(p.get("total_price", 0)),
        "financial_status": financial,
        "payment_status": payment_map.get(financial, "PENDING"),
        "fulfillment_status": str(p.get("fulfillment_status", "unfulfilled") or "unfulfilled").upper(),
        "order_date": created or now,
        "shopify_created_at": created,
        "shopify_updated_at": updated,
        "cancelled_at": _parse_dt(p.get("cancelled_at")),
        "cancel_reason": p.get("cancel_reason"),
    }


# --- Fernet token helpers (stub when no key) ---


def encrypt_token(plain: str) -> str:
    """Encrypt a Shopify access token. Never log the plaintext."""
    key = settings.encryption_key or os.getenv("ENCRYPTION_KEY", "")
    if not key:
        # TODO: set ENCRYPTION_KEY env var to enable Fernet encryption; storing plain for dev.
        return plain
    from cryptography.fernet import Fernet

    return Fernet(key.encode() if isinstance(key, str) else key).encrypt(plain.encode()).decode()


def decrypt_token(stored: str) -> str:
    """Decrypt a stored Shopify access token. Never log secrets."""
    key = settings.encryption_key or os.getenv("ENCRYPTION_KEY", "")
    if not key:
        # TODO: set ENCRYPTION_KEY env var to enable Fernet encryption; stored value is plain.
        return stored
    from cryptography.fernet import Fernet

    return Fernet(key.encode() if isinstance(key, str) else key).decrypt(stored.encode()).decode()


# --- Upserts ---


def _upsert_customer(db: Session, business_id: str, raw: dict | None):
    """Minimal customer upsert; returns Customer or None. Never logs PII secrets."""
    if not raw:
        return None
    from app.models.customer import Customer

    shopify_customer_id = str(raw.get("id")) if raw.get("id") is not None else None
    q = db.query(Customer).filter_by(business_id=business_id)
    existing = None
    if shopify_customer_id:
        existing = q.filter_by(shopify_customer_id=shopify_customer_id).first()
    if existing is None and raw.get("email"):
        existing = q.filter_by(email=str(raw.get("email"))).first()
    if existing is not None:
        existing.first_name = str(raw.get("first_name", "") or "")
        existing.last_name = str(raw.get("last_name", "") or "")
        if raw.get("email"):
            existing.email = str(raw.get("email"))
        if raw.get("phone"):
            existing.phone = str(raw.get("phone"))
        db.flush()
        return existing
    c = Customer(
        business_id=business_id,
        shopify_customer_id=shopify_customer_id,
        first_name=str(raw.get("first_name", "") or ""),
        last_name=str(raw.get("last_name", "") or ""),
        email=str(raw.get("email")) if raw.get("email") else None,
        phone=str(raw.get("phone")) if raw.get("phone") else None,
    )
    db.add(c)
    db.flush()
    return c


def _upsert_items_and_payment(db: Session, business_id: str, order_id: str, payload: dict, total: float) -> None:
    from app.models.order import OrderItem
    from app.models.payment import Payment
    from app.models.product import Product

    # Idempotent items: clear then re-insert.
    db.query(OrderItem).filter_by(order_id=order_id).delete()
    db.flush()
    for li in payload.get("line_items", []) or []:
        sku = str(li.get("sku")) if li.get("sku") else None
        product = None
        if sku:
            product = (
                db.query(Product).filter_by(business_id=business_id, sku=sku).first()
            )
        title = str(li.get("title", "") or "")
        if product is None:
            product = Product(
                business_id=business_id,
                shopify_product_id=str(li.get("id")) if li.get("id") is not None else None,
                title=title,
                sku=sku,
                price=_to_float(li.get("price", 0)),
            )
            db.add(product)
            db.flush()
        db.add(
            OrderItem(
                business_id=business_id,
                order_id=order_id,
                product_id=product.id,
                title=title,
                sku=sku,
                quantity=int(li.get("quantity", 1) or 1),
                price=_to_float(li.get("price", 0)),
            )
        )
    db.flush()
    pay = db.query(Payment).filter_by(business_id=business_id, order_id=order_id).first()
    if pay is not None:
        pay.amount = total
    else:
        db.add(
            Payment(
                business_id=business_id,
                order_id=order_id,
                amount=total,
                payment_status="PENDING",
            )
        )
    db.flush()


def upsert_order(db: Session, business_id: str, payload: dict) -> str:
    """Idempotent upsert on (business_id, shopify_order_id). Returns order id."""
    from app.models.order import Order

    n = normalize_shopify_order(payload)
    o = (
        db.query(Order)
        .filter_by(business_id=business_id, shopify_order_id=n["shopify_order_id"])
        .first()
    )
    if o is not None:
        for k, v in n.items():
            if k in ("internal_order_number",):
                continue  # keep stable unique value
            setattr(o, k, v)
        db.flush()
    else:
        o = Order(business_id=business_id, operational_status="NEW", **n)
        db.add(o)
        db.flush()
    customer = _upsert_customer(db, business_id, payload.get("customer"))
    if customer is not None:
        o.customer_id = customer.id
    _upsert_items_and_payment(db, business_id, o.id, payload, float(n["total_amount"]))
    db.commit()
    db.refresh(o)
    try:
        from app.services.barcode_service import ensure_parcel_for_order
        ensure_parcel_for_order(db, o.id)
    except Exception:
        log.exception("parcel autocreate failed")
        db.rollback()
    try:
        from app.services.reconciliation_service import reconcile_order
        reconcile_order(db, o.id)
    except Exception: pass
    return o.id
