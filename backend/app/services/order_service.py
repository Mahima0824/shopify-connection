"""Order query service. Route handlers stay thin."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.order import Order


def create_manual_order(db: Session, business_id: str, payload) -> Order:
    """Create a manual order. payload is OrderCreateManual."""
    from app.models.order import OrderItem
    data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
    hex8 = uuid.uuid4().hex[:8].upper()
    cod_mode = str(data.get("cod_mode") or "COD").upper()

    # Calculate total amount
    line_items = data.get("line_items") or []
    if line_items:
        computed_total = sum(float(it.get("price", 0) or 0) * int(it.get("quantity", 1) or 1) for it in line_items)
    else:
        computed_total = 0.0
    total_amt = float(data.get("total_amount") or computed_total or data.get("cod_value") or 0.0)

    # Business Rule: For COD orders, customer pays ₹300 advance online.
    # The remaining balance + ₹50 COD charge is collectable on delivery.
    if cod_mode == "COD":
        if total_amt > 0:
            advance = 300.0
            remaining = max(0.0, total_amt - advance)
            cod_val = round(remaining + 50.0, 2)
        else:
            cod_val = float(data.get("cod_value") or 50.0)
    else:
        cod_val = 0.0

    o = Order(
        business_id=business_id,
        internal_order_number=f"MAN-{hex8}",
        shopify_order_id=f"MANUAL-{hex8}",
        shopify_order_name=f"MAN-{hex8}",
        order_date=datetime.now(timezone.utc),
        total_amount=total_amt,
        financial_status="PENDING" if cod_mode == "COD" else "PAID",
        operational_status="NEW",
        cod_mode=cod_mode,
        cod_value=cod_val,
        dropoff_pincode=data.get("receiver_pincode"),
    )
    for key in (
        "receiver_name",
        "receiver_mobile",
        "receiver_email",
        "receiver_add1",
        "receiver_add2",
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
        "barcode_no",
    ):
        if key in data and data[key] is not None:
            setattr(o, key, data[key])
    db.add(o)
    db.flush()

    # Save attached saree items
    for it in line_items:
        it_obj = OrderItem(
            business_id=business_id,
            order_id=o.id,
            title=str(it.get("title") or "Saree"),
            sku=str(it.get("sku") or "") if it.get("sku") else None,
            price=float(it.get("price") or 0.0),
            quantity=int(it.get("quantity") or 1),
            image_url=it.get("image_url"),
        )
        db.add(it_obj)

    db.commit()
    db.refresh(o)
    return o


def _day_bounds(v: str, is_end: bool) -> datetime:
    ist = timezone(timedelta(hours=5, minutes=30))
    if len(v) == 10:
        dt = datetime.fromisoformat(v)
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=ist)
        else:
            dt = dt.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=ist)
        return dt.astimezone(timezone.utc)
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
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
    carrier: str | None = None,
) -> tuple[list[Order], int]:
    """Return (items, total) with optional search/status filters and pagination."""
    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 20), 1), 100)
    q = db.query(Order)
    if business_id:
        q = q.filter(Order.business_id == business_id)
    if status:
        q = q.filter(Order.operational_status == status.upper())
    if carrier:
        from app.models.shipment import Shipment
        c_code = carrier.upper().replace("-", "_")
        if c_code in ("INDIA_POST", "IP"):
            matched_shipments = db.query(Shipment.order_id).filter(Shipment.carrier_code.in_(("INDIA_POST", "IP"))).subquery()
        else:
            matched_shipments = db.query(Shipment.order_id).filter(Shipment.carrier_code.ilike(f"%{c_code}%")).subquery()
        q = q.filter(Order.id.in_(db.query(matched_shipments.c.order_id)))
    if search:
        term = search.strip()
        like = f"%{term}%"
        from app.models.shipment import Shipment
        from app.models.order import OrderItem
        from sqlalchemy import or_

        shipment_order_ids = (
            db.query(Shipment.order_id)
            .filter(
                (Shipment.id.ilike(like))
                | (Shipment.awb_number.ilike(like))
                | (Shipment.shipsagar_tracking_id.ilike(like))
            )
            .subquery()
        )

        item_order_ids = (
            db.query(OrderItem.order_id)
            .filter(
                (OrderItem.title.ilike(like))
                | (OrderItem.sku.ilike(like))
            )
            .subquery()
        )

        q = q.filter(
            or_(
                Order.shopify_order_name.ilike(like),
                Order.shopify_order_id.ilike(like),
                Order.internal_order_number.ilike(like),
                Order.receiver_name.ilike(like),
                Order.receiver_mobile.ilike(like),
                Order.receiver_email.ilike(like),
                Order.barcode_no.ilike(like),
                Order.bulk_reference.ilike(like),
                Order.id.in_(db.query(shipment_order_ids.c.order_id)),
                Order.id.in_(db.query(item_order_ids.c.order_id)),
            )
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


def check_order_stock(db: Session, business_id: str, order_id: str) -> dict:
    """Verify inventory availability for all items in an order."""
    from app.models.order import OrderItem
    from app.models.product import Product

    items = db.query(OrderItem).filter_by(order_id=order_id).all()
    if not items and business_id:
        items = db.query(OrderItem).filter_by(business_id=business_id, order_id=order_id).all()

    stock_details = []
    all_available = True
    has_low_stock = False

    for item in items:
        qty_needed = item.quantity or 1
        product = None
        if item.product_id:
            product = db.get(Product, item.product_id)
        if product is None and item.sku:
            product = db.query(Product).filter_by(business_id=business_id, sku=item.sku).first()
        if product is None and item.title:
            product = db.query(Product).filter_by(business_id=business_id, title=item.title).first()

        avail_stock = getattr(product, "stock_quantity", 50) if product else 50
        if avail_stock is None:
            avail_stock = 50

        is_avail = avail_stock >= qty_needed
        if not is_avail:
            all_available = False
        if avail_stock < 5:
            has_low_stock = True

        stock_details.append({
            "item_id": item.id,
            "title": item.title,
            "sku": item.sku,
            "quantity_required": qty_needed,
            "stock_available": avail_stock,
            "is_in_stock": is_avail,
            "product_id": product.id if product else None,
        })

    if not all_available:
        status = "OUT_OF_STOCK"
    elif has_low_stock:
        status = "LOW_STOCK"
    else:
        status = "IN_STOCK"

    return {
        "stock_available": all_available,
        "stock_status": status,
        "items": stock_details,
    }


def deduct_order_stock(db: Session, business_id: str, order_id: str) -> bool:
    """Deduct item stock quantities when a shipment is assigned to an order."""
    from app.models.order import OrderItem
    from app.models.product import Product

    items = db.query(OrderItem).filter_by(order_id=order_id).all()
    for item in items:
        qty_needed = item.quantity or 1
        product = None
        if item.product_id:
            product = db.get(Product, item.product_id)
        if product is None and item.sku:
            product = db.query(Product).filter_by(business_id=business_id, sku=item.sku).first()

        if product:
            current_stock = getattr(product, "stock_quantity", 50) or 50
            product.stock_quantity = max(current_stock - qty_needed, 0)
    db.flush()
    return True

