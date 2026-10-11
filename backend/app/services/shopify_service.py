"""Shopify sync service: normalize + idempotent upsert.

UPSERT key: (business_id, shopify_order_id). No duplicates on re-sync.
Route handlers stay thin; all business logic lives here.
"""

from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.config import settings

log = logging.getLogger(__name__)


def _get_fernet() -> Fernet:
    key = settings.encryption_key
    if not key:
        b_secret = (settings.jwt_secret * 4).encode("utf-8")[:32]
        key = base64.urlsafe_b64encode(b_secret).decode("utf-8")
    return Fernet(key.encode("utf-8") if isinstance(key, str) else key)


def encrypt_token(plain_text: str) -> str:
    if not plain_text:
        return ""
    try:
        f = _get_fernet()
        return f.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return base64.b64encode(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_token(cipher_text: str) -> str:
    if not cipher_text:
        return ""
    try:
        f = _get_fernet()
        return f.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception:
        try:
            return base64.b64decode(cipher_text.encode("utf-8")).decode("utf-8")
        except Exception:
            return cipher_text


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

    # Extract Shipping Address & Customer Details
    shipping = p.get("shipping_address") or p.get("billing_address") or {}
    customer = p.get("customer") or {}

    first_name = str(shipping.get("first_name") or customer.get("first_name") or "").strip()
    last_name = str(shipping.get("last_name") or customer.get("last_name") or "").strip()
    full_name = str(shipping.get("name") or "").strip() or f"{first_name} {last_name}".strip()
    receiver_name = full_name if full_name else "Valued Customer"

    receiver_company = str(shipping.get("company") or "").strip()
    receiver_add1 = str(shipping.get("address1") or "").strip()
    receiver_add2 = str(shipping.get("address2") or "").strip()
    if not receiver_add1 and receiver_add2:
        receiver_add1 = receiver_add2
        receiver_add2 = ""

    receiver_city = str(shipping.get("city") or "").strip()
    receiver_state = str(shipping.get("province") or shipping.get("province_code") or "").strip()
    receiver_pincode = str(shipping.get("zip") or "").strip()
    receiver_mobile = str(shipping.get("phone") or customer.get("phone") or p.get("phone") or "").strip()
    receiver_email = str(customer.get("email") or p.get("email") or "").strip()

    # Determine COD vs PREPAID mode
    gateways = [str(g).lower() for g in (p.get("payment_gateway_names") or [])]
    if not gateways and p.get("gateway"):
        gateways = [str(p.get("gateway")).lower()]
    
    is_cod = any("cod" in g or "cash" in g or "delivery" in g or "manual" in g for g in gateways)
    cod_mode = "COD" if is_cod else "PREPAID"
    total_val = _to_float(p.get("total_price", 0))
    cod_value = total_val if is_cod else 0.0

    return {
        "shopify_order_id": shopify_order_id,
        "shopify_order_name": name,
        "internal_order_number": internal_order_number,
        "currency": str(p.get("currency", "INR") or "INR"),
        "subtotal_amount": _to_float(p.get("subtotal", 0)),
        "discount_amount": _to_float(p.get("total_discounts", 0)),
        "shipping_amount": _to_float(p.get("total_shipping", 0)),
        "tax_amount": _to_float(p.get("total_tax", 0)),
        "total_amount": total_val,
        "financial_status": financial,
        "payment_status": payment_map.get(financial, "PENDING"),
        "fulfillment_status": str(p.get("fulfillment_status", "unfulfilled") or "unfulfilled").upper(),
        "order_date": created or now,
        "shopify_created_at": created,
        "shopify_updated_at": updated,
        "cancelled_at": _parse_dt(p.get("cancelled_at")),
        "cancel_reason": p.get("cancel_reason"),
        "receiver_name": receiver_name,
        "receiver_company": receiver_company,
        "receiver_add1": receiver_add1,
        "receiver_add2": receiver_add2,
        "receiver_city": receiver_city,
        "receiver_state": receiver_state,
        "receiver_pincode": receiver_pincode,
        "receiver_mobile": receiver_mobile,
        "receiver_email": receiver_email,
        "cod_mode": cod_mode,
        "cod_value": cod_value,
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


def _extract_image_url(li: dict) -> str | None:
    if not isinstance(li, dict):
        return None
    for k in ("image", "featured_image", "product_image", "image_url"):
        val = li.get(k)
        if isinstance(val, str) and val.startswith("http"):
            return val
        if isinstance(val, dict):
            src = val.get("src") or val.get("url")
            if src and isinstance(src, str) and src.startswith("http"):
                return src
    return None



def backfill_missing_product_images(db: Session, business_id: str) -> int:
    """Fetch and update exact Shopify product images for order items with missing image_url."""
    from app.models.order import OrderItem
    from app.models.product import Product
    from app.models.shopify_store import ShopifyStore
    import httpx

    items = db.query(OrderItem).filter(
        OrderItem.business_id == business_id,
        (OrderItem.image_url == None) | (OrderItem.image_url == "")
    ).all()

    if not items:
        return 0

    store = db.query(ShopifyStore).filter_by(business_id=business_id).first()
    token = os.getenv("SHOPIFY_ACCESS_TOKEN", "") or settings.shopify_access_token
    domain = os.getenv("SHOPIFY_SHOP_DOMAIN", "") or settings.shopify_shop_domain
    if not token and store and store.access_token_encrypted:
        token = decrypt_token(store.access_token_encrypted)
    if not domain and store:
        domain = store.shop_domain

    updated_count = 0

    if token and domain:
        products = db.query(Product).filter(
            Product.business_id == business_id,
            (Product.image_url == None) | (Product.image_url == "")
        ).all()
        
        shopify_pids = [p.shopify_product_id for p in products if p.shopify_product_id]
        if shopify_pids:
            try:
                url = f"https://{domain}/admin/api/{settings.shopify_api_version}/products.json"
                params = {"ids": ",".join(shopify_pids[:100]), "fields": "id,title,image,images"}
                headers = {"X-Shopify-Access-Token": token}
                r = httpx.get(url, headers=headers, params=params, timeout=10.0)
                if r.status_code == 200:
                    data = r.json().get("products", [])
                    img_map = {}
                    for p in data:
                        pid = str(p.get("id"))
                        img_obj = p.get("image") or (p.get("images", [{}])[0] if p.get("images") else None)
                        if isinstance(img_obj, dict) and img_obj.get("src"):
                            img_map[pid] = img_obj["src"]

                    for p in products:
                        if p.shopify_product_id in img_map:
                            p.image_url = img_map[p.shopify_product_id]

                    for it in items:
                        if it.product_id:
                            prod = db.get(Product, it.product_id)
                            if prod and prod.image_url:
                                it.image_url = prod.image_url
                                updated_count += 1
                    db.commit()
            except Exception as e:
                log.warning(f"Live backfill failed: {e}")

    for it in items:
        if not it.image_url:
            img = _extract_image_url({"title": it.title})
            if img:
                it.image_url = img
                if it.product_id:
                    prod = db.get(Product, it.product_id)
                    if prod and not prod.image_url:
                        prod.image_url = img
                updated_count += 1

    db.commit()
    return updated_count


def _upsert_items_and_payment(db: Session, business_id: str, order_id: str, payload: dict, total: float) -> None:
    from app.models.order import OrderItem
    from app.models.payment import Payment
    from app.models.product import Product

    existing_items = {
        (item.sku or item.title or str(item.id)): item
        for item in db.query(OrderItem).filter_by(order_id=order_id).all()
    }

    for li in payload.get("line_items", []) or []:
        sku = str(li.get("sku")) if li.get("sku") else None
        title = str(li.get("title", "") or "")
        key = sku or title
        img_url = _extract_image_url(li)

        product = None
        if sku:
            product = db.query(Product).filter_by(business_id=business_id, sku=sku).first()
        if product is None and title:
            product = db.query(Product).filter_by(business_id=business_id, title=title).first()

        if product is None:
            product = Product(
                business_id=business_id,
                shopify_product_id=str(li.get("product_id") or li.get("id") or "") if (li.get("product_id") or li.get("id")) else None,
                title=title,
                sku=sku,
                price=_to_float(li.get("price", 0)),
                image_url=img_url,
            )
            db.add(product)
            db.flush()
        elif img_url and not product.image_url:
            product.image_url = img_url
            db.flush()

        effective_img = img_url or (product.image_url if product else None)

        if key in existing_items:
            item = existing_items[key]
            item.title = title
            item.sku = sku
            item.quantity = int(li.get("quantity", 1) or 1)
            item.price = _to_float(li.get("price", 0))
            item.product_id = product.id
            if effective_img:
                item.image_url = effective_img
        else:
            item = OrderItem(
                business_id=business_id,
                order_id=order_id,
                product_id=product.id,
                title=title,
                sku=sku,
                quantity=int(li.get("quantity", 1) or 1),
                price=_to_float(li.get("price", 0)),
                image_url=effective_img,
            )
            db.add(item)

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


def upsert_order(db: Session, business_id: str, payload: dict, is_bulk_sync: bool = False) -> str:
    """Idempotent upsert on (business_id, shopify_order_id). Returns order id."""
    from app.models.order import Order

    n = normalize_shopify_order(payload)
    o = (
        db.query(Order)
        .filter_by(business_id=business_id, shopify_order_id=n["shopify_order_id"])
        .first()
    )
    if o is None and n.get("internal_order_number"):
        o = (
            db.query(Order)
            .filter_by(business_id=business_id, internal_order_number=n["internal_order_number"])
            .first()
        )
    if o is not None:
        for k, v in n.items():
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
    try:  # additive ledger hook: SALE event, idempotent; never break order sync
        from app.services.ledger_service import record_sale_from_order
        record_sale_from_order(db, business_id, o)
        db.commit()
    except Exception:
        log.exception("ledger SALE hook failed")
        db.rollback()
    try:
        from app.services.barcode_service import ensure_parcel_for_order
        ensure_parcel_for_order(db, o.id)
    except Exception:
        log.exception("parcel autocreate failed")
        db.rollback()
    try:
        from app.services.shipment_service import ensure_awaiting_shipment
        ensure_awaiting_shipment(db, o)
        db.commit()
    except Exception:
        log.exception("awaiting shipment autocreate failed")
        db.rollback()
    if not is_bulk_sync:
        try:
            from app.services.reconciliation_service import reconcile_order
            reconcile_order(db, o.id)
        except Exception:
            pass
        try:
            from app.services.whatsapp_service import send_order_confirmation_whatsapp
            send_order_confirmation_whatsapp(db, o)
        except Exception:
            log.exception("whatsapp order confirmation trigger failed")
    return o.id
