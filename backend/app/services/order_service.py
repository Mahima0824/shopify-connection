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


def _shipment_no_today() -> str:
    # The local business day, not UTC: an IST evening push is still "today" for
    # the warehouse that has to key off the number it is handed.
    return datetime.now().strftime("%Y%m%d")


def next_shipment_order_no(db: Session, business_id: str) -> str:
    """Next shipment OrderNo for this business: YYYYMMDD-NNN, restarting daily.

    Numbers are only unique per business, which is all PushShipment requires.
    Non-matching and other-day values are ignored so a manual MAN- order or a
    legacy ORD- number cannot push the sequence forward.
    """
    prefix = _shipment_no_today()
    rows = (db.query(Order.internal_order_number)
            .filter(Order.business_id == business_id,
                    Order.internal_order_number.like(f"{prefix}-%"))
            .all())
    highest = 0
    for (number,) in rows:
        tail = str(number or "")[len(prefix) + 1:]
        if len(tail) == 3 and tail.isdigit():
            highest = max(highest, int(tail))
    candidate = highest + 1
    while db.query(Order).filter_by(
            business_id=business_id,
            internal_order_number=f"{prefix}-{candidate:03d}").first() is not None:
        candidate += 1
    return f"{prefix}-{candidate:03d}"
