import re

from sqlalchemy.orm import Session

LEGACY_RE = re.compile(r"^P\d{8}$")
PLAN_RE = re.compile(r"^PKG-\d{10}$")


def normalize_barcode(v: str) -> str:
    return (v or "").strip().upper()


def validate_barcode_format(v: str) -> bool:
    return bool(LEGACY_RE.match(v or "") or PLAN_RE.match(v or ""))


def sync_parcel_items(db: Session, parcel) -> None:
    from app.models.order import OrderItem
    from app.models.parcel_item import ParcelItem
    for oi in db.query(OrderItem).filter_by(order_id=parcel.order_id).all():
        ex = db.query(ParcelItem).filter_by(parcel_id=parcel.id, order_item_id=oi.id).first()
        if ex is None:
            db.add(ParcelItem(business_id=parcel.business_id, parcel_id=parcel.id,
                              order_item_id=oi.id, quantity=oi.quantity))
    db.flush()


def generate_barcode(db: Session, business_id: str) -> str:
    from app.models.parcel import Parcel
    codes = [r[0] for r in db.query(Parcel.barcode_value).filter_by(business_id=business_id).all()]
    nums = [int(c[1:]) for c in codes if c.startswith("P") and c[1:].isdigit()]
    return f"P{(max(nums, default=0) + 1):08d}"

def ensure_parcel_for_order(db: Session, order_id: str):
    from app.models.order import Order
    from app.models.parcel import Parcel
    o = db.query(Order).filter_by(id=order_id).one()
    p = db.query(Parcel).filter_by(order_id=order_id).first()
    if p is not None:
        if not getattr(p, "barcode_format", None):
            p.barcode_format = "CODE128"
        sync_parcel_items(db, p)
        db.commit(); db.refresh(p)
        return p
    code = generate_barcode(db, o.business_id)
    p = Parcel(business_id=o.business_id, order_id=o.id, parcel_code=code, barcode_value=code, barcode_format="CODE128", status="CREATED")
    db.add(p); db.flush()
    sync_parcel_items(db, p)
    db.commit(); db.refresh(p)
    return p
