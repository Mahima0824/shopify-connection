# backend/app/api/reconciliation.py
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/reconciliation", tags=["reconciliation"])


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message}})

def _j(r, order_name=None) -> dict:
    return {"id": r.id, "order_id": r.order_id, "order_name": order_name,
            "issue_code": r.issue_code, "severity": r.severity, "issue_message": r.issue_message,
            "resolved": r.resolved,
            "detected_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None}

@router.get("/issues")
def issues(status: str = "OPEN", severity: str | None = None, issue_code: str | None = None,
           category: str | None = None,
           page: int = 1, page_size: int = 20,
           db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.reconciliation import Reconciliation
    from app.models.order import Order
    from app.services.reconciliation_service import CATEGORY
    q = db.query(Reconciliation).filter_by(business_id=u.get("business_id"))
    if status == "OPEN": q = q.filter_by(resolved=False)
    elif status == "RESOLVED": q = q.filter_by(resolved=True)
    if severity: q = q.filter_by(severity=severity)
    if issue_code: q = q.filter_by(issue_code=issue_code)
    if category and category.lower() in CATEGORY:
        q = q.filter(Reconciliation.issue_code.in_(CATEGORY[category.lower()]))
    total = q.count()
    rows = q.order_by(Reconciliation.created_at.desc()).offset(
        (max(int(page or 1), 1) - 1) * int(page_size or 20)).limit(int(page_size or 20)).all()
    onames = {o.id: o.shopify_order_name for o in db.query(Order).filter(
        Order.id.in_([r.order_id for r in rows])).all()} if rows else {}
    return {"success": True, "data": {"items": [_j(r, onames.get(r.order_id)) for r in rows],
                                      "total": total, "page": max(int(page or 1), 1)}}

@router.post("/order/{order_id}")
def run_one(order_id: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.reconciliation_service import reconcile_order
    from app.models.order import Order
    if db.query(Order).filter_by(id=order_id, business_id=u.get("business_id")).first() is None:
        raise HTTPException(404, "Order not found")
    return {"success": True, "data": reconcile_order(db, order_id)}

@router.post("/run")
def run_all(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    from app.models.order import Order
    from app.services.reconciliation_service import reconcile_order
    rec = exc = 0
    for o in db.query(Order).filter_by(business_id=u.get("business_id")).all():
        out = reconcile_order(db, o.id)
        if out["status"] == "RECONCILED": rec += 1
        else: exc += 1
    return {"success": True, "data": {"reconciled": rec, "exceptions": exc}}

class ResolveIn(BaseModel):
    reason: str


@router.post("/issues/{issue_id}/resolve")
def resolve(issue_id: str, body: ResolveIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.reconciliation import Reconciliation
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    if not (body.reason or "").strip():
        raise HTTPException(400, "Reason is required")
    r = db.query(Reconciliation).filter_by(id=issue_id, business_id=u.get("business_id")).first()
    if r is None:
        raise HTTPException(404, "Issue not found")
    if r.resolved:
        raise HTTPException(400, "Issue already resolved")
    r.resolved = True; r.resolved_by = u.get("user_id"); r.resolved_at = datetime.now(timezone.utc)
    log_audit(db, r.business_id, u.get("user_id"), "reconciliation", r.id, "EXCEPTION_RESOLVED",
              {"resolved": False}, {"resolved": True, "reason": body.reason.strip()})
    db.commit()
    return {"success": True, "data": {"id": r.id, "resolved": True}}


def _bank_rows(db: Session, business_id: str, from_val: str | None, to: str | None,
               bank_account_id: str | None):
    from datetime import datetime
    from app.models.statement import StatementRow, StatementUpload
    from app.services import ledger_service as ls
    q = db.query(StatementRow).join(
        StatementUpload, StatementUpload.id == StatementRow.statement_upload_id).filter(
        StatementUpload.business_id == business_id,
        StatementUpload.statement_type == "BANK_STATEMENT")
    try:
        if from_val:
            q = q.filter(StatementRow.transaction_date >= ls._utc(datetime.fromisoformat(from_val)))
        if to:
            q = q.filter(StatementRow.transaction_date < ls._utc(datetime.fromisoformat(to)))
    except ValueError:
        return None
    if bank_account_id:
        q = q.filter(StatementRow.bank_account_id == bank_account_id)
    return q.order_by(StatementRow.transaction_date.desc()).all()


@router.get("/bank-summary")
def bank_summary(from_val: str | None = Query(default=None, alias="from"),
                 to: str | None = None, bank_account_id: str | None = None,
                 db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.bank_recon_service import summarize
    rows = _bank_rows(db, u.get("business_id"), from_val, to, bank_account_id)
    if rows is None:
        return _err(400, "BAD_REQUEST", "from/to must be ISO datetimes")
    return {"success": True, "data": summarize(rows)}


@router.get("/bank-mismatches")
def bank_mismatches(from_val: str | None = Query(default=None, alias="from"),
                     to: str | None = None, bank_account_id: str | None = None,
                     db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.sla import ShipmentFinancial
    rows = _bank_rows(db, u.get("business_id"), from_val, to, bank_account_id)
    if rows is None:
        return _err(400, "BAD_REQUEST", "from/to must be ISO datetimes")
    rows = [r for r in rows if r.reconciliation_status == "MISMATCH"]

    def num(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    items = []
    for r in rows:
        order_name = payment_ref = settlement_ref = None
        if r.matched_order_id:
            o = db.query(Order).filter_by(id=r.matched_order_id).first()
            order_name = getattr(o, "shopify_order_name", None) if o else None
        if r.matched_payment_id:
            p = db.query(Payment).filter_by(id=r.matched_payment_id).first()
            payment_ref = getattr(p, "transaction_id", None) if p else None
        if r.matched_shipment_id:
            fin = db.query(ShipmentFinancial).filter_by(shipment_id=r.matched_shipment_id).first()
            settlement_ref = getattr(fin, "settlement_reference", None) if fin else None
        items.append({
            "bank_row_id": r.id,
            "order_id": r.matched_order_id, "order_name": order_name,
            "payment_id": r.matched_payment_id, "payment_reference": payment_ref,
            "shipment_id": r.matched_shipment_id,
            "gateway_settlement_reference": settlement_ref or r.external_reference,
            "expected_amount": num(r.expected_amount),
            "actual_amount": num(r.credit) - num(r.debit) if (num(r.credit) or num(r.debit))
            else num(r.net_amount),
            "bank_reference": r.reference_number or r.external_reference,
            "difference": num(r.difference),
            "match_level": r.match_level,
            "transaction_date": r.transaction_date.isoformat() if r.transaction_date else None,
        })
    return {"success": True, "data": {"items": items, "total": len(items)}}
