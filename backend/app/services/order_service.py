"""Order query service. Route handlers stay thin."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.order import Order


def list_orders(
    db: Session,
    business_id: str | None = None,
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Order], int]:
    """Return (items, total) with optional search/status filters and pagination."""
    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 20), 1), 100)
    q = db.query(Order)
    if business_id:
        q = q.filter(Order.business_id == business_id)
    if status:
        q = q.filter(Order.operational_status == status.upper())
    if search:
        # Barcode lookup stub: exact match path added in Sprint 2; for now
        # match order name / shopify id.
        like = f"%{search}%"
        q = q.filter(
            (Order.shopify_order_name.ilike(like))
            | (Order.shopify_order_id.ilike(like))
            | (Order.internal_order_number.ilike(like))
        )
    total = q.count()
    items = (
        q.order_by(Order.order_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total
