# backend/app/api/dashboard.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.dashboard_service import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

@router.get("/summary")
def dashboard_summary(
    db: Session = Depends(get_db),
    u: dict = Depends(get_current_user),
    date_from: str | None = None,
    date_to: str | None = None,
    from_val: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    cod_mode: str | None = None,
):
    s = e = None
    start_str = date_from or from_val
    end_str = date_to or to

    if start_str and start_str.strip():
        from app.services.order_service import _day_bounds
        try:
            s = _day_bounds(start_str.strip(), False)
        except Exception:
            s = None

    if end_str and end_str.strip():
        from app.services.order_service import _day_bounds
        try:
            e = _day_bounds(end_str.strip(), True)
        except Exception:
            e = None

    data = get_dashboard_summary(
        db,
        u.get("business_id"),
        start=s,
        end=e,
        cod_mode=cod_mode,
    )
    return {"success": True, "data": data}
