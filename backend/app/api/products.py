"""Products API router: fetch and search Shopify products."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.auth import bearer, _decode, get_current_user
from app.config import settings
from app.database import get_db
from app.models.product import Product
from app.models.shopify_store import ShopifyStore
from app.services.shopify_service import decrypt_token, _extract_image_url

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/products", tags=["products"])


def _to_product_dict(p: Product) -> dict[str, Any]:
    def num(v):
        try:
            return float(v) if v is not None else 0.0
        except Exception:
            return 0.0

    qty = getattr(p, "stock_quantity", 50)
    if qty is None:
        qty = 50

    if qty <= 0:
        status = "OUT_OF_STOCK"
    elif qty < 5:
        status = "LOW_STOCK"
    else:
        status = "IN_STOCK"

    return {
        "id": p.id,
        "shopify_product_id": p.shopify_product_id,
        "title": p.title,
        "sku": p.sku,
        "price": num(p.price),
        "stock_quantity": qty,
        "stock_status": status,
        "image_url": p.image_url,
    }




def get_user_optional(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if creds and creds.credentials:
        try:
            return _decode(creds.credentials)
        except Exception:
            pass
    return {}


@router.get("")
def list_products(
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_user_optional),
):
    bid = _user.get("business_id") or _user.get("bid")
    query = db.query(Product)
    if bid:
        from sqlalchemy import or_
        query = query.filter(or_(Product.business_id == bid, Product.business_id.is_(None)))
    if search:
        s = f"%{search.strip()}%"
        from sqlalchemy import or_
        query = query.filter(or_(Product.title.ilike(s), Product.sku.ilike(s)))

    products = query.order_by(Product.created_at.desc()).all()

    # If database has no products yet, attempt to fetch live from Shopify API
    if not products:
        token = os.getenv("SHOPIFY_ACCESS_TOKEN", "") or settings.shopify_access_token
        domain = os.getenv("SHOPIFY_SHOP_DOMAIN", "") or settings.shopify_shop_domain
        if bid:
            store = db.query(ShopifyStore).filter_by(business_id=bid).first()
            if not token and store and store.access_token_encrypted:
                token = decrypt_token(store.access_token_encrypted)
            if not domain and store:
                domain = store.shop_domain

        if token and domain:
            import httpx
            try:
                url = f"https://{domain}/admin/api/{settings.shopify_api_version}/products.json"
                params = {"limit": 100, "fields": "id,title,variants,image,images"}
                headers = {"X-Shopify-Access-Token": token}
                r = httpx.get(url, headers=headers, params=params, timeout=10.0)
                if r.status_code == 200:
                    raw_prods = r.json().get("products", [])
                    for rp in raw_prods:
                        spid = str(rp.get("id"))
                        title = str(rp.get("title", "") or "")
                        img_obj = rp.get("image") or (rp.get("images", [{}])[0] if rp.get("images") else None)
                        img_src = img_obj.get("src") if isinstance(img_obj, dict) else None

                        vars_list = rp.get("variants", []) or [{}]
                        for v in vars_list:
                            sku = v.get("sku")
                            price = float(v.get("price", 0) or 0)
                            p_row = Product(
                                business_id=bid,
                                shopify_product_id=spid,
                                title=title,
                                sku=str(sku) if sku else None,
                                price=price,
                                image_url=img_src,
                            )
                            db.add(p_row)
                    db.commit()
                    products = db.query(Product).order_by(Product.created_at.desc()).all()
            except Exception as e:
                log.warning(f"Live products fetch failed: {e}")

    # Fallback seed saree collection if database is completely empty
    if not products:
        demo_sarees = [
            {"title": "Wine Bandhani Ajrakh Mirrorwork Saree", "sku": "RS-BD-01", "price": 1499.00, "image_url": "https://cdn.shopify.com/s/files/1/0591/8972/3200/files/IMG_1040_720x.jpg"},
            {"title": "Saundarya Antique Gold Kanjivaram Tissue Soft Silk Saree", "sku": "RS-KJ-02", "price": 1499.00, "image_url": "https://cdn.shopify.com/s/files/1/0591/8972/3200/files/IMG_0988_720x.jpg"},
            {"title": "Lavender Banarasi Soft Silk Saree", "sku": "RS-BN-03", "price": 1500.00, "image_url": "https://cdn.shopify.com/s/files/1/0591/8972/3200/files/IMG_1012_720x.jpg"},
            {"title": "Green Soft Silk Fancy Border Paithani Saree", "sku": "RS-PT-04", "price": 1650.00, "image_url": "https://cdn.shopify.com/s/files/1/0591/8972/3200/files/IMG_0950_720x.jpg"},
        ]
        for dp in demo_sarees:
            p_row = Product(
                business_id=bid,
                shopify_product_id=f"seed-{dp['sku']}",
                title=dp["title"],
                sku=dp["sku"],
                price=dp["price"],
                image_url=dp["image_url"],
            )
            db.add(p_row)
        db.commit()
        products = db.query(Product).order_by(Product.created_at.desc()).all()

    return {
        "success": True,
        "data": {
            "items": [_to_product_dict(p) for p in products],
            "total": len(products),
        },
    }


@router.patch("/{product_id}/stock")
def update_product_stock(
    product_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    from fastapi import HTTPException
    p = db.query(Product).filter_by(id=product_id).first()
    if p is None:
        raise HTTPException(404, "Product not found")
    new_stock = payload.get("stock_quantity")
    if new_stock is not None:
        try:
            p.stock_quantity = max(int(new_stock), 0)
            db.commit()
            db.refresh(p)
        except Exception:
            db.rollback()
            raise HTTPException(400, "Invalid stock_quantity")
    return {"success": True, "data": _to_product_dict(p)}

