from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/parcels", tags=["parcels"])


@router.get("/{parcel_id}/barcode.png")
def barcode_png(parcel_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    import io
    import barcode
    from barcode.writer import ImageWriter
    from app.models.parcel import Parcel
    p = db.query(Parcel).filter_by(id=parcel_id, business_id=u.get("business_id")).first()
    if p is None:
        p = db.query(Parcel).filter_by(barcode_value=parcel_id, business_id=u.get("business_id")).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    buf = io.BytesIO()
    barcode.Code128(p.barcode_value, writer=ImageWriter()).write(buf)
    return Response(content=buf.getvalue(), media_type="image/png",
                    headers={"Content-Disposition": f'attachment; filename="{p.barcode_value}.png"'})

def _pdict(p) -> dict:
    return {"id": p.id, "business_id": p.business_id, "order_id": p.order_id,
            "parcel_code": p.parcel_code, "barcode_value": p.barcode_value, "status": p.status}

@router.post("/backfill")
def backfill(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.services.barcode_service import ensure_parcel_for_order
    bid = u.get("business_id")
    n = 0
    for o in db.query(Order).filter_by(business_id=bid).all():
        if db.query(Parcel).filter_by(order_id=o.id).first() is None:
            ensure_parcel_for_order(db, o.id); n += 1
    return {"success": True, "data": {"created": n}}

@router.get("/{barcode}")
def lookup(barcode: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.parcel import Parcel
    from app.models.order import Order, OrderItem
    bid = u.get("business_id")
    p = db.query(Parcel).filter_by(business_id=bid, barcode_value=barcode).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    o = db.query(Order).filter_by(id=p.order_id).first()
    items = db.query(OrderItem).filter_by(order_id=o.id).all() if o else []
    cust = None
    if o is not None and o.customer_id:
        from app.models.customer import Customer
        c = db.query(Customer).filter_by(id=o.customer_id).first()
        if c is not None:
            cname = f"{c.first_name or ''} {c.last_name or ''}".strip() or None
            cust = {"name": cname, "email": c.email, "phone": c.phone}
    return {"success": True, "data": {"parcel": _pdict(p),
        "order": {"id": o.id, "shopify_order_name": o.shopify_order_name, "total_amount": float(o.total_amount or 0),
                  "financial_status": o.financial_status, "operational_status": o.operational_status} if o else None,
        "customer": cust, "item_count": len(items)}}

@router.get("/{parcel_id}/label", response_class=HTMLResponse)
def label(parcel_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    import barcode
    from barcode.writer import SVGWriter
    from io import BytesIO
    from app.models.parcel import Parcel
    from app.models.order import Order
    bid = u.get("business_id")
    p = db.query(Parcel).filter_by(business_id=bid, id=parcel_id).first()
    if p is None:
        p = db.query(Parcel).filter_by(business_id=bid, barcode_value=parcel_id).first()
    if p is None:
        raise HTTPException(404, "Parcel not found")
    o = db.query(Order).filter_by(id=p.order_id).first()
    buf = BytesIO()
    barcode.Code128(p.barcode_value, writer=SVGWriter()).write(buf)
    svg = buf.getvalue().decode("utf-8")
    oname = o.shopify_order_name if o else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Label {p.barcode_value}</title>
<style>@media print {{ .label {{ page-break-inside: avoid; }} }} body {{ font-family: sans-serif; }} .label {{ border: 2px solid #000; padding: 16px; max-width: 380px; }} svg {{ width: 100%; height: auto; }}</style>
</head><body><div class="label"><h2>Recon Parcel</h2><p>Order: {oname}</p><p>Parcel: {p.parcel_code}</p>{svg}<p>{p.barcode_value}</p></div>
<script>window.print && null;</script></body></html>"""
