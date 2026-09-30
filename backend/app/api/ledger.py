"""Ledger routes (thin): immutable events + summaries. No PUT/PATCH/DELETE by design (#95)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.models.financial_transaction import FinancialTransaction
from app.schemas.ledger import LedgerCreate, LedgerReverse
from app.services import ledger_service as ls

router = APIRouter(prefix="/api/v1/ledger", tags=["ledger"])


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message}})


def _to_dict(r: FinancialTransaction) -> dict:
    return {
        "id": r.id, "transaction_id": r.transaction_id, "business_id": r.business_id,
        "order_id": r.order_id, "payment_id": r.payment_id, "refund_id": r.refund_id,
        "expense_id": r.expense_id, "transaction_type": r.transaction_type,
        "transaction_date": r.transaction_date.isoformat() if r.transaction_date else None,
        "transaction_date_ist": ls.to_ist_iso(r.transaction_date),
        "amount": str(r.amount), "tax_amount": str(r.tax_amount), "net_amount": str(r.net_amount),
        "currency": r.currency, "debit_account": r.debit_account, "credit_account": r.credit_account,
        "payment_method": r.payment_method, "reference_number": r.reference_number,
        "status": r.status, "tally_voucher_type": r.tally_voucher_type,
        "tally_voucher_number": r.tally_voucher_number, "reversal_of_id": r.reversal_of_id,
    }


@router.post("")
def create_event(body: LedgerCreate, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        r = ls.record_event(db, u.get("business_id"), **body.model_dump())
        db.commit()
        db.refresh(r)
    except ValueError as e:
        db.rollback()
        return _err(400, "BAD_REQUEST", str(e))
    except IntegrityError as e:
        db.rollback()
        return _err(409, "CONFLICT", f"Transaction conflict: {e.orig}"[:300])
    return {"success": True, "data": _to_dict(r)}


@router.get("")
def list_events(from_val: str | None = Query(default=None, alias="from"),
                to: str | None = None, type: str | None = None,
                order_id: str | None = None, db: Session = Depends(get_db),
                u: dict = Depends(get_current_user)):
    q = db.query(FinancialTransaction).filter_by(business_id=u.get("business_id"))
    try:
        if from_val:
            q = q.filter(FinancialTransaction.transaction_date >= ls._utc(datetime.fromisoformat(from_val)))
        if to:
            q = q.filter(FinancialTransaction.transaction_date < ls._utc(datetime.fromisoformat(to)))
    except ValueError:
        return _err(400, "BAD_REQUEST", "from/to must be ISO datetimes")
    if type:
        q = q.filter(FinancialTransaction.transaction_type == type.upper())
    if order_id:
        q = q.filter(FinancialTransaction.order_id == order_id)
    rows = q.order_by(FinancialTransaction.transaction_date.desc()).limit(500).all()
    return {"success": True, "data": {"items": [_to_dict(r) for r in rows], "total": len(rows)}}


@router.get("/summary")
def summary(from_val: str = Query(alias="from"), to: str = Query(),
            db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    try:
        s, e = ls._utc(datetime.fromisoformat(from_val)), ls._utc(datetime.fromisoformat(to))
    except ValueError:
        return _err(400, "BAD_REQUEST", "from/to must be ISO datetimes")
    return {"success": True, "data": ls.period_summary(db, u.get("business_id"), s, e)}


@router.get("/fy")
def fy_summary(date: str | None = None, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    try:
        d = ls._utc(datetime.fromisoformat(date)) if date else datetime.now(timezone.utc)
    except ValueError:
        return _err(400, "BAD_REQUEST", "date must be ISO datetime")
    s, e = ls.fy_bounds(d)
    out = ls.period_summary(db, u.get("business_id"), s, e)
    out["fy"] = {"start": s.isoformat(), "end": e.isoformat()}
    return {"success": True, "data": out}


@router.get("/order/{order_id}")
def order_ledger(order_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    return {"success": True, "data": {"items": ls.order_timeline(db, u.get("business_id"), order_id)}}


@router.post("/backfill")
def backfill(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """Admin backfill: ledger events for pre-existing orders/payments/refunds (Task 1 owed)."""
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    from app.services import report_service as rs
    from app.services.audit_service import log_audit
    out = rs.backfill_ledger(db, u.get("business_id"))
    try:
        log_audit(db, u.get("business_id"), u.get("user_id"), "ledger", "-",
                  "LEDGER_BACKFILL", None, out)
        db.commit()
    except Exception:
        db.rollback()
    return {"success": True, "data": out}


@router.post("/reverse")
def reverse(body: LedgerReverse, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    try:
        r = ls.reverse_event(db, u.get("business_id"), body.transaction_id, body.reason)
        db.commit()
        db.refresh(r)
    except ValueError as e:
        db.rollback()
        if "not found" in str(e).lower():
            return _err(404, "NOT_FOUND", str(e))
        return _err(400, "BAD_REQUEST", str(e))
    except IntegrityError as e:
        db.rollback()
        return _err(409, "CONFLICT", f"Transaction conflict: {e.orig}"[:300])
    return {"success": True, "data": _to_dict(r)}
