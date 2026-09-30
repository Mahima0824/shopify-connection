"""Canonical financial ledger service (#21-#25). UTC storage, Decimal money, immutable events."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.financial_transaction import TRANSACTION_TYPES, FinancialTransaction

DISPLAY_TZ = "Asia/Kolkata"
_Q = Decimal("0.01")


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(_Q, rounding=ROUND_HALF_UP)


def _s(v: Decimal) -> str:
    return format(v.quantize(_Q, rounding=ROUND_HALF_UP), ".2f")


def _utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_ist_iso(dt) -> str | None:
    try:
        d = _utc(dt).astimezone(ZoneInfo(DISPLAY_TZ))
        return d.isoformat()
    except Exception:
        return None


# --- Pure calculators (unit-testable, no DB) ---

def cogs_for_item(quantity, cost_price) -> str:
    return _s(_d(quantity) * _d(cost_price))


def to_double_entry(txn: dict) -> list[dict]:
    """Transform a ledger event into double-entry lines per #22."""
    t = (txn.get("transaction_type") or "").upper()
    amt = _s(_d(txn.get("amount")))
    tax = _d(txn.get("tax_amount"))
    dr = txn.get("debit_account") or ""
    cr = txn.get("credit_account") or ""
    if t == "SALE" and tax > 0:
        net = _s(_d(amt) - tax)
        return [
            {"debit": dr or "Customer / Receivable", "amount": amt},
            {"credit": cr or "Sales Revenue", "amount": net},
            {"credit": "Output GST", "amount": _s(tax)},
        ]
    if t == "PAYMENT":
        return [{"debit": dr or "Payment Gateway", "credit": cr or "Customer / Receivable", "amount": amt}]
    if t == "PAYMENT_GATEWAY_FEE":
        return [{"debit": dr or "Payment Gateway Fee", "credit": cr or "Payment Gateway", "amount": amt}]
    if t == "REFUND":
        return [{"debit": dr or "Sales Returns / Refunds", "credit": cr or "Payment Gateway", "amount": amt}]
    if t in ("SHIPPING_EXPENSE", "PACKAGING_EXPENSE", "OTHER_EXPENSE", "COGS", "TAX", "CANCELLATION", "ADJUSTMENT"):
        return [{"debit": dr or t.title().replace("_", " "), "credit": cr or "Cash / Bank", "amount": amt}]
    return [{"debit": dr, "credit": cr, "amount": amt}]


def revenue_summary(txns: list[dict]) -> dict:
    """Revenue = Gross(SALE) - Discounts - Refunds - applicable cancellations (#23)."""
    gross = tax = refunds = refund_tax = canc = canc_tax = disc = Decimal("0")
    for t in txns:
        typ = (t.get("transaction_type") or "").upper()
        a, x = _d(t.get("amount")), _d(t.get("tax_amount"))
        if typ == "SALE":
            gross += a
            tax += x
        elif typ == "REFUND":
            refunds += a
            refund_tax += x
        elif typ == "CANCELLATION":
            canc += a
            canc_tax += x
        elif typ == "ADJUSTMENT" and a < 0:
            disc += -a
    net_inc = gross - refunds - canc - disc
    net_tax = tax - refund_tax - canc_tax
    return {
        "gross_inclusive": _s(gross),
        "discounts": _s(disc),
        "refunds_inclusive": _s(refunds),
        "cancellations_inclusive": _s(canc),
        "net_inclusive": _s(net_inc),
        "gst": _s(net_tax),
        "gross_exclusive": _s(gross - tax),
        "net_exclusive": _s(net_inc - net_tax),
    }


def profit_summary(net_sales_exclusive, cogs="0", shipping="0", packaging="0",
                   gateway_fees="0", other="0", costs_complete=True,
                   missing_cogs_count=0) -> dict:
    """Net Sales - COGS = Gross; Gross - direct exp = Operating (#24, ESTIMATED until complete)."""
    net, c, s, p, g, o = (_d(v) for v in (net_sales_exclusive, cogs, shipping, packaging, gateway_fees, other))
    gross_profit = net - c
    operating = gross_profit - s - p - g - o
    label = "OPERATING PROFIT" if costs_complete else "ESTIMATED OPERATING PROFIT"
    warning = "" if costs_complete else (
        f"Profit calculation incomplete: COGS missing for {int(missing_cogs_count)} products.")
    margin = (operating / net * 100).quantize(_Q, rounding=ROUND_HALF_UP) if net != 0 else Decimal("0.00")
    return {
        "net_sales_exclusive": _s(net), "cogs": _s(c), "gross_profit": _s(gross_profit),
        "shipping": _s(s), "packaging": _s(p), "gateway_fees": _s(g), "other": _s(o),
        "operating_profit": _s(operating), "label": label, "warning": warning,
        "margin_pct": _s(margin),
    }


def fy_bounds(dt: datetime, fy_start_month: int = 4) -> tuple[datetime, datetime]:
    """India FY: 1 April -> 31 March (#77). Returns UTC-aware [start, end)."""
    d = _utc(dt)
    start_year = d.year if d.month >= fy_start_month else d.year - 1
    start = datetime(start_year, fy_start_month, 1, tzinfo=timezone.utc)
    end = datetime(start_year + 1, fy_start_month, 1, tzinfo=timezone.utc)
    return start, end


# --- DB-backed immutable record ---

def _next_txn_id(db: Session, business_id: str, prefix: str = "TXN") -> str:
    from sqlalchemy import func as sa_func
    n = db.query(sa_func.count(FinancialTransaction.id)).filter_by(business_id=business_id).scalar() or 0
    return f"{prefix}-{int(n) + 1:08d}"


def record_event(db: Session, business_id: str, transaction_type: str, amount,
                 tax_amount="0", transaction_date=None, order_id=None, payment_id=None,
                 refund_id=None, expense_id=None, currency="INR", debit_account="",
                 credit_account="", payment_method=None, reference_number=None,
                 idempotency_key=None, reversal_of_id=None,
                 tally_voucher_type=None, tally_voucher_number=None,
                 _max_attempts: int = 5) -> FinancialTransaction:
    from sqlalchemy.exc import IntegrityError
    t = (transaction_type or "").upper()
    if t not in TRANSACTION_TYPES:
        raise ValueError(f"Unknown transaction_type '{transaction_type}'.")
    a, x = _d(amount), _d(tax_amount)
    if a < 0 and t not in ("REFUND", "CANCELLATION", "ADJUSTMENT"):
        raise ValueError("Negative amounts only allowed for REFUND/CANCELLATION/ADJUSTMENT.")
    dt = _utc(transaction_date)
    try:  # closed-period guard #76/#95 (ADJUSTMENT correction path stays open)
        from app.services import accounting_service as _acct
        _acct.assert_open_period(db, business_id, dt, txn_type=t)
    except ImportError:
        pass
    key = idempotency_key or f"{t}:{order_id or '-'}:{payment_id or '-'}:{refund_id or '-'}:{a}:{x}:{dt.isoformat()}"
    for _ in range(_max_attempts):
        existing = db.query(FinancialTransaction).filter_by(
            business_id=business_id, idempotency_key=key).first()
        if existing is not None:
            return existing  # idempotent replay (incl. concurrent writer won the race)
        txn = FinancialTransaction(
            business_id=business_id, transaction_id=_next_txn_id(db, business_id),
            order_id=order_id, payment_id=payment_id, refund_id=refund_id, expense_id=expense_id,
            transaction_type=t, transaction_date=dt, amount=a, tax_amount=x, net_amount=(a - x),
            currency=currency or "INR", debit_account=debit_account or "",
            credit_account=credit_account or "", payment_method=payment_method,
            reference_number=reference_number, status="POSTED", idempotency_key=key,
            reversal_of_id=reversal_of_id, tally_voucher_type=tally_voucher_type,
            tally_voucher_number=tally_voucher_number,
        )
        savepoint = db.begin_nested()  # SAVEPOINT: rollback below discards only our insert
        db.add(txn)
        try:
            db.flush()
        except IntegrityError:
            savepoint.rollback()
            continue  # re-count a fresh transaction_id (or find concurrent idempotent row) and retry
        else:
            savepoint.commit()
            return txn
    # Re-check once more: a concurrent idempotent insert may have landed.
    existing = db.query(FinancialTransaction).filter_by(
        business_id=business_id, idempotency_key=key).first()
    if existing is not None:
        return existing
    raise IntegrityError("financial_transactions insert failed after retries", None, None)


def reverse_event(db: Session, business_id: str, transaction_id: str, reason: str = "") -> FinancialTransaction:
    """Correction via reversal: original stays; new ADJUSTMENT negates it (#95)."""
    orig = db.query(FinancialTransaction).filter_by(
        business_id=business_id, transaction_id=transaction_id).first()
    if orig is None:
        raise ValueError("Original transaction not found.")
    return record_event(
        db, business_id, "ADJUSTMENT", -Decimal(str(orig.amount)), -Decimal(str(orig.tax_amount)),
        order_id=orig.order_id, payment_id=orig.payment_id, refund_id=orig.refund_id,
        currency=orig.currency, debit_account=orig.credit_account, credit_account=orig.debit_account,
        reference_number=f"REVERSAL of {orig.transaction_id}: {reason}"[:128],
        idempotency_key=f"REVERSAL:{orig.transaction_id}",
        reversal_of_id=orig.id,
    )


# --- Additive hooks from existing flows (never modify existing records) ---

def record_sale_from_order(db: Session, business_id: str, order) -> FinancialTransaction | None:
    try:
        return record_event(
            db, business_id, "SALE", order.total_amount or 0, order.tax_amount or 0,
            transaction_date=getattr(order, "order_date", None), order_id=order.id,
            currency=getattr(order, "currency", "INR") or "INR",
            debit_account="Customer / Receivable", credit_account="Sales Revenue",
            reference_number=getattr(order, "shopify_order_name", None),
            idempotency_key=f"SALE:{order.id}",
            tally_voucher_type="Sales",
            tally_voucher_number=getattr(order, "shopify_order_name", None),
        )
    except Exception:
        return None


def record_payment_from_payment(db: Session, business_id: str, payment, method=None) -> FinancialTransaction | None:
    try:
        return record_event(
            db, business_id, "PAYMENT", payment.amount or 0, "0",
            order_id=payment.order_id, payment_id=payment.id,
            debit_account="Payment Gateway", credit_account="Customer / Receivable",
            payment_method=method or getattr(payment, "method", None),
            reference_number=getattr(payment, "transaction_id", None),
            idempotency_key=f"PAYMENT:{payment.id}",
            tally_voucher_type="Receipt",
        )
    except Exception:
        return None


def record_refund_from_refund(db: Session, business_id: str, refund, tax_amount="0") -> FinancialTransaction | None:
    try:
        return record_event(
            db, business_id, "REFUND", refund.amount or 0, tax_amount,
            order_id=refund.order_id, refund_id=refund.id,
            currency=getattr(refund, "currency", "INR") or "INR",
            debit_account="Sales Returns / Refunds", credit_account="Payment Gateway",
            idempotency_key=f"REFUND:{refund.id}",
            tally_voucher_type="Credit Note",
        )
    except Exception:
        return None


def record_cancellation(db: Session, business_id: str, order, refund_required=False) -> FinancialTransaction | None:
    """Cancelled before payment -> zero-amount marker (no revenue impact, #43/#100)."""
    try:
        amt = order.total_amount if refund_required else 0
        tax = order.tax_amount if refund_required else 0
        return record_event(
            db, business_id, "CANCELLATION", amt or 0, tax or 0,
            order_id=order.id, currency=getattr(order, "currency", "INR") or "INR",
            debit_account="Sales Returns / Refunds", credit_account="Customer / Receivable",
            reference_number=getattr(order, "cancel_reason", None),
            idempotency_key=f"CANCELLATION:{order.id}",
        )
    except Exception:
        return None


def order_timeline(db: Session, business_id: str, order_id: str) -> list[dict]:
    rows = db.query(FinancialTransaction).filter_by(
        business_id=business_id, order_id=order_id).order_by(
        FinancialTransaction.transaction_date).all()
    return [{
        "transaction_id": r.transaction_id, "transaction_type": r.transaction_type,
        "amount": str(r.amount), "tax_amount": str(r.tax_amount), "net_amount": str(r.net_amount),
        "currency": r.currency, "transaction_date": r.transaction_date.isoformat() if r.transaction_date else None,
        "transaction_date_ist": to_ist_iso(r.transaction_date),
        "debit_account": r.debit_account, "credit_account": r.credit_account,
        "double_entry": to_double_entry({"transaction_type": r.transaction_type, "amount": str(r.amount),
                                         "tax_amount": str(r.tax_amount), "debit_account": r.debit_account,
                                         "credit_account": r.credit_account}),
    } for r in rows]


def period_summary(db: Session, business_id: str, start: datetime, end: datetime,
                   order_ids: set[str] | list[str] | None = None) -> dict:
    rows = db.query(FinancialTransaction).filter_by(business_id=business_id).filter(
        FinancialTransaction.transaction_date >= _utc(start),
        FinancialTransaction.transaction_date < _utc(end))
    if order_ids is not None:
        # Report filters narrow rows AND totals to the same set (#56/#28):
        # only order-linked events in the filtered set count.
        oids = set(order_ids)
        rows = rows.filter(FinancialTransaction.order_id.in_(oids))
    rows = rows.all()
    txns = [{"transaction_type": r.transaction_type, "amount": str(r.amount),
             "tax_amount": str(r.tax_amount)} for r in rows]
    rev = revenue_summary(txns)

    def _sum(*types):
        return _s(sum((_d(r.amount) for r in rows if r.transaction_type in types), Decimal("0")))

    cogs_v, ship_v, pack_v, fee_v, other_v = (
        _sum("COGS"), _sum("SHIPPING_EXPENSE"), _sum("PACKAGING_EXPENSE"),
        _sum("PAYMENT_GATEWAY_FEE"), _sum("OTHER_EXPENSE"))
    missing = 0
    try:  # incomplete-cost signal per #30: orders in scope without COGS events
        if order_ids is not None:
            scope_oids = list(set(order_ids))
        else:
            from app.models.order import Order
            scope_oids = [o.id for o in db.query(Order).filter_by(business_id=business_id).filter(
                Order.order_date >= _utc(start), Order.order_date < _utc(end)).all()]
        if scope_oids:
            cogs_oids = {r.order_id for r in rows if r.transaction_type == "COGS" and r.order_id}
            missing = sum(1 for oid in scope_oids if oid not in cogs_oids)
    except Exception:
        pass
    profit = profit_summary(rev["net_exclusive"], cogs_v, ship_v, pack_v, fee_v, other_v,
                            costs_complete=(missing == 0), missing_cogs_count=missing)
    return {
        "revenue": rev, "profit": profit,
        "cogs_total": cogs_v, "transaction_count": len(rows),
        "display_timezone": DISPLAY_TZ,
        "period": {"from": _utc(start).isoformat(), "to": _utc(end).isoformat()},
    }
