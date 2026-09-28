# backend/app/api/export.py
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.export_service import generate_excel_workbook

router = APIRouter(prefix="/api/v1/export", tags=["export"])

@router.get("/excel")
def export_excel(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    content = generate_excel_workbook(db, u.get("business_id"))
    headers = {"Content-Disposition": 'attachment; filename="recon_export.csv"'}
    return Response(content=content, media_type="text/csv", headers=headers)
