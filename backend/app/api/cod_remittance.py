from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.services import cod_remittance_service

router = APIRouter(prefix="/api/v1/cod-remittance", tags=["cod-remittance"])


class CodDiscrepancyResolveRequest(BaseModel):
    order_id: str
    action: str  # 'ACCEPT_SHORT', 'DISPUTE_COURIER', 'FORCE_MATCH'
    write_off_amount: float = 0.0
    notes: Optional[str] = None


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Get aggregate COD remittance performance KPIs & discrepancy stats."""
    biz_id = current_user.get("business_id")
    data = cod_remittance_service.get_cod_remittance_summary(db, biz_id)
    return {"success": True, "data": data}


@router.get("/orders")
def list_orders(
    q: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    carrier: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Retrieve filterable COD orders with remittance status, UTR numbers & difference amounts."""
    biz_id = current_user.get("business_id")
    data = cod_remittance_service.list_cod_remittance_orders(
        db=db,
        business_id=biz_id,
        q=q,
        status_filter=status,
        carrier_filter=carrier,
        page=page,
        page_size=page_size
    )
    return {"success": True, "data": data}


@router.post("/upload")
def upload_remittance_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Upload courier COD remittance report (CSV/XLSX) for automated 4-Level matching & auto-posting."""
    biz_id = current_user.get("business_id")
    user_id = current_user.get("user_id")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    content = file.file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (15MB maximum)")

    try:
        result = cod_remittance_service.process_cod_remittance_file(
            db=db,
            business_id=biz_id,
            user_id=user_id,
            content=content,
            filename=file.filename
        )
        return {"success": True, "message": "COD remittance report processed and matched successfully", "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/resolve")
def resolve_discrepancy(
    payload: CodDiscrepancyResolveRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Resolve a short remittance or discrepancy for a specific COD order."""
    biz_id = current_user.get("business_id")
    user_id = current_user.get("user_id")

    result = cod_remittance_service.resolve_cod_discrepancy(
        db=db,
        business_id=biz_id,
        user_id=user_id,
        order_id=payload.order_id,
        action=payload.action,
        write_off_amount=payload.write_off_amount,
        notes=payload.notes
    )

    return result
