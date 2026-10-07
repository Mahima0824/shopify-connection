"""Canonical financial ledger service (#21-#25). UTC storage, Decimal money, immutable events."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.financial_transaction import (
    DEFAULT_PNL_CLASS, PNL_CLASSES, TRANSACTION_TYPES, FinancialTransaction,
)

DISPLAY_TZ = "Asia/Kolkata"
_Q = Decimal("0.01")


class UnbalancedVoucher(ValueError):
    """Raised when a voucher's debit legs do not equal its credit legs.

    Balance is enforced at the only place that matters: an unbalanced voucher
    never reaches the ledger, so no downstream reader (reports, Tally export)
    can ever observe a malformed entry.
    """


class VoucherKeyConflict(ValueError):
    """Raised when the key a caller offered is already held by another voucher.

    Not a retryable race: uq_fintxn_biz_idem means a second row can never be
    written under that key, so retrying only wastes the attempts and then reports
    a conflict with no message. A ValueError, so the API answers 400 with this
    text rather than a bare "Transaction conflict: None".
    """


# Canonical ledger account names. Wave B resolves these to the accountant's
# configured Tally ledger names; until then they are the internal names.
ACC_RECEIVABLE = "Customer / Receivable"
ACC_SALES = "Sales Revenue"
ACC_SALES_RETURNS = "Sales Returns / Refunds"
ACC_COD_RECEIVABLE = "COD Receivable"
ACC_CARRIER_FEE = "Carrier Freight / Fees"
ACC_COD_DEDUCTION = "COD Deductions / Write-off"
ACC_CARRIER_CLAIM = "Carrier Claim Receivable"
ACC_BANK = "Cash / Bank"
ACC_GATEWAY = "Payment Gateway"
ACC_INVENTORY = "Inventory / Stock"
ACC_COGS = "Cost of Goods Sold"


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


_KEY_MAX = 128  # width of FinancialTransaction.voucher_group_id / idempotency_key


def _fit_key(value: str, limit: int = _KEY_MAX) -> str:
    """Deterministically squeeze a key into a String(limit) column, never cutting it.

    The auto-generated key reaches ~160 chars once order/payment/refund ids and an
    ISO timestamp are in it. Plain truncation would give every leg of one voucher
    the *same* key (unique-constraint blowout) and would let two distinct long keys
    share a voucher_group_id (a replay of one silently returning the other). Hashing
    the tail keeps keys unique and stable across retries.
    """
    if len(value) <= limit:
        return value
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{value[:limit - len(digest) - 1]}:{digest}"


def _voucher_key(voucher_key, idempotency_key, event_type, order_id, payment_id,
                 refund_id, amount, tax, dt) -> str:
    return voucher_key or idempotency_key or (
        f"{event_type}:{order_id or '-'}:{payment_id or '-'}:{refund_id or '-'}:"
        f"{amount}:{tax}:{dt.isoformat()}")


def _leg_key(key: str, index: int) -> str:
    """Per-leg idempotency key. Leg 0 keeps the caller's key verbatim so a
    single-leg voucher is byte-identical to the pre-voucher ledger row that
    report_service.backfill_ledger matches on; later legs are suffixed."""
    return _fit_key(key) if index == 0 else _fit_key(f"{key}:{index}")


def _acct_guard(db, business_id, dt, *, txn_type):
    """Closed-period guard; imported lazily so the module stays importable alone."""
    from app.services import accounting_service as _acct
    _acct.assert_open_period(db, business_id, dt, txn_type=txn_type)


def post_voucher(db: Session, business_id: str, event_type: str, legs: list[dict],
                 *, order_id=None, payment_id=None, refund_id=None, expense_id=None,
                 transaction_date=None, currency="INR", payment_method=None,
                 reference_number=None, voucher_key=None, idempotency_key=None,
                 reversal_of_id=None, tally_voucher_type=None, tally_voucher_number=None,
                 _max_attempts: int = 5) -> list[FinancialTransaction]:
    """Write a voucher as one FinancialTransaction row per leg, all sharing one
    voucher_group_id (wave A §3).

    `legs` items are ``{"debit": str, "credit": str, "amount": <Decimal-able>,
    "tax_amount": optional, "pnl_class": optional}``.

    Raises, in both cases writing nothing:
        UnbalancedVoucher - debits do not equal credits.
        VoucherKeyConflict - the key is held by a row that cannot serve this
            voucher: a row in another non-NULL group, or a legacy single-leg
            event posted against a multi-leg voucher.

    Idempotency contract: the group id is derived from the caller's key, so a
    replay returns the rows already on file instead of appending duplicates.
    Legacy rows (migration 0020 backfilled pnl_class but never populated a group
    id, so every pre-existing row is NULL-grouped) are handled on both sides of
    that lookup, and the two halves pull in opposite directions:

    - A *group* lookup considers non-NULL groups only, so two unrelated legacy
      rows can never be mistaken for one two-leg voucher.
    - A legacy row that *holds the key* is the existing voucher and is adopted as
      a one-leg voucher, returning that row -- for a single-leg post only. Backfill
      re-runs and webhook redelivery replay pre-0020 keys, and pre-refactor
      record_event matched on idempotency_key alone, so adopting them is what keeps
      those replays idempotent. A legacy row holds exactly one leg, so adopting it
      for an N-leg voucher would return one row, write nothing and raise nothing:
      the caller would read a success and believe the whole voucher landed. That
      raises VoucherKeyConflict instead, and only one leg may ever be adopted.
    - A key held by a row in a *different* non-NULL group is the leg0/group key
      namespace overlap, not a race, and raises VoucherKeyConflict.

    Scope of the balance check: it totals the accounts a leg *names*. A leg that
    names neither account is a self-balancing pair (its accounts are filled in at
    export time by to_double_entry), which is why record_event can keep posting
    an amount with blank accounts as it always has.
    """
    from sqlalchemy.exc import IntegrityError

    t = (event_type or "").upper()
    if t not in TRANSACTION_TYPES:
        raise ValueError(f"Unknown transaction_type '{event_type}'.")
    if not legs:
        raise ValueError("post_voucher requires at least one leg.")

    default_class = DEFAULT_PNL_CLASS.get(t, "NONE")
    prepared = []
    for raw in legs:
        amt, tax = _d(raw.get("amount")), _d(raw.get("tax_amount"))
        prepared.append({
            "debit": (raw.get("debit") or "").strip(),
            "credit": (raw.get("credit") or "").strip(),
            "amount": amt,
            "tax_amount": tax,
            "net_amount": amt - tax,
            "pnl_class": (raw.get("pnl_class") or default_class).upper(),
            "payment_method": raw.get("payment_method") or payment_method,
            "reference_number": raw.get("reference_number") or reference_number,
        })
        if prepared[-1]["pnl_class"] not in PNL_CLASSES:
            raise ValueError(f"Unknown pnl_class '{prepared[-1]['pnl_class']}'.")

    dr_total = sum((l["amount"] for l in prepared if l["debit"]), Decimal("0"))
    cr_total = sum((l["amount"] for l in prepared if l["credit"]), Decimal("0"))
    # Exact, not "within a paisa": amounts are already quantized, so any gap is a
    # real one-paisa-or-more hole and this is the only place it can still be stopped.
    if abs(dr_total - cr_total) >= _Q:
        raise UnbalancedVoucher(
            f"Voucher {t} does not balance: debits {_s(dr_total)} != credits {_s(cr_total)}.")

    dt = _utc(transaction_date)
    key = _voucher_key(voucher_key, idempotency_key, t, order_id, payment_id, refund_id,
                       prepared[0]["amount"], prepared[0]["tax_amount"], dt)
    group = _fit_key(key)

    for _ in range(_max_attempts):
        existing = db.query(FinancialTransaction).filter_by(
            business_id=business_id).filter(
            FinancialTransaction.voucher_group_id.isnot(None),
            FinancialTransaction.voucher_group_id == group).order_by(
            FinancialTransaction.leg_index).all()
        if existing:
            return existing  # idempotent replay, incl. a concurrent writer that won
        try:  # closed-period guard #76/#95 (ADJUSTMENT correction path stays open)
            _acct_guard(db, business_id, dt, txn_type=t)
        except ImportError:
            pass
        rows: list[FinancialTransaction] = []
        savepoint = db.begin_nested()  # SAVEPOINT: rollback discards only our legs
        try:
            for i, leg in enumerate(prepared):
                leg_key = _leg_key(key, i)
                holder = db.query(FinancialTransaction).filter_by(
                    business_id=business_id, idempotency_key=leg_key).first()
                if holder is not None:
                    savepoint.rollback()
                    if holder.voucher_group_id is None:
                        if len(prepared) > 1:
                            raise VoucherKeyConflict(
                                f"idempotency key '{leg_key}' is held by a legacy single-leg "
                                f"event with no voucher group, which cannot satisfy this "
                                f"{len(prepared)}-leg voucher '{group}'. Adopted for one-leg "
                                "posts only; use a distinct voucher_key.")
                        return [holder]  # pre-0020 single-leg voucher: it is ours
                    if holder.voucher_group_id != group:
                        raise VoucherKeyConflict(
                            f"idempotency key '{leg_key}' is already held by voucher group "
                            f"'{holder.voucher_group_id}', so it cannot open group '{group}'. "
                            "Use a distinct voucher_key.")
                    break  # our own group: a concurrent writer may have landed it
                rows.append(FinancialTransaction(
                    business_id=business_id,
                    transaction_id=_next_txn_id(db, business_id),
                    order_id=order_id, payment_id=payment_id, refund_id=refund_id,
                    expense_id=expense_id, transaction_type=t, transaction_date=dt,
                    amount=leg["amount"], tax_amount=leg["tax_amount"],
                    net_amount=leg["net_amount"], currency=currency or "INR",
                    debit_account=leg["debit"], credit_account=leg["credit"],
                    payment_method=leg["payment_method"],
                    reference_number=leg["reference_number"], status="POSTED",
                    idempotency_key=leg_key, reversal_of_id=reversal_of_id,
                    tally_voucher_type=tally_voucher_type,
                    tally_voucher_number=tally_voucher_number,
                    voucher_group_id=group, leg_index=i, pnl_class=leg["pnl_class"],
                ))
                db.add(rows[-1])
                # Flush per leg: _next_txn_id counts rows already in the table, and
                # production sessions run autoflush=False, so without this every leg
                # of a voucher would be handed the same transaction_id.
                db.flush()
            else:
                savepoint.commit()
                return rows
        except IntegrityError:
            savepoint.rollback()
            continue  # re-count transaction_ids and retry
    # Re-check once more: a concurrent writer may have landed the whole voucher.
    existing = db.query(FinancialTransaction).filter_by(business_id=business_id).filter(
        FinancialTransaction.voucher_group_id.isnot(None),
        FinancialTransaction.voucher_group_id == group).order_by(
        FinancialTransaction.leg_index).all()
    if existing:
        return existing
    raise IntegrityError("voucher insert failed after retries", None, None)


def record_event(db: Session, business_id: str, transaction_type: str, amount,
                 tax_amount="0", transaction_date=None, order_id=None, payment_id=None,
                 refund_id=None, expense_id=None, currency="INR", debit_account="",
                 credit_account="", payment_method=None, reference_number=None,
                 idempotency_key=None, reversal_of_id=None,
                 tally_voucher_type=None, tally_voucher_number=None,
                 pnl_class=None, _max_attempts: int = 5) -> FinancialTransaction:
    """Single debit/credit pair. Now a two-leg wrapper over post_voucher (§3).

    `pnl_class` is optional: left None, the leg takes post_voucher's
    DEFAULT_PNL_CLASS for the type, so every pre-existing caller is unaffected.
    """
    a, x = _d(amount), _d(tax_amount)
    t = (transaction_type or "").upper()
    # The sign is only judged for a known type, so an unknown one still reports
    # the type error first, exactly as before this became a post_voucher wrapper.
    if t in TRANSACTION_TYPES and a < 0 and t not in ("REFUND", "CANCELLATION", "ADJUSTMENT"):
        raise ValueError("Negative amounts only allowed for REFUND/CANCELLATION/ADJUSTMENT.")
    leg = {"debit": debit_account or "", "credit": credit_account or "", "amount": amount}
    if x != 0:
        leg["tax_amount"] = tax_amount
    if pnl_class:
        leg["pnl_class"] = pnl_class
    rows = post_voucher(
        db, business_id, transaction_type, [leg], order_id=order_id, payment_id=payment_id,
        refund_id=refund_id, expense_id=expense_id, transaction_date=transaction_date,
        currency=currency, payment_method=payment_method, reference_number=reference_number,
        idempotency_key=idempotency_key, reversal_of_id=reversal_of_id,
        tally_voucher_type=tally_voucher_type, tally_voucher_number=tally_voucher_number,
        _max_attempts=_max_attempts)
    return rows[0]


def reverse_event(db: Session, business_id: str, transaction_id: str, reason: str = "") -> FinancialTransaction:
    """Correction via reversal: original stays; new ADJUSTMENT negates it (#95).

    The reversal is classed from what it reverses, never from the ADJUSTMENT
    default (EXPENSE): a reversal of something P&L-bearing is REVERSAL (a
    revenue correction is not a cost), and reversing a pure balance-sheet
    movement stays NONE because it moves value without touching P&L. Legacy
    rows may carry no usable pnl_class, so the original's type default stands in.
    """
    orig = db.query(FinancialTransaction).filter_by(
        business_id=business_id, transaction_id=transaction_id).first()
    if orig is None:
        raise ValueError("Original transaction not found.")
    orig_class = ((orig.pnl_class or "").strip().upper()
                  or DEFAULT_PNL_CLASS.get(orig.transaction_type, "NONE"))
    if orig_class not in PNL_CLASSES:
        orig_class = DEFAULT_PNL_CLASS.get(orig.transaction_type, "NONE")
    return record_event(
        db, business_id, "ADJUSTMENT", -Decimal(str(orig.amount)), -Decimal(str(orig.tax_amount)),
        order_id=orig.order_id, payment_id=orig.payment_id, refund_id=orig.refund_id,
        currency=orig.currency, debit_account=orig.credit_account, credit_account=orig.debit_account,
        reference_number=f"REVERSAL of {orig.transaction_id}: {reason}"[:128],
        idempotency_key=f"REVERSAL:{orig.transaction_id}",
        reversal_of_id=orig.id,
        pnl_class="REVERSAL" if orig_class != "NONE" else "NONE",
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
