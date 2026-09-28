# backend/app/services/tally_service.py
import io
import csv
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.tally import TallyMapping, ExportBatch
from app.models.order import Order

def get_or_create_mapping(db: Session, business_id: str) -> TallyMapping:
    m = db.query(TallyMapping).filter_by(business_id=business_id).first()
    if not m:
        m = TallyMapping(business_id=business_id)
        db.add(m)
        db.commit()
        db.refresh(m)
    return m

def update_mapping(db: Session, business_id: str, data: dict) -> TallyMapping:
    m = get_or_create_mapping(db, business_id)
    for k, v in data.items():
        if hasattr(m, k) and v is not None:
            setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m

def validate_tally_export(db: Session, business_id: str) -> dict:
    m = get_or_create_mapping(db, business_id)
    errors = []
    if not m.ledger_sales:
        errors.append("Sales ledger mapping is required.")
    
    orders_count = db.query(Order).filter_by(business_id=business_id).count()
    return {"valid": len(errors) == 0, "errors": errors, "order_count": orders_count}

def generate_tally_export(db: Session, business_id: str, user_id: str) -> dict:
    val = validate_tally_export(db, business_id)
    if not val["valid"]:
        raise ValueError("; ".join(val["errors"]))
        
    m = get_or_create_mapping(db, business_id)
    orders = db.query(Order).filter_by(business_id=business_id).all()
    
    ref = f"TALLY-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{int(datetime.now(timezone.utc).timestamp()) % 10000:04d}"
    batch = ExportBatch(business_id=business_id, batch_reference=ref, record_count=len(orders), generated_by=user_id)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Voucher Ref", "Date", "Voucher Type", "Party / Ledger", "Debit / Credit", "Amount", "Narration"])
    
    for o in orders:
        dt_str = o.created_at.strftime("%Y-%m-%d") if o.created_at else ""
        writer.writerow([o.shopify_order_name, dt_str, m.voucher_sales, m.ledger_sales, "Credit", o.total_amount, f"Order {o.shopify_order_name}"])
        
    return {
        "batch": {
            "id": batch.id,
            "batch_reference": batch.batch_reference,
            "record_count": batch.record_count,
            "status": batch.status,
            "created_at": batch.created_at.isoformat() if batch.created_at else None
        },
        "content": output.getvalue().encode("utf-8")
    }
