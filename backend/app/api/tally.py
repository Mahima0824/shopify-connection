# backend/app/api/tally.py
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.tally_service import get_or_create_mapping, update_mapping, validate_tally_export, generate_tally_export
from app.models.tally import ExportBatch

router = APIRouter(prefix="/api/v1/tally", tags=["tally"])

class MappingIn(BaseModel):
    voucher_sales: str | None = None
    voucher_sales_return: str | None = None
    voucher_credit_note: str | None = None
    ledger_razorpay: str | None = None
    ledger_cod: str | None = None
    ledger_sales: str | None = None
    ledger_cgst: str | None = None
    ledger_sgst: str | None = None
    ledger_igst: str | None = None

@router.get("/mapping")
def get_mapping(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    m = get_or_create_mapping(db, u.get("business_id"))
    return {"success": True, "data": m}

@router.put("/mapping")
def put_mapping(body: MappingIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    m = update_mapping(db, u.get("business_id"), body.model_dump(exclude_unset=True))
    return {"success": True, "data": m}

@router.post("/validate")
def validate(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    return {"success": True, "data": validate_tally_export(db, u.get("business_id"))}

@router.post("/export")
def export(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    try:
        out = generate_tally_export(db, u.get("business_id"), u.get("user_id"))
        headers = {"Content-Disposition": f'attachment; filename="{out["batch"]["batch_reference"]}.csv"'}
        return Response(content=out["content"], media_type="text/csv", headers=headers)
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.get("/batches")
def list_batches(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    batches = db.query(ExportBatch).filter_by(business_id=u.get("business_id")).order_by(ExportBatch.created_at.desc()).all()
    return {"success": True, "data": [{"id": b.id, "batch_reference": b.batch_reference, "record_count": b.record_count,
                                       "status": b.status, "created_at": b.created_at.isoformat() if b.created_at else None} for b in batches]}
