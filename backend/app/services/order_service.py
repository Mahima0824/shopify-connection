"""Order query service. Route handlers stay thin."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.order import Order


def create_manual_order(db: Session, business_id: str, payload) -> Order:
    """Create a manual (India Post) order. payload is OrderCreateManual."""
    data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
    hex8 = uuid.uuid4().hex[:8].upper()
    cod_mode = str(data.get("cod_mode") or "COD").upper()
    cod_value = data.get("cod_value")
    o = Order(
        business_id=business_id,
        internal_order_number=f"MAN-{hex8}",
        shopify_order_id=f"MANUAL-{hex8}",
        order_date=datetime.now(timezone.utc),
        total_amount=cod_value or 0,
        financial_status="PENDING" if cod_mode == "COD" else "PAID",
        operational_status="NEW",
        cod_mode=cod_mode,
        dropoff_pincode=data.get("receiver_pincode"),
    )
    for key in (
        "receiver_name",
        "receiver_mobile",
        "receiver_add1",
        "receiver_city",
        "receiver_state",
        "receiver_pincode",
        "sender_name",
        "sender_add1",
        "sender_city",
        "sender_state",
        "sender_pincode",
        "sender_mobile",
        "weight_grams",
        "length_cm",
        "breadth_cm",
        "height_cm",
        "shape",
        "cod_value",
        "barcode_no",
    ):
        if key in data:
            setattr(o, key, data[key])
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def _day_bounds(v: str, is_end: bool) -> datetime:
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if len(v) == 10:
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        else:
            dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt


def list_orders(
    db: Session,
    business_id: str | None = None,
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    cod_mode: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    city: str | None = None,
    pincode: str | None = None,
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
    if cod_mode and cod_mode.upper() in ("COD", "PREPAID"):
        q = q.filter(Order.cod_mode == cod_mode.upper())
    if city:
        q = q.filter(Order.receiver_city.ilike(f"%{city}%"))
    if pincode:
        q = q.filter(Order.receiver_pincode == pincode)
    if date_from:
        q = q.filter(Order.order_date >= _day_bounds(date_from, False))
    if date_to:
        q = q.filter(Order.order_date <= _day_bounds(date_to, True))
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
