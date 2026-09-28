from sqlalchemy.orm import Session

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
        return p
    code = generate_barcode(db, o.business_id)
    p = Parcel(business_id=o.business_id, order_id=o.id, parcel_code=code, barcode_value=code, status="CREATED")
    db.add(p); db.commit(); db.refresh(p)
    return p
