"""Canonical financial ledger service (#21-#25). UTC storage, Decimal money, immutable events."""

from __future__ import annotations

import hashlib
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.financial_transaction import (
    DEFAULT_PNL_CLASS, PNL_CLASSES, TRANSACTION_TYPES, FinancialTransaction,
)
from app.models.ledger_posting_failure import LedgerPostingFailure

DISPLAY_TZ = "Asia/Kolkata"
_Q = Decimal("0.01")
log = logging.getLogger(__name__)


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
ACC_OUTPUT_CGST = "Output CGST"
ACC_OUTPUT_SGST = "Output SGST"
ACC_OUTPUT_IGST = "Output IGST"


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
    """Transform a ledger event into double-entry lines per #22.

    LEGACY DISPLAY HELPER, exercised ONLY by tests: no application code calls it, and
    it is kept solely so the existing readers of it keep passing. A leg stored in the
    ledger *is* the double entry -- post_voucher writes real legs, order_timeline
    reports them, and tally_service exports the stored accounts.

    What it does not describe is a split voucher, where each leg already names its own
    accounts: it re-derives an entry from one event's amount, assumes a single gross
    SALE, and hardcodes a credit to "Output GST" -- a ledger that does not exist in the
    chart (the real names are Output CGST / Output SGST / Output IGST).
    """
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


def pnl_class_of(row: dict) -> str:
    """Per-leg P&L class (wave A §8).

    The stored `pnl_class` wins, with one deliberate exception. The column defaults to
    "NONE" -- itself a valid class -- so a row written before the class existed, or one
    whose writer never set one, carries "NONE" on a SALE; read at face value that
    reports the sale's revenue as zero and the DEFAULT_PNL_CLASS fallback never fires.
    So a stored "NONE" on a type whose default is non-NONE means *unclassified*, and
    the type default stands in.

    A genuinely classless row stays NONE: PAYMENT, REFUND_PAYOUT, COD_COLLECTION and
    CANCELLATION all default to NONE, as do the bank and receivable legs of a
    COD_REMIT, so this never invents P&L for a balance-sheet movement. It is also the
    path a plain dict with no `pnl_class` key at all takes, which is what the
    pure-function callers and tests pass.
    """
    explicit = (row.get("pnl_class") or "").strip().upper()
    fallback = DEFAULT_PNL_CLASS.get((row.get("transaction_type") or "").upper(), "NONE")
    if explicit in PNL_CLASSES and (explicit != "NONE" or fallback == "NONE"):
        return explicit
    return fallback


def revenue_summary(txns: list[dict]) -> dict:
    """Revenue = Gross(SALE) - Discounts - Refunds (#23, wave A §8).

    Classification is per leg via pnl_class_of, so one voucher's legs are read
    individually: a COD_REMIT's bank leg never registers as revenue while its fee leg
    can be classed revenue if a writer says so. CANCELLATION is a void marker and
    carries no amount, so it has no branch here at all.
    """
    gross = tax = refunds = refund_tax = disc = Decimal("0")
    for t in txns:
        cls = pnl_class_of(t)
        typ = (t.get("transaction_type") or "").upper()
        a, x = _d(t.get("amount")), _d(t.get("tax_amount"))
        if cls == "REVENUE":
            gross += a
            tax += x
        elif typ == "REFUND":
            # The type branch comes FIRST, ahead of any sign test, because a REFUND
            # leg can legitimately be negative: record_event whitelists one, and
            # record_refund_from_refund writes one by design when the pro-rated tax
            # exceeds the refund ("It goes negative on the Sales side"). A negative
            # refund RESTORES revenue, so it belongs here. Ruled by sign instead, it
            # was charged as a discount as well, counting the same leg twice in
            # opposite directions.
            refunds += a
            refund_tax += x
        elif cls == "REVERSAL" and a > 0:
            # A credit note on a type that is not REFUND, or a writer that classed it
            # so: revenue previously recognised, now given back.
            refunds += a
            refund_tax += x
        elif a < 0 and (cls == "REVERSAL" or typ == "ADJUSTMENT"):
            # Sign-splitting, for the rows the type branch above cannot classify --
            # today only CARRIER_CLAIM, whose REVERSAL class covers both a
            # reimbursement (positive) and a clawback correction (negative), plus a
            # mirror-image ADJUSTMENT correction, which is where this landed before.
            # KNOWN LIMIT: a mirror-image REVERSAL of a COST cannot be told apart from
            # one of a refund without joining reversal_of_id, which a pure function over
            # dicts cannot do, so it nets as a discount. Logged for a later wave
            # alongside giving REVERSAL separate revenue/expense vocabulary.
            disc += -a
    net_inc = gross - refunds - disc
    net_tax = tax - refund_tax
    return {
        "gross_inclusive": _s(gross),
        "discounts": _s(disc),
        "refunds_inclusive": _s(refunds),
        # Kept as a key so existing consumers do not break; always "0.00" now that a
        # cancellation carries no amount. Wave C may remove it.
        "cancellations_inclusive": "0.00",
        "net_inclusive": _s(net_inc),
        "gst": _s(net_tax),
        "gross_exclusive": _s(gross - tax),
        "net_exclusive": _s(net_inc - net_tax),
    }


def profit_summary(net_sales_exclusive, cogs="0", shipping="0", packaging="0",
                   gateway_fees="0", other="0", costs_complete=True,
                   missing_cogs_count=0, carrier_fees="0", cod_deductions="0") -> dict:
    """Net Sales - COGS = Gross; Gross - direct exp = Operating (#24, ESTIMATED until complete).

    `carrier_fees` and `cod_deductions` sit last, after `missing_cogs_count`, so that
    adding them could not re-bind an existing parameter for any caller that passes
    them positionally.
    """
    net, c, s, p, g, o, cf, cd = (_d(v) for v in (
        net_sales_exclusive, cogs, shipping, packaging, gateway_fees, other,
        carrier_fees, cod_deductions))
    gross_profit = net - c
    operating = gross_profit - s - p - g - o - cf - cd
    label = "OPERATING PROFIT" if costs_complete else "ESTIMATED OPERATING PROFIT"
    warning = "" if costs_complete else (
        f"Profit calculation incomplete: COGS missing for {int(missing_cogs_count)} products.")
    margin = (operating / net * 100).quantize(_Q, rounding=ROUND_HALF_UP) if net != 0 else Decimal("0.00")
    return {
        "net_sales_exclusive": _s(net), "cogs": _s(c), "gross_profit": _s(gross_profit),
        "shipping": _s(s), "packaging": _s(p), "gateway_fees": _s(g), "other": _s(o),
        "carrier_fees": _s(cf), "cod_deductions": _s(cd),
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
    last = (
        db.query(FinancialTransaction.transaction_id)
        .filter_by(business_id=business_id)
        .filter(FinancialTransaction.transaction_id.like(f"{prefix}-%"))
        .order_by(FinancialTransaction.transaction_id.desc())
        .first()
    )
    if last and last[0]:
        try:
            curr_num = int(last[0].split("-")[1])
            return f"{prefix}-{curr_num + 1:08d}"
        except Exception:
            pass
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

    Scope of the balance check: it totals the accounts a leg *names*, so a leg that
    names neither account is UNCHECKED rather than balanced -- it contributes 0 to
    both sides of the total and the check passes without the amount ever being
    compared. That is why record_event can keep posting an amount with blank
    accounts as it always has. Such a row is stored with blank accounts and reported
    blank by order_timeline and by the Tally export; it is never given accounts
    after the fact.
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


def record_posting_failure(db: Session, business_id: str, source_type: str,
                           source_id: str, event_type: str,
                           reason: str) -> LedgerPostingFailure:
    """Durably record a ledger posting that failed (wave A §9).

    The webhook path must not 500 because the ledger rejected an event, but it must
    not silently drop one either. This turns "lost revenue nobody can see" into "a
    month you cannot close until it is fixed".

    UPSERT, not insert: uq_lpf_biz_source_event holds one row per
    (business, source, event), and a recurring failure is the normal case -- a
    Shopify redelivery, a retry, a second run of a batch. A plain insert would raise
    IntegrityError *inside the error handler*, so the failure being recorded, the
    reason it is being recorded, and the original failure would all be lost, and the
    one thing this function exists to prevent would be what actually happened.

    A recurrence also clears `resolved_at`: resolved means somebody fixed it and
    checked the box, and it breaking again is unresolved again, so the month
    close-blocks again.
    """
    key = dict(business_id=business_id, source_type=source_type,
               source_id=str(source_id), event_type=event_type)
    f = db.query(LedgerPostingFailure).filter_by(**key).first()
    if f is None:
        f = LedgerPostingFailure(reason=str(reason)[:2000], attempts=1, **key)
        db.add(f)
    else:
        f.reason = str(reason)[:2000]
        f.attempts = (f.attempts or 0) + 1
        f.resolved_at = None
    db.commit()
    return f


@contextmanager
def safe_post(db: Session, business_id: str, source_type: str, source_id: str,
              event_type: str):
    """Run a ledger posting; on failure, record it durably and carry on.

    Swallows the exception so the caller (typically a Shopify webhook) can finish
    its own work, but never loses the event: the failure row is committed before the
    context exits. `db` and `business_id` are explicit parameters rather than
    ambient state, so a failure is always attributable to the right business.

    The rollback is not optional. A posting that raised part-way through may have
    left a savepoint open or a batch half-flushed, and the failure row must be the
    only thing this context commits -- otherwise it lands on top of a half-written
    voucher the caller has already been told was rejected.

    Recording can itself fail (the same outage that broke the posting breaks the
    insert). That must not propagate into a webhook, but it is NOT a silent success:
    it is logged, and at that point the event really is gone and only the log says
    so. The alternative -- letting it raise -- would trade a lost event for a
    redelivery that fails the same way.
    """
    try:
        yield
    except Exception as exc:
        try:
            db.rollback()
            record_posting_failure(db, business_id, source_type, source_id,
                                   event_type, f"{type(exc).__name__}: {exc}")
        except Exception:
            log.exception(
                "ledger posting failure NOT recorded: %s/%s/%s for business %s. "
                "This event is lost and nothing blocks the month close.",
                source_type, source_id, event_type, business_id)


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

def record_sale_from_order(db: Session, business_id: str, order) -> list:
    """Sale as one multi-leg voucher: taxable + Output CGST/SGST/IGST (§5).

    Symmetric with record_refund_from_refund, so a credit note debits exactly the
    ledgers this credited and the pair nets to zero. Before, the sale credited
    Sales Revenue with the gross and no GST ledger at all, so GST payable was
    never on this ledger and the credit note pulled from accounts nothing funded.

    The invoice number rides on the taxable leg only. post_voucher applies
    tally_voucher_number to EVERY leg and validate_export derives one
    voucher_number per row, so naming all three legs after the order made every
    sale fail INVOICE_NOT_UNIQUE. validate_export now compares a voucher's legs
    together, so the three legs are one invoice with one number.

    Legacy rows: a pre-0020 sale sits at key `SALE:{id}` with voucher_group_id
    NULL, and post_voucher will not satisfy a multi-leg voucher from a legacy
    single-leg row, so this raises VoucherKeyConflict rather than appending a
    second sale and double-counting the revenue. That is intended and loud;
    migrating those rows is Task 8's job.
    """
    total = _d(getattr(order, "total_amount", 0) or 0)
    cgst, sgst, igst = order_tax_split(db, order, total)
    taxable = total - (cgst + sgst + igst)
    name = getattr(order, "shopify_order_name", None)
    legs = [{"debit": ACC_RECEIVABLE, "credit": ACC_SALES, "amount": taxable,
             "reference_number": name}]
    for acct, val in ((ACC_OUTPUT_CGST, cgst), (ACC_OUTPUT_SGST, sgst), (ACC_OUTPUT_IGST, igst)):
        if val > 0:
            # tax_amount = the GST itself, so net_amount is 0 and revenue_summary
            # counts this leg as tax rather than as revenue.
            legs.append({"debit": ACC_RECEIVABLE, "credit": acct,
                         "amount": val, "tax_amount": val})
    return post_voucher(
        db, business_id, "SALE", legs,
        order_id=order.id,
        transaction_date=getattr(order, "order_date", None),
        currency=getattr(order, "currency", "INR") or "INR",
        voucher_key=f"SALE:{order.id}",
        tally_voucher_type="Sales",
    )


def record_payment_from_payment(db: Session, business_id: str, payment, method=None) -> FinancialTransaction:
    return record_event(
        db, business_id, "PAYMENT", payment.amount or 0, "0",
        order_id=payment.order_id, payment_id=payment.id,
        debit_account=ACC_GATEWAY, credit_account=ACC_RECEIVABLE,
        payment_method=method or getattr(payment, "method", None),
        reference_number=getattr(payment, "transaction_id", None),
        idempotency_key=f"PAYMENT:{payment.id}",
        tally_voucher_type="Receipt",
    )


def order_tax_split(db: Session, order, amount) -> tuple:
    """(cgst, sgst, igst) for `amount` of this order, pro-rated from the real
    OrderItem figures (wave A §5).

    Shared by the sale (called with order.total_amount) and the credit note
    (called with the refund amount) so both credit and debit identical ledgers.

    Replaces the old tax/2 half-split, which ignored per-line GST rates and filed
    IGST as 0 whenever the jurisdiction was unknown.

    Falls back to a zero split when the order total is unusable (the caller then
    posts a taxable-only voucher), and to a same-state half-split only when the
    items carry no split tax at all. Neither fallback is signalled to the caller,
    so tax inferred this way is a CA review item, not something surfaced here.
    """
    from app.models.order import OrderItem
    total = _d(getattr(order, "total_amount", 0) or 0)
    amt = _d(amount)
    if total <= 0 or amt <= 0:
        return Decimal("0.00"), Decimal("0.00"), Decimal("0.00")
    ratio = amt / total
    try:
        items = db.query(OrderItem).filter_by(order_id=order.id).all()
    except Exception:
        items = []
    c = sum((_d(i.cgst_amount) for i in items), Decimal("0.00")) * ratio
    s = sum((_d(i.sgst_amount) for i in items), Decimal("0.00")) * ratio
    i = sum((_d(i.igst_amount) for i in items), Decimal("0.00")) * ratio
    if c + s + i <= 0:  # items carry no split tax; derive from the order tax
        tax = _d(getattr(order, "tax_amount", 0) or 0) * ratio
        half = (tax / 2).quantize(_Q, rounding=ROUND_HALF_UP)
        return half, tax - half, Decimal("0.00")
    # Quantize HERE, not at post time: the caller derives the taxable leg from
    # these figures and post_voucher rounds each leg on its own, so returning
    # unrounded values made a voucher's legs miss the amount by a paisa.
    return (_d(c), _d(s), _d(i))


def record_refund_from_refund(db: Session, business_id: str, refund, order=None) -> list:
    """Credit Note (reverses revenue + GST) plus the gateway payout (§5).

    Both vouchers are required and they net: the credit note re-creates the
    receivable, the payout clears it. A single event cannot express this, which
    is why GST on credit notes was always zero before.
    """
    o = order
    if o is None:
        try:
            from app.models.order import Order
            o = db.query(Order).filter_by(id=refund.order_id).first()
        except Exception:
            o = None
    amt = _d(getattr(refund, "amount", 0) or 0)
    # Refund carries no tax column, so tax comes from the order's own GST split
    # (the same one the sale credited) pro-rated to this refund.
    cgst, sgst, igst = order_tax_split(db, o, amt) if o is not None else (Decimal("0.00"),) * 3
    tax = cgst + sgst + igst
    taxable = amt - tax
    # No reference_number here: one refund now writes several vouchers, and
    # tally_service derives voucher_number from reference_number, so sharing
    # shopify_refund_id across all of them collided and blocked the whole export
    # (VOUCHER_NOT_UNIQUE). The refund is still linked by refund_id. Wave B can
    # group these legs into one real Tally Credit Note once it owns that mapping.
    rows: list = []
    # A negative taxable (order tax above its total, or a refund above the order)
    # still posts: dropping it left the receivable funded with no matching
    # revenue reversal. It goes negative on the Sales side of the same account.
    if taxable != 0:
        rows += post_voucher(
            db, business_id, "REFUND",
            [{"debit": ACC_SALES, "credit": ACC_RECEIVABLE, "amount": taxable}],
            order_id=refund.order_id, refund_id=refund.id,
            transaction_date=getattr(refund, "created_at", None),
            voucher_key=f"REFUND:{refund.id}:taxable",
            tally_voucher_type="Credit Note")
    for acct, val in ((ACC_OUTPUT_CGST, cgst), (ACC_OUTPUT_SGST, sgst), (ACC_OUTPUT_IGST, igst)):
        if val > 0:
            # tax_amount = the GST itself, so post_voucher derives net_amount 0
            # and revenue_summary subtracts this tax instead of adding it.
            rows += post_voucher(
                db, business_id, "REFUND",
                [{"debit": acct, "credit": ACC_RECEIVABLE, "amount": val,
                  "tax_amount": val}],
                order_id=refund.order_id, refund_id=refund.id,
                transaction_date=getattr(refund, "created_at", None),
                voucher_key=f"REFUND:{refund.id}:{acct}",
                tally_voucher_type="Credit Note")
    if amt > 0:
        rows += post_voucher(
            db, business_id, "REFUND_PAYOUT",
            [{"debit": ACC_RECEIVABLE, "credit": ACC_GATEWAY, "amount": amt}],
            order_id=refund.order_id, refund_id=refund.id,
            transaction_date=getattr(refund, "created_at", None),
            voucher_key=f"REFUND_PAYOUT:{refund.id}",
            tally_voucher_type="Receipt")
    return rows


def record_cancellation(db: Session, business_id: str, order,
                        refund_required=None) -> list:
    """Void marker only (§2).

    A paid cancellation keeps its sale on the books until the refund actually
    posts: an unpaid liability is visible to an auditor, a silent write-off is
    not. No amount is ever carried here, so CANCELLATION cannot be double-
    counted against a REFUND.

    `refund_required` is DEPRECATED and ignored. It used to decide whether the
    full order total was written here, which double-counted every paid
    cancellation against its own refund. It is kept only so existing callers and
    tests keep working; nothing reads it.
    """
    return post_voucher(
        db, business_id, "CANCELLATION",
        [{"debit": ACC_SALES_RETURNS, "credit": ACC_RECEIVABLE, "amount": "0.00"}],
        order_id=order.id, transaction_date=getattr(order, "cancelled_at", None),
        reference_number=getattr(order, "cancel_reason", None),
        voucher_key=f"CANCELLATION:{order.id}")


def order_timeline(db: Session, business_id: str, order_id: str) -> list[dict]:
    """The stored ledger rows for one order, oldest first.

    Each row is reported as the double entry it already is: a post_voucher leg
    names its own debit and credit accounts, so re-deriving the entry through
    to_double_entry was wrong once a sale became multi-leg -- its legacy
    whole-sale branch gave every GST leg a zero-value credit plus a credit to
    "Output GST", a ledger that does not exist in the chart.
    """
    rows = db.query(FinancialTransaction).filter_by(
        business_id=business_id, order_id=order_id).order_by(
        FinancialTransaction.transaction_date).all()
    return [{
        "transaction_id": r.transaction_id, "transaction_type": r.transaction_type,
        "amount": str(r.amount), "tax_amount": str(r.tax_amount), "net_amount": str(r.net_amount),
        "currency": r.currency, "transaction_date": r.transaction_date.isoformat() if r.transaction_date else None,
        "transaction_date_ist": to_ist_iso(r.transaction_date),
        "debit_account": r.debit_account, "credit_account": r.credit_account,
        "pnl_class": r.pnl_class,
        "double_entry": [{"debit": r.debit_account, "credit": r.credit_account,
                          "amount": str(r.amount)}],
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
             "tax_amount": str(r.tax_amount), "pnl_class": r.pnl_class} for r in rows]
    rev = revenue_summary(txns)

    # Direct costs are read per leg, not per transaction_type (wave A §8). One
    # consistent rule, applied in this order:
    #
    #   1. The CLASS decides whether a leg touches profit at all (COGS or EXPENSE).
    #      Read through pnl_class_of, so a legacy row that carries the column default
    #      still classifies by its type.
    #   2. Carrier fees and COD deductions are separated by DEBIT ACCOUNT, because
    #      they share the EXPENSE class with shipping, packaging and gateway fees and
    #      no class can tell them apart. This is the one place keying on an account
    #      name is correct, and it is exact because finance_posting posts those two
    #      legs to the ACC_* names defined here. It applies to EXPENSE-classed legs
    #      only: a COGS-classed leg is taken by rule 1 first, so a mis-classed leg
    #      debited to ACC_CARRIER_FEE lands in `cogs`. The class is the authority on
    #      *whether* a leg is a direct cost; the account only splits the EXPENSE ones.
    #   3. The TYPE picks between the remaining named lines, and `other` is the
    #      RESIDUAL of every other EXPENSE leg. A partition, not a wish list: a direct
    #      cost is counted exactly once and none is silently dropped.
    #
    # Two classes are deliberately NOT charged as costs here:
    #   TAX - DEFAULT_PNL_CLASS calls it EXPENSE, but GST is collected on behalf of
    #     the government. The SALE voucher's CGST/SGST/IGST legs already carry it in
    #     tax_amount, which revenue_summary nets out of net sales, and a standalone TAX
    #     event is the payment against that liability. Charging it as a cost too takes
    #     the same rupee out of profit twice. The sale side is authoritative.
    #   REVERSAL - revenue_summary already nets reversals against revenue, so adding
    #     them to the cost side would reverse the same row twice. The cost of an
    #     expense reversal (a carrier claim) is therefore not yet netted off the cost
    #     it reimburses; nothing writes one today.
    lines: dict[str, Decimal] = {}
    for r in rows:
        cls = pnl_class_of({"transaction_type": r.transaction_type, "pnl_class": r.pnl_class})
        if cls == "COGS":
            line = "cogs"
        elif cls != "EXPENSE" or r.transaction_type == "TAX":
            continue
        elif r.debit_account == ACC_CARRIER_FEE:
            line = "carrier_fees"
        elif r.debit_account == ACC_COD_DEDUCTION:
            line = "cod_deductions"
        elif r.transaction_type == "SHIPPING_EXPENSE":
            line = "shipping"
        elif r.transaction_type == "PACKAGING_EXPENSE":
            line = "packaging"
        elif r.transaction_type == "PAYMENT_GATEWAY_FEE":
            line = "gateway_fees"
        else:
            line = "other"
        lines[line] = lines.get(line, Decimal("0")) + _d(r.amount)

    def _line(name: str) -> str:
        return _s(lines.get(name, Decimal("0")))

    cogs_v = _line("cogs")
    ship_v, pack_v, fee_v, other_v = (
        _line("shipping"), _line("packaging"), _line("gateway_fees"), _line("other"))
    carrier_v, ded_v = _line("carrier_fees"), _line("cod_deductions")

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
                            costs_complete=(missing == 0), missing_cogs_count=missing,
                            carrier_fees=carrier_v, cod_deductions=ded_v)
    return {
        "revenue": rev, "profit": profit,
        "cogs_total": cogs_v, "transaction_count": len(rows),
        "display_timezone": DISPLAY_TZ,
        "period": {"from": _utc(start).isoformat(), "to": _utc(end).isoformat()},
    }
