# backend/app/api/dashboard.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.dashboard_service import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    data = get_dashboard_summary(db, u.get("business_id"))
    return {"success": True, "data": data}
