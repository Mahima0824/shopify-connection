# backend/app/api/tally.py
"""Tally routes: mapping + validation gate + workbook export + batch lifecycle."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.tally_service import (
    get_or_create_mapping, update_mapping, validate_tally_export, generate_tally_export,
    validate_export, generate_workbook_export, mark_downloaded, mark_imported,
    ledger_mapping_completeness, TallyError,
)
from app.models.tally import ExportBatch

router = APIRouter(prefix="/api/v1/tally", tags=["tally"])


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message}})


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


class ImportIn(BaseModel):
    imported: bool = True
    partial: bool = False
    failed: bool = False


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


@router.get("/mapping/completeness")
def mapping_completeness(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    return {"success": True, "data": ledger_mapping_completeness(db, u.get("business_id"))}


@router.post("/validate")
def validate(db: Session = Depends(get_db), u: dict = Depends(get_current_user),
             from_val: str | None = Query(default=None, alias="from"),
             to: str | None = Query(default=None)):
    try:
        return {"success": True, "data": validate_export(
            db, u.get("business_id"), from_val, to)}
    except TallyError as e:
        return _err(400, e.code, str(e))


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


@router.post("/export-workbook")
def export_workbook(db: Session = Depends(get_db), u: dict = Depends(get_current_user),
                    from_val: str | None = Query(default=None, alias="from"),
                    to: str | None = Query(default=None)):
    """Validate -> transform -> generate -> preview-ready .xlsx (#46)."""
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        out = generate_workbook_export(db, u.get("business_id"), u.get("user_id"),
                                       from_val, to)
    except TallyError as e:
        status = {"VALIDATION_FAILED": 422, "DUPLICATE_EXPORT": 409,
                  "NOTHING_TO_EXPORT": 404, "NOT_FOUND": 404}.get(e.code, 400)
        return _err(status, e.code, str(e))
    headers = {"Content-Disposition": f'attachment; filename="{out["file_name"]}"'}
    return Response(
        content=out["content"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers)


@router.get("/batches")
def list_batches(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    batches = db.query(ExportBatch).filter_by(business_id=u.get("business_id")).order_by(ExportBatch.created_at.desc()).all()
    return {"success": True, "data": [{"id": b.id, "batch_reference": b.batch_reference, "record_count": b.record_count,
                                       "status": b.status, "created_at": b.created_at.isoformat() if b.created_at else None,
                                       "file_name": getattr(b, "file_name", None),
                                       "transaction_count": getattr(b, "transaction_count", None)} for b in batches]}


@router.get("/exports")
def list_exports(from_val: str | None = Query(default=None, alias="from"),
                 to: str | None = Query(default=None),
                 db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.services import ledger_service as ls
    q = db.query(ExportBatch).filter_by(business_id=u.get("business_id"))
    try:
        if from_val:
            q = q.filter(ExportBatch.created_at >= ls._utc(datetime.fromisoformat(from_val)))
        if to:
            q = q.filter(ExportBatch.created_at < ls._utc(datetime.fromisoformat(to)))
    except ValueError:
        return _err(400, "BAD_REQUEST", "from/to must be ISO datetimes")
    batches = q.order_by(ExportBatch.created_at.desc()).all()
    return {"success": True, "data": {"items": [
        {"id": b.id, "batch_reference": b.batch_reference,
         "record_count": b.record_count, "status": b.status,
         "file_name": getattr(b, "file_name", None),
         "created_at": b.created_at.isoformat() if b.created_at else None}
        for b in batches]}}


@router.get("/exports/{bid}")
def get_export(bid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    b = db.query(ExportBatch).filter_by(id=bid, business_id=u.get("business_id")).first()
    if b is None:
        return _err(404, "NOT_FOUND", "Export batch not found.")
    return {"success": True, "data": {"id": b.id, "batch_reference": b.batch_reference,
                                      "record_count": b.record_count, "status": b.status,
                                      "file_name": getattr(b, "file_name", None),
                                      "created_at": b.created_at.isoformat() if b.created_at else None}}


@router.post("/exports/{bid}/downloaded")
def downloaded(bid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    try:
        return {"success": True, "data": mark_downloaded(db, u.get("business_id"), bid)}
    except TallyError as e:
        return _err(404, e.code, str(e))


@router.post("/exports/{bid}/mark-imported")
def mark_imported_ep(bid: str, body: ImportIn,
                     db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        return {"success": True, "data": mark_imported(
            db, u.get("business_id"), bid, imported=body.imported,
            partial=body.partial, failed=body.failed)}
    except TallyError as e:
        return _err(404, e.code, str(e))
