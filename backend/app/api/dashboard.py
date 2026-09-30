# backend/app/api/dashboard.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.dashboard_service import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db), u: dict = Depends(get_current_user),
                      preset: str | None = None,
                      from_val: str | None = Query(default=None, alias="from"),
                      to: str | None = None):
    s = e = None
    if preset or (from_val and to):
        from app.services import report_service as rs
        from app.services import accounting_service as acct
        try:
            s, e = rs.resolve_range(preset, from_val, to,
                                    fy_start_month=acct._fy_start_month(db, u.get("business_id")))
        except ValueError as err:
            raise HTTPException(400, str(err))
    data = get_dashboard_summary(db, u.get("business_id"), s, e)
    return {"success": True, "data": data}
