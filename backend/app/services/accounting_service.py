"""Accounting controls (#76/#77/#95): FY helper, month-close checks, closed-period guard.

UTC storage, Asia/Kolkata display. Additive only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

DISPLAY_TZ = "Asia/Kolkata"
DEFAULT_FY_START_MONTH = 4  # India: April 1 -> March 31 (#77)


class CloseBlocked(Exception):
    def __init__(self, issues: dict):
        super().__init__(f"Cannot close month. {issues.get('total', 0)} issues remain.")
        self.issues = issues


class ClosedPeriodError(ValueError):
    pass


def _utc(dt) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def month_window(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(int(year), int(month), 1, tzinfo=timezone.utc)
    end = datetime(int(year) + (1 if int(month) == 12 else 0),
                   1 if int(month) == 12 else int(month) + 1, 1, tzinfo=timezone.utc)
    return start, end


def _fy_start_month(db: Session, business_id: str) -> int:
    try:
        from app.models.business import Business
        b = db.query(Business).filter_by(id=business_id).first()
        m = int(getattr(b, "fy_start_month", DEFAULT_FY_START_MONTH) or DEFAULT_FY_START_MONTH)
        return m if 1 <= m <= 12 else DEFAULT_FY_START_MONTH
    except Exception:
        return DEFAULT_FY_START_MONTH


def fy_label(dt, fy_start_month: int = DEFAULT_FY_START_MONTH) -> str:
    d = _utc(dt)
    start_year = d.year if d.month >= fy_start_month else d.year - 1
    return f"FY {start_year}-{str(start_year + 1)[-2:]}"


def fy_bounds_for(db: Session, business_id: str, dt=None) -> tuple[datetime, datetime, dict]:
    """FY bounds honoring business-configurable start month (#77)."""
    from app.services import ledger_service as ls
    m = _fy_start_month(db, business_id)
    s, e = ls.fy_bounds(_utc(dt) if dt else datetime.now(timezone.utc), fy_start_month=m)
    return s, e, {"fy": fy_label(dt or datetime.now(timezone.utc), m),
                  "fy_start_month": m, "display_timezone": DISPLAY_TZ}


def period_status(db: Session, business_id: str, year: int, month: int) -> str:
    from app.models.accounting_period import AccountingPeriod
    p = db.query(AccountingPeriod).filter_by(
        business_id=business_id, year=int(year), month=int(month)).first()
    return p.status if p else "OPEN"


def assert_open_period(db: Session, business_id: str, dt, *, allow_adjustment: bool = False,
                       txn_type: str = "") -> None:
    """Closed-period guard (#76/#95): block back-dated financial writes.

    ADJUSTMENT (reversal/credit/debit/correction path) is the authorized
    adjustment workflow and is allowed through; everything else is blocked.
    """
    d = _utc(dt)
    if period_status(db, business_id, d.year, d.month) != "CLOSED":
        return
    if allow_adjustment or (txn_type or "").upper() == "ADJUSTMENT":
        return
    raise ClosedPeriodError(
        f"Period {d.year}-{d.month:02d} is CLOSED; post an ADJUSTMENT correction instead.")


def close_checks(db: Session, business_id: str, year: int, month: int) -> dict:
    """The five checks from #76. Returns {total, checks{...}}."""
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.refund import Refund
    from app.models.tally import TallyExportRecord

    start, end = month_window(year, month)
    issues: dict[str, list] = {"unreconciled_payments": [], "unreconciled_bank": [],
                               "unexported_transactions": [],
                               "invalid_gst": [], "missing_cogs": [], "pending_refunds": []}

    try:  # genuine recon state per Task 2 (#35): a payment is reconciled only when a
        # BANK_STATEMENT row links it with status MATCHED (payment_status alone is not proof).
        from app.models.statement import StatementRow, StatementUpload
        matched_pids = {str(r.matched_payment_id) for r in db.query(StatementRow).join(
            StatementUpload, StatementUpload.id == StatementRow.statement_upload_id).filter(
            StatementUpload.business_id == business_id,
            StatementUpload.statement_type == "BANK_STATEMENT",
            StatementRow.reconciliation_status == "MATCHED",
            StatementRow.matched_payment_id.isnot(None)).all()}
        for p in db.query(Payment).filter_by(business_id=business_id).all():
            created = _utc(p.created_at) if getattr(p, "created_at", None) else None
            if created is not None and not (start <= created < end):
                continue
            if (p.payment_status or "").upper() in ("FAILED", "CANCELLED"):
                continue  # dead payments need no bank recon
            if str(p.id) not in matched_pids:
                issues["unreconciled_payments"].append(str(p.id))
    except Exception:
        pass

    try:  # bank mismatches block close per #76: any BANK_STATEMENT row in-month that is
        # neither MATCHED nor terminally excluded (IGNORED/DUPLICATE) is still open.
        from app.models.statement import StatementRow, StatementUpload
        for r in db.query(StatementRow).join(
                StatementUpload,
                StatementUpload.id == StatementRow.statement_upload_id).filter(
                StatementUpload.business_id == business_id,
                StatementUpload.statement_type == "BANK_STATEMENT").all():
            d = _utc(r.transaction_date) if getattr(r, "transaction_date", None) else (
                _utc(r.value_date) if getattr(r, "value_date", None) else None)
            if d is None or not (start <= d < end):
                continue
            if (r.reconciliation_status or "UNMATCHED").upper() not in (
                    "MATCHED", "IGNORED", "DUPLICATE"):
                issues["unreconciled_bank"].append(str(r.id))
    except Exception:
        pass

    try:
        txns = db.query(FinancialTransaction).filter_by(business_id=business_id).filter(
            FinancialTransaction.transaction_date >= start,
            FinancialTransaction.transaction_date < end).all()
    except Exception:
        txns = []
    try:
        exported = {(x.transaction_id) for x in db.query(TallyExportRecord).filter_by(
            business_id=business_id).all()}
    except Exception:
        exported = set()
    for t in txns:
        if t.transaction_id not in exported:
            issues["unexported_transactions"].append(t.transaction_id)
        try:  # invalid GST: net + tax must equal amount (#47/#50)
            if abs(float(t.net_amount or 0) + float(t.tax_amount or 0) - float(t.amount or 0)) > 0.01:
                issues["invalid_gst"].append(t.transaction_id)
        except Exception:
            issues["invalid_gst"].append(t.transaction_id)

    try:  # real GST validation: Task 3 tally gate over the period's rows. Only GST
        # codes map here (mapping/customer/duplicate errors belong to the export flow).
        from app.services import tally_service as _tally
        gate = _tally.validate_export(db, business_id, start, end, _check_exported=False)
        for e in gate.get("errors", []):
            if e.get("code") in ("TAX_CALC_MISMATCH", "INVOICE_TOTAL_MISMATCH"):
                ref = e.get("ref")
                if ref and ref not in issues["invalid_gst"]:
                    issues["invalid_gst"].append(ref)
    except Exception:
        pass

    try:  # missing COGS: orders in month without a COGS event (#30)
        oids = [o.id for o in db.query(Order).filter_by(business_id=business_id).filter(
            Order.order_date >= start, Order.order_date < end).all()]
        cogs_oids = {t.order_id for t in txns if t.transaction_type == "COGS" and t.order_id}
        issues["missing_cogs"] = [oid for oid in oids if oid not in cogs_oids]
    except Exception:
        pass

    try:
        for r in db.query(Refund).filter_by(business_id=business_id).all():
            created = _utc(r.created_at) if getattr(r, "created_at", None) else None
            if created is not None and not (start <= created < end):
                continue
            if (r.status or "").upper() not in ("COMPLETED", "PROCESSED", "SETTLED"):
                issues["pending_refunds"].append(str(r.id))
    except Exception:
        pass

    total = sum(len(v) for v in issues.values())
    counts = {k: len(v) for k, v in issues.items()}
    return {"total": total, "counts": counts, "checks": issues,
            "period": {"year": int(year), "month": int(month)},
            "display_timezone": DISPLAY_TZ}


def close_month(db: Session, business_id: str, year: int, month: int,
                user_id: str, user_agent: str | None = None, ip: str | None = None) -> dict:
    from app.models.accounting_period import AccountingPeriod
    from app.services.audit_service import log_audit
    checks = close_checks(db, business_id, year, month)
    if checks["total"] > 0:
        raise CloseBlocked(checks)
    p = db.query(AccountingPeriod).filter_by(
        business_id=business_id, year=int(year), month=int(month)).first()
    if p is None:
        p = AccountingPeriod(business_id=business_id, year=int(year), month=int(month))
        db.add(p)
        db.flush()
    if p.status == "CLOSED":
        return {"id": p.id, "status": p.status, "already_closed": True}
    p.status = "CLOSED"
    p.closed_at = datetime.now(timezone.utc)
    p.closed_by = user_id
    p.issue_count = 0
    log_audit(db, business_id, user_id, "accounting_period", p.id, "MONTH_CLOSED",
              {"status": "OPEN"}, {"status": "CLOSED", "year": int(year), "month": int(month)},
              ip_address=ip, user_agent=user_agent)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "status": p.status, "closed_at": p.closed_at.isoformat()}


def reopen_month(db: Session, business_id: str, year: int, month: int,
                 user_id: str, user_agent: str | None = None, ip: str | None = None) -> dict:
    """Authorized adjustment workflow: reopening is itself audited (#76)."""
    from app.models.accounting_period import AccountingPeriod
    from app.services.audit_service import log_audit
    p = db.query(AccountingPeriod).filter_by(
        business_id=business_id, year=int(year), month=int(month)).first()
    if p is None or p.status != "CLOSED":
        raise ValueError("Period is not closed.")
    p.status = "OPEN"
    p.reopened_at = datetime.now(timezone.utc)
    p.reopened_by = user_id
    log_audit(db, business_id, user_id, "accounting_period", p.id, "MONTH_REOPENED",
              {"status": "CLOSED"}, {"status": "OPEN", "year": int(year), "month": int(month)},
              ip_address=ip, user_agent=user_agent)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "status": p.status}


def _d(v) -> Decimal:
    from decimal import ROUND_HALF_UP
    try:
        return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")
