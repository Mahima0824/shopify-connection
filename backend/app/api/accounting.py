"""Accounting controls API (#76/#77): month close/reopen + FY helper. Envelope errors; `from` alias."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.services import accounting_service as acct
from app.services.rbac import ACCOUNTING_ROLES

router = APIRouter(prefix="/api/v1/accounting", tags=["accounting"])


def _err(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message, **extra}})


def _ctx(request: Request) -> dict:
    return {"ip": (request.client.host if request.client else None),
            "user_agent": request.headers.get("user-agent")}


class MonthIn(BaseModel):
    year: int
    month: int


class FyIn(BaseModel):
    fy_start_month: int


@router.get("/periods")
def list_periods(year: int | None = None, db: Session = Depends(get_db),
                 u: dict = Depends(get_current_user)):
    from app.models.accounting_period import AccountingPeriod
    q = db.query(AccountingPeriod).filter_by(business_id=u.get("business_id"))
    if year is not None:
        q = q.filter_by(year=int(year))
    rows = q.order_by(AccountingPeriod.year.desc(), AccountingPeriod.month.desc()).limit(60).all()
    return {"success": True, "data": {"items": [
        {"id": p.id, "year": p.year, "month": p.month, "status": p.status,
         "closed_at": p.closed_at.isoformat() if p.closed_at else None,
         "issue_count": p.issue_count} for p in rows]}}


@router.get("/periods/{year}/{month}")
def period_detail(year: int, month: int, db: Session = Depends(get_db),
                  u: dict = Depends(get_current_user)):
    checks = acct.close_checks(db, u.get("business_id"), year, month)
    return {"success": True, "data": {"status": acct.period_status(
        db, u.get("business_id"), year, month), "issues": checks}}


@router.post("/periods/{year}/{month}/close")
def close(year: int, month: int, request: Request, db: Session = Depends(get_db),
          u: dict = Depends(get_current_user)):
    if u.get("role") not in ACCOUNTING_ROLES:
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        out = acct.close_month(db, u.get("business_id"), year, month, u.get("user_id"),
                               **_ctx(request))
    except acct.CloseBlocked as e:
        return _err(422, "CLOSE_BLOCKED", str(e), issues=e.issues)
    return {"success": True, "data": out}


@router.post("/periods/{year}/{month}/reopen")
def reopen(year: int, month: int, request: Request, db: Session = Depends(get_db),
           u: dict = Depends(get_current_user)):
    if u.get("role") not in ACCOUNTING_ROLES:
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        out = acct.reopen_month(db, u.get("business_id"), year, month, u.get("user_id"),
                                **_ctx(request))
    except ValueError as e:
        return _err(400, "BAD_REQUEST", str(e))
    return {"success": True, "data": out}


@router.get("/fy")
def fy(date: str | None = None, db: Session = Depends(get_db),
       u: dict = Depends(get_current_user)):
    try:
        d = acct._utc(datetime.fromisoformat(date)) if date else datetime.now(acct._utc(None).tzinfo)
    except ValueError:
        return _err(400, "BAD_REQUEST", "date must be ISO datetime")
    s, e, meta = acct.fy_bounds_for(db, u.get("business_id"), d)
    return {"success": True, "data": {**meta, "start": s.isoformat(), "end": e.isoformat()}}


@router.put("/fy")
def put_fy(body: FyIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if (u.get("role") or "") != "ADMIN":
        return _err(403, "FORBIDDEN", "Admin role required")
    if not 1 <= int(body.fy_start_month) <= 12:
        return _err(400, "BAD_REQUEST", "fy_start_month must be 1..12")
    from app.models.business import Business
    from app.services.audit_service import log_audit
    b = db.query(Business).filter_by(id=u.get("business_id")).first()
    old = {"fy_start_month": getattr(b, "fy_start_month", 4)}
    b.fy_start_month = int(body.fy_start_month)
    log_audit(db, u.get("business_id"), u.get("user_id"), "business", b.id,
              "FY_CONFIG_CHANGED", old, {"fy_start_month": b.fy_start_month})
    db.commit()
    return {"success": True, "data": {"fy_start_month": b.fy_start_month}}


@router.get("/month")
def month_summary(from_val: str = Query(alias="from"), db: Session = Depends(get_db),
                  u: dict = Depends(get_current_user)):
    """Month summary honoring `from` alias contract (#56): /month?from=YYYY-MM."""
    try:
        y, m = from_val.split("-")[:2]
        return period_detail(int(y), int(m), db, u)
    except (ValueError, AttributeError):
        return _err(400, "BAD_REQUEST", "from must be YYYY-MM")
