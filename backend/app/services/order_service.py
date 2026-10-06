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
    # The Indian business day, deliberately: India Post works IST, so a push at
    # 08:00 IST must not be numbered with the previous UTC day. The offset is
    # spelled out rather than taken from the host, because a server running in
    # UTC would otherwise renumber the same push differently.
    # Imported locally, not from the module header: this module's committed
    # datetime import belongs to unrelated in-flight work, so relying on it
    # would make this function raise NameError without it.
    from datetime import datetime, timedelta, timezone
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y%m%d")


def next_shipment_order_no(db: Session) -> str:
    """Next shipment OrderNo for the whole deployment: YYYYMMDD-NNN, restarting daily.

    Deliberately NOT scoped to a business. orders.internal_order_number carries
    a global unique constraint, so a per-business sequence handed every tenant
    the same YYYYMMDD-001 and the second push of the day died on the index with
    a raw IntegrityError. One sequence for all tenants is what the column allows.

    Non-matching and other-day values are ignored so a manual MAN- order or a
    legacy ORD- number cannot push the sequence forward.
    """
    from app.models.order import Order
    prefix = _shipment_no_today()
    rows = (db.query(Order.internal_order_number)
            .filter(Order.internal_order_number.like(f"{prefix}-%"))
            .all())
    highest = 0
    for (number,) in rows:
        tail = str(number or "")[len(prefix) + 1:]
        if len(tail) == 3 and tail.isdigit():
            highest = max(highest, int(tail))
    candidate = highest + 1
    while db.query(Order).filter_by(
            internal_order_number=f"{prefix}-{candidate:03d}").first() is not None:
        candidate += 1
    return f"{prefix}-{candidate:03d}"


# Losing this race is rare and self-healing, so the bound is a backstop against a
# pathological hot loop rather than a tuning knob.
SHIPMENT_ORDER_NO_ATTEMPTS = 5


class ShipmentOrderNoError(RuntimeError):
    """The next shipment OrderNo could not be claimed within the retry bound."""


def assign_shipment_order_no(db: Session, order, *,
                             attempts: int = SHIPMENT_ORDER_NO_ATTEMPTS) -> str:
    """Claim the next OrderNo for `order` and flush it, retrying a lost race.

    Reading the max and then writing has no lock, so two concurrent pushes can
    pick the same number. The unique index is the only real serialiser, so an
    IntegrityError here means another push won; the transaction is rolled back
    to a clean state and the max is re-read, which lands on the number the
    winner just took. After `attempts` losses the caller gets a typed error
    instead of a raw 500.

    Call this before anything else is flushed, so the rollback a lost race
    forces cannot discard a half-built parcel or shipment.
    """
    from sqlalchemy.exc import IntegrityError
    for _ in range(max(int(attempts or 1), 1)):
        candidate = next_shipment_order_no(db)
        order.internal_order_number = candidate
        try:
            db.flush()
            return candidate
        except IntegrityError:
            db.rollback()
    raise ShipmentOrderNoError(
        f"could not claim a shipment OrderNo after {attempts} attempts; "
        "another push is winning the number sequence")
