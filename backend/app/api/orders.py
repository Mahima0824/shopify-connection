"""Orders routes (thin): envelope responses only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.services.order_service import list_orders

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def _to_dict(o) -> dict:
    def num(v):
        try:
            return float(v) if v is not None else 0.0
        except Exception:
            return 0.0

    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {
        "id": o.id,
        "business_id": o.business_id,
        "internal_order_number": o.internal_order_number,
        "shopify_order_id": o.shopify_order_id,
        "shopify_order_name": o.shopify_order_name,
        "customer_id": o.customer_id,
        "order_date": iso(o.order_date),
        "currency": o.currency,
        "subtotal_amount": num(o.subtotal_amount),
        "discount_amount": num(o.discount_amount),
        "shipping_amount": num(o.shipping_amount),
        "tax_amount": num(o.tax_amount),
        "total_amount": num(o.total_amount),
        "payment_status": o.payment_status,
        "financial_status": o.financial_status,
        "fulfillment_status": o.fulfillment_status,
        "operational_status": o.operational_status,
        "shopify_created_at": iso(o.shopify_created_at),
        "shopify_updated_at": iso(o.shopify_updated_at),
    }


@router.get("")
def get_orders(
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    business_id: str | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    items, total = list_orders(db, business_id, search, status, page, page_size)
    return {
        "success": True,
        "data": {"items": [_to_dict(o) for o in items], "total": total, "page": max(int(page or 1), 1)},
    }


@router.get("/{order_id}/timeline")
def get_timeline(order_id: str, db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    from app.services.timeline_service import build_timeline
    return {"success": True, "data": {"items": build_timeline(db, _u.get("business_id"), order_id)}}


@router.get("/{order_id}")
def get_order(
    order_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    from app.models.order import Order

    o = db.query(Order).filter_by(id=order_id).first()
    if o is None:
        raise HTTPException(404, "Order not found")
    return {"success": True, "data": _to_dict(o)}
