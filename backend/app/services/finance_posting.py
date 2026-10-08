"""Domain-derived ledger postings (wave A §6).

Every function is idempotent on a stable voucher key and returns the posted
legs, or None when nothing is due. Balance is enforced upstream by post_voucher,
so a caller never has to re-check it.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.services import ledger_service as ls
from app.services.ledger_service import _d

_TOLERANCE = Decimal("1.00")  # carriers round settlements to the rupee


class CodSettlementMismatch(ValueError):
    """A carrier settlement whose net + fee + deductions != settled amount.

    Posting it would book money that the carrier never sent, so it is refused
    and surfaced instead.
    """


class CodCollectionMissing(ValueError):
    """A settlement for a shipment that never raised a COD collection.

    The remit debits Cash / Bank and credits COD Receivable, so without the
    collection it banks a payment of nothing and credits an account that was
    never debited. Refused, because the alternative -- posting it -- leaves two
    wrong entries on the books instead of one visible gap.
    """


def _is_cod(order) -> bool:
    return (getattr(order, "cod_mode", "") or "").strip().upper() == "COD"


def _has_collection(db: Session, business_id: str, shipment_id: str) -> bool:
    """Whether COD_COLLECTION was posted for this shipment.

    Matched on the voucher group rather than the order: one COD order can ship
    in several parcels, and only the parcel the carrier settled clears its own
    receivable.
    """
    from app.models.financial_transaction import FinancialTransaction
    return db.query(FinancialTransaction).filter_by(
        business_id=business_id,
        voucher_group_id=f"COD_COLLECTION:{shipment_id}",
        transaction_type="COD_COLLECTION").first() is not None


def record_cod_collection_from_shipment(db: Session, business_id: str, shipment,
                                        order=None) -> list | None:
    """On delivery of a COD order, move the debt from the customer to the
    carrier (§6). Without this the COD loop cannot close: COD_REMIT would have
    nothing to credit.

    The amount is the order's own cod_value, i.e. what the courier collected from
    the customer at the door, dated delivered_at. ShipmentFinancial is NOT the
    source: that row is written when the carrier statement is processed, which
    is days after the delivery this posts on, so reading it would leave the
    receivable unfunded for that whole window (and the courier holds the cash in
    the meantime). expected_cod_amount is not the source either -- it is what
    the shipment was *expected* to collect, an estimate the SLA process fills in
    before anyone has collected anything.

    `order` is a prefetch seam: ensure_period_postings loops this over a whole
    period and loads the orders once, so it never issues one Order query per
    shipment. Omit it when handling a single shipment.

    KNOWN GAP: orders.py lets cod_value be edited independently of total_amount,
    so when they differ the SALE debited Customer / Receivable at the order total
    while this and COD_REMIT only move COD Receivable, and the difference stays
    open on the books. Closing it is a decision about which figure the sale
    should have used, not a local fix here.
    """
    from app.models.order import Order
    if order is None:
        order = db.query(Order).filter_by(id=shipment.order_id).first()
    if order is None or not _is_cod(order):
        return None
    if (shipment.tracking_status or "").upper() != "DELIVERED":
        return None
    amount = _d(order.cod_value or order.total_amount)
    if amount <= 0:
        # order_service.create_manual_order defaults cod_mode="COD" with
        # total_amount=cod_value or 0, so a COD order can carry no amount at all.
        # Posting 0.00 would be balanced and would CONSUME the voucher key, and
        # the real figure arriving later would then be dropped as a replay.
        return None
    return ls.post_voucher(
        db, business_id, "COD_COLLECTION",
        [{"debit": ls.ACC_COD_RECEIVABLE, "credit": ls.ACC_RECEIVABLE,
          "amount": amount, "pnl_class": "NONE"}],
        order_id=order.id, transaction_date=shipment.delivered_at,
        reference_number=shipment.awb_number,
        voucher_key=f"COD_COLLECTION:{shipment.id}")


def record_cod_remittance_from_shipment_financial(db: Session, business_id: str, sf,
                                                 order=None) -> list | None:
    """Post a carrier COD settlement (§6).

    Dr Bank (net) / Dr Carrier Fee / Dr COD Deduction / Cr COD Receivable.

    Only the fee and deduction legs are EXPENSE; the bank and receivable legs are
    NONE, so the settlement clears a balance-sheet account without touching P&L.

    `order` is a prefetch seam, for the same reason as in
    record_cod_collection_from_shipment: the period loop loads the orders once.

    Returns None when the shipment has not been settled yet, or when its order is
    not COD. Raises, writing nothing, when the settlement cannot be posted as it
    stands:

        CodSettlementMismatch - net + fee + deductions does not equal the settled
            amount (beyond the ₹1 carriers round by), so the carrier's own figures
            contradict each other.
        CodCollectionMissing - no COD collection was raised for this shipment.
        ValueError - a negative component, which this voucher shape cannot
            express: a carrier clawback is a reversal, not a settlement.

    KNOWN GAP: the voucher key is `COD_REMIT:{sf.id}` and ShipmentFinancial is
    UNIQUE per shipment, so a supplementary or corrected carrier settlement
    updates that same row and a re-post is swallowed as an idempotent replay --
    COD Receivable keeps the first, superseded figure. Correcting a posted
    settlement needs a reversal against the original voucher, and the ledger has
    no notion of reversing a multi-leg carrier remit yet. Until it does,
    ensure_period_postings detects the disagreement and reports it as
    `correction_pending` rather than claiming the re-post took effect.
    """
    from app.models.order import Order
    # The statuses actually written to ShipmentFinancial.status by the statement
    # processor (api/statements.py). Not RECONCILED or COMPLETED: nothing writes
    # those here, and a partially-matched remittance is still money the carrier
    # paid, which must reach the bank rather than sit open forever.
    if (sf.status or "").upper() not in ("SETTLED", "PARTIALLY_SETTLED"):
        return None
    if order is None:
        order = db.query(Order).filter_by(id=sf.order_id).first()
    if order is None or not _is_cod(order):
        return None
    net, fee, ded = _d(sf.net_settlement), _d(sf.fee_amount), _d(sf.other_deduction)
    settled = _d(sf.settled_amount)
    if net < 0 or fee < 0 or ded < 0:
        raise ValueError(
            f"Settlement {sf.settlement_reference or sf.id} has a negative component: "
            f"net {net}, fee {fee}, other deductions {ded}. A clawback is a reversal "
            "against the original settlement, not a remittance; post it as one.")
    # net + fee + deductions is the gross the carrier collected and is remitting;
    # it is what COD Receivable was raised for, so the receivable is credited with
    # it and the voucher balances by construction.
    cleared = net + fee + ded
    if abs(cleared - settled) > _TOLERANCE:
        raise CodSettlementMismatch(
            f"Settlement {sf.settlement_reference or sf.id} does not reconcile: "
            f"net {net} + fee {fee} + deductions {ded} = {cleared} != settled {settled}.")
    if cleared <= 0:
        return None
    if not _has_collection(db, business_id, sf.shipment_id):
        raise CodCollectionMissing(
            f"Settlement {sf.settlement_reference or sf.id} has no COD_COLLECTION for "
            f"shipment {sf.shipment_id}, so COD Receivable was never raised for it. "
            "Post the delivery collection before the remittance.")
    legs = []
    if net > 0:
        legs.append({"debit": ls.ACC_BANK, "credit": "", "amount": net, "pnl_class": "NONE"})
    if fee > 0:
        legs.append({"debit": ls.ACC_CARRIER_FEE, "credit": "", "amount": fee,
                     "pnl_class": "EXPENSE"})
    if ded > 0:
        legs.append({"debit": ls.ACC_COD_DEDUCTION, "credit": "", "amount": ded,
                     "pnl_class": "EXPENSE"})
    legs.append({"debit": "", "credit": ls.ACC_COD_RECEIVABLE, "amount": cleared,
                 "pnl_class": "NONE"})
    return ls.post_voucher(
        db, business_id, "COD_REMIT", legs,
        order_id=sf.order_id, transaction_date=sf.settlement_date,
        reference_number=sf.settlement_reference,
        voucher_key=f"COD_REMIT:{sf.id}")


# --- Period cost postings and the orchestrator (wave A §7) ---

# Expense accounts for the three flat-rate cost writers. ledger_service has ACC_*
# constants for the balance-sheet and sales names but none for these; these match
# the debit names to_double_entry has always derived from the transaction type, so
# the Tally Expenses sheet names the same ledger whether the row came from here or
# from a hand-posted event.
ACC_SHIPPING_EXPENSE = "Shipping Expense"
ACC_PACKAGING_EXPENSE = "Packaging Expense"
ACC_GATEWAY_FEE_EXPENSE = "Payment Gateway Fee"

# The flat-rate cost writers: report key, voucher type, CostRule key, debit
# account, credit account, and whether the rate is charged per order or per
# shipment. One table, so the report key, the voucher key prefix, the account and
# the rule can never drift apart.
_FLAT_COSTS = (
    ("shipping", "SHIPPING_EXPENSE", "SHIPPING",
     ACC_SHIPPING_EXPENSE, ls.ACC_BANK, "shipment"),
    ("packaging", "PACKAGING_EXPENSE", "PACKAGING",
     ACC_PACKAGING_EXPENSE, ls.ACC_BANK, "order"),
    ("gateway_fee", "PAYMENT_GATEWAY_FEE", "GATEWAY_FEE",
     ACC_GATEWAY_FEE_EXPENSE, ls.ACC_GATEWAY, "order"),
)

_COGS_RULE = "COGS_DEFAULT"

# The two halves of _FLAT_COSTS, named for what the rate is charged per and with the
# per-record marker dropped, so the posting loops unpack five fields and never
# re-filter the table. Split once here rather than per record.
_PER_ORDER = tuple(e[:5] for e in _FLAT_COSTS if e[5] == "order")
_PER_SHIPMENT = tuple(e[:5] for e in _FLAT_COSTS if e[5] == "shipment")

# Outcome names reported per record. Anything that did not write is reported by
# WHY it did not write, because the counters alone cannot separate "already on
# file" from "we have no cost data for this order" -- and that second one is the
# condition month-close's missing_cogs check exists to catch.
_OUT_POSTED = "posted"
_OUT_BACKFILLED = "posted_with_backfill"
_OUT_SHORTFALL = "posted_with_shortfall"
_OUT_WOULD = "would_post"
_OUT_WOULD_BACKFILL = "would_post_with_backfill"
_OUT_WOULD_SHORTFALL = "would_post_with_shortfall"
_OUT_ALREADY = "already_posted"
_OUT_NOTHING_DUE = "nothing_due"
_OUT_NO_RATE = "no_rate_in_force"
_OUT_NO_COSTED_LINE = "no_costed_line"
_OUT_CORRECTION = "correction_pending"
_OUT_SKIPPED = "skipped"
_OUT_ERROR = "error"

# Which counter each outcome moves. Written out rather than reusing the outcome
# string as a counter key, so the reporting vocabulary and the summary counters
# are two things that can be read apart. Everything absent counts as skipped.
_COUNTER_FOR = {
    _OUT_POSTED: "posted",
    _OUT_BACKFILLED: "posted",
    _OUT_SHORTFALL: "posted",
    _OUT_WOULD: "would_post",
    _OUT_WOULD_BACKFILL: "would_post",
    _OUT_WOULD_SHORTFALL: "would_post",
}


def _ts(dt) -> datetime:
    """UTC-normalize a period bound.

    Takes what month_window hands back, and also the ISO strings the Tally export
    is called with -- ledger_service._utc raises on a str.
    """
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    return ls._utc(dt)


def _counters() -> dict:
    return {"posted": 0, "skipped": 0, "would_post": 0}


def _slot(bucket: dict, key: str) -> dict:
    """The counter shape every report key uses: posted / skipped / would_post."""
    return bucket.setdefault(key, _counters())


def _blank_costs() -> dict:
    """Every cost key present at zero, so a dry run always reports the same shape."""
    return {"cogs": _counters(), **{key: _counters() for key, *_ in _FLAT_COSTS}}


def _why(exc: Exception) -> str:
    """Name a failure, so an operator sees which record failed and how."""
    return f"{type(exc).__name__}: {exc}"


def _attempt(work):
    """Run one step and turn any failure into an exception to report, not to raise.

    This is what keeps a step's failure from ending its siblings. A period loop is
    exactly the place where one bad record silently costs every other record its
    posting: the backfill call below sits inside a handler, so an exception from it
    reaches none of that handler's siblings.
    """
    try:
        return work(), None
    except Exception as err:  # noqa: BLE001 - one step must not lose the record
        return None, err


def _isolated(db: Session, work, *, dry_run: bool):
    """Run `work()` in its own SAVEPOINT so a dry run structurally writes nothing.

    Returns ``(result, exc)``; `exc` is None when `work()` completed. A dry run and
    a failure both roll the SAVEPOINT back, so nothing a dry run touched survives
    and a failure never leaves a half-written voucher behind. On a live run the
    SAVEPOINT is released, so work that succeeded before a later step failed keeps
    its posting -- a raised COD collection is correct on its own even if the
    remittance it was raised for then turns out not to post.
    """
    savepoint = db.begin_nested()
    result, exc = _attempt(work)
    if dry_run or exc is not None:
        savepoint.rollback()
    else:
        savepoint.commit()
    return result, exc


def _posted_groups(db: Session, business_id: str, keys) -> dict:
    """One query for the whole period: group id -> its (debit, credit, amount) legs.

    The idempotency check used to be a query per posting, which in a period loop
    is a query per order and per shipment. Keys are fitted the way post_voucher
    fits them, so a long key is looked up in the form it is stored in.
    """
    from app.models.financial_transaction import FinancialTransaction
    out: dict[str, list] = {}
    wanted = sorted({ls._fit_key(k) for k in keys})
    if not wanted:
        return out
    for r in db.query(FinancialTransaction).filter_by(business_id=business_id).filter(
            FinancialTransaction.voucher_group_id.in_(wanted)).all():
        out.setdefault(r.voucher_group_id, []).append(
            (r.debit_account or "", r.credit_account or "", _d(r.amount)))
    return out


def _legs_of(groups: dict, key: str):
    """The legs on file for this voucher key, or None if it never posted.

    Every lookup goes through ls._fit_key because that is how post_voucher stores
    it. Testing the raw key against a dict of fitted keys works only until a key
    passes 128 characters, at which point the report would claim `posted` forever
    while post_voucher silently swallowed the replay.
    """
    return groups.get(ls._fit_key(key))


def _on_file(groups: dict, key: str) -> bool:
    return _legs_of(groups, key) is not None


def _credited(groups: dict, key: str, account: str) -> Decimal | None:
    """What the voucher on file credited to `account`, or None if it never posted."""
    legs = _legs_of(groups, key)
    if legs is None:
        return None
    return sum((a for _dr, cr, a in legs if cr == account), Decimal("0.00"))


def _debited(groups: dict, key: str, account: str) -> Decimal | None:
    """What the voucher on file debited to `account`, or None if it never posted."""
    legs = _legs_of(groups, key)
    if legs is None:
        return None
    return sum((a for dr, _cr, a in legs if dr == account), Decimal("0.00"))


def _cod_cleared(sf) -> Decimal:
    """The gross the carrier settled: net plus fees plus other deductions."""
    return _d(sf.net_settlement) + _d(sf.fee_amount) + _d(sf.other_deduction)


def _cod_collected(order) -> Decimal:
    """What a COD_COLLECTION raises for this order: what the courier took at the door."""
    if order is None:
        return Decimal("0.00")
    return _d(order.cod_value or order.total_amount)


def _cod_residual(collected: Decimal | None, sf) -> tuple[Decimal, Decimal] | None:
    """(collected, cleared) when the two disagree by more than carrier rounding.

    The collection raises what the order was worth and the remittance credits COD
    Receivable with what the carrier actually paid, so any short or partial
    collection leaves a residual on the account. That is a real business signal --
    a refusal, an RTO, a short delivery -- and not a posting error: it is reported
    with both figures and left on the books, never silently written off.
    """
    if collected is None:
        return None  # nothing was raised, which the remit writer refuses outright
    cleared = _cod_cleared(sf)
    return None if abs(collected - cleared) <= _TOLERANCE else (collected, cleared)


def _one_cost_record(db: Session, business_id: str, legs_fn, *, vtype: str, key: str,
                     order, reference, dry_run: bool,
                     nothing_due: tuple[str, str]) -> tuple[str, str]:
    """Price and post ONE cost voucher, isolated in its own SAVEPOINT.

    `legs_fn` returns the legs, or None when nothing is due for this record --
    which it signals as `nothing_due` rather than this function inventing a second
    vocabulary. Everything it raises is contained here, because a get_cost or
    database error on one record must cost that record its posting and not the
    whole period's.
    """
    def work():
        legs = legs_fn()
        if legs is None:
            return nothing_due
        if dry_run:
            return (_OUT_WOULD, "")
        ls.post_voucher(db, business_id, vtype, legs, order_id=order.id,
                        transaction_date=order.order_date,
                        reference_number=reference, voucher_key=key)
        return (_OUT_POSTED, "")

    outcome, exc = _isolated(db, work, dry_run=dry_run)
    if exc is not None:
        return (_OUT_ERROR, _why(exc))
    return outcome


def post_period_costs(db: Session, business_id: str, start, end, *,
                      dry_run: bool = False) -> dict:
    """Post the period's COGS, freight, packaging and gateway fees (§7).

    Freight is per shipment, the rest are per order. Cost figures come from
    ProductCostHistory where available and CostRule otherwise, so the source of
    each number stays traceable and monthly_report's ESTIMATED label stays honest.

    Every voucher is keyed `TYPE:{record id}`, so this is idempotent per record:
    a repeat run reports the record as already_posted rather than appending a
    second voucher. Each leg names both of its accounts -- a leg with one side
    empty contributes 0 to that side and balances trivially, so a passing balance
    check would not prove the accounts are right.

    Returns the four counters the brief's interface fixes, plus `records`: one
    entry per record considered, saying which record it was and why it did or did
    not post. The counters alone cannot separate "the period is fully posted"
    from "120 orders have no cost data", and month-close needs to tell those apart.

    Every record is individually isolated, so no single record can abort its
    siblings, and nothing raises out of here for a record-level problem. Failures
    are reported in `records` with the exception named. A dry run writes nothing
    because each record's SAVEPOINT is rolled back, not because any branch is
    skipped -- and not by rolling the session back, which would discard the
    caller's own uncommitted work.
    """
    from app.models.order import Order, OrderItem
    from app.models.shipment import Shipment
    from app.services.cost_service import get_cost

    bucket = _blank_costs()
    records: list[dict] = []
    start, end = _ts(start), _ts(end)
    orders = db.query(Order).filter_by(business_id=business_id).filter(
        Order.order_date >= start, Order.order_date < end).all()
    by_order = {o.id: o for o in orders}
    ships = db.query(Shipment).filter(
        Shipment.order_id.in_(list(by_order))).all() if orders else []

    # The cost rule in force at the END of the period. A rate changed mid-period is
    # therefore applied from the next run rather than being backdated into this one.
    anchor = end - timedelta(microseconds=1)
    rates: dict[str, Decimal] = {}
    rule_errors: dict[str, str] = {}
    for rule in (_COGS_RULE, *(e[2] for e in _FLAT_COSTS)):
        # A failed rule lookup is recorded, not turned into a silent zero rate that
        # would then read as "no cost configured" for every order in the period.
        amount, exc = _isolated(
            db, lambda rule=rule: get_cost(db, business_id, rule, anchor)[0],
            dry_run=True)
        if exc is not None:
            rates[rule] = Decimal("0.00")
            rule_errors[rule] = _why(exc)
        else:
            rates[rule] = _d(amount)
    items_by_order: dict[str, list] = {}
    for it in db.query(OrderItem).filter(
            OrderItem.order_id.in_(list(by_order))).all():
        items_by_order.setdefault(it.order_id, []).append(it)

    groups = _posted_groups(db, business_id, [
        *(f"{e[1]}:{o.id}" for o in orders for e in _PER_ORDER),
        *(f"{e[1]}:{s.id}" for s in ships for e in _PER_SHIPMENT),
        *(f"COGS:{o.id}" for o in orders),
    ])

    def _record(report_key, outcome, *, order=None, shipment_id=None, key=None,
                reason="") -> None:
        _slot(bucket, report_key)[_COUNTER_FOR.get(outcome, "skipped")] += 1
        records.append({
            "cost_type": report_key,
            "order_id": getattr(order, "id", None),
            "shipment_id": shipment_id,
            "voucher_key": key,
            "outcome": outcome,
            "reason": reason,
        })

    def _run(report_key, vtype, rule, key, order, legs_fn, *, shipment_id=None,
             reference=None, nothing_due) -> None:
        # A rule that could not be read is a failure of THIS record, not a statement
        # that no cost is configured -- so it is reported as an error rather than
        # folded into the "no rate in force" case for every order in the period.
        if rule in rule_errors:
            _record(report_key, _OUT_ERROR, order=order, shipment_id=shipment_id,
                    key=key, reason=rule_errors[rule])
            return
        if _on_file(groups, key):
            _record(report_key, _OUT_ALREADY, order=order, shipment_id=shipment_id,
                    key=key, reason="voucher already on file")
            return
        outcome, reason = _one_cost_record(
            db, business_id, legs_fn, vtype=vtype, key=key, order=order,
            reference=reference, dry_run=dry_run, nothing_due=nothing_due)
        _record(report_key, outcome, order=order, shipment_id=shipment_id,
                key=key, reason=reason)

    def _cogs_legs(o):
        """COGS for one order from its priced lines, or None when none is costed."""
        total = Decimal("0.00")
        for it in items_by_order.get(o.id, []):
            unit, _src = get_cost(db, business_id, _COGS_RULE, anchor,
                                  product_id=it.product_id)
            total += _d(unit) * int(it.quantity or 0)  # Decimal throughout, never the float
        total = _d(total)
        if total <= 0:
            return None
        return [{"debit": ls.ACC_COGS, "credit": ls.ACC_INVENTORY,
                 "amount": total, "pnl_class": "COGS"}]

    def _flat_legs(rule, debit, credit):
        """The flat-rate leg, or None when no rule is in force for this period."""
        if rates[rule] <= 0:
            return None
        return [{"debit": debit, "credit": credit, "amount": rates[rule],
                 "pnl_class": "EXPENSE"}]

    # COGS: priced per line, so it is not the flat rate. The default argument binds
    # `o` now, because legs_fn is called later, inside the isolation.
    for o in orders:
        _run("cogs", "COGS", _COGS_RULE, f"COGS:{o.id}", o,
             lambda o=o: _cogs_legs(o),
             nothing_due=(_OUT_NO_COSTED_LINE,
                          "no line on this order has a cost in force"))

    # Packaging and gateway fee: a flat rate each, charged per order.
    for o in orders:
        for report_key, vtype, rule, debit, credit in _PER_ORDER:
            _run(report_key, vtype, rule, f"{vtype}:{o.id}", o,
                 lambda rule=rule, debit=debit, credit=credit: _flat_legs(rule, debit, credit),
                 nothing_due=(_OUT_NO_RATE, f"no {rule} CostRule in force for this period"))

    # Freight is per shipment, dated on its order so it lands in the same period.
    for s in ships:
        for report_key, vtype, rule, debit, credit in _PER_SHIPMENT:
            _run(report_key, vtype, rule, f"{vtype}:{s.id}", by_order[s.order_id],
                 lambda rule=rule, debit=debit, credit=credit: _flat_legs(rule, debit, credit),
                 shipment_id=s.id, reference=s.awb_number,
                 nothing_due=(_OUT_NO_RATE, f"no {rule} CostRule in force for this period"))

    return {**bucket, "records": records}


def _backfill_collection(db: Session, business_id: str, sf, order, shipment, original, *,
                         dry_run: bool) -> tuple[str, str, tuple | None]:
    """OUR collection was never raised. Raise it, then post the remittance.

    Every step is individually attempted, and that is the whole point: the
    collection write is dated on `delivered_at`, so a shipment delivered in an
    ALREADY-CLOSED month raises ClosedPeriodError from post_voucher's guard. That
    call sits inside a handler, so an exception from it reaches none of that
    handler's siblings and would abort every other settlement in the period -- and
    the endpoint's rollback would take the cost rows down with it. It is caught
    here, named, and reported against this one shipment.

    The two steps share the caller's SAVEPOINT on purpose. A dry run rolls it back
    once at the end, so the collection raised here is visible to the remittance
    step that follows; a per-step rollback would hide it and the remittance would
    refuse as though nothing had been backfilled.
    """
    if shipment is None:
        return (_OUT_SKIPPED,
                f"no COD collection and shipment {sf.shipment_id} is not on file: {original}",
                None)
    raised, exc = _attempt(lambda: record_cod_collection_from_shipment(
        db, business_id, shipment, order=order))
    if exc is not None:
        return (_OUT_SKIPPED, f"collection backfill failed: {_why(exc)}", None)
    if raised is None:
        # Nothing was collectable at the door, so this is not a failure: the courier
        # has not been handed the customer's cash yet and there is no receivable to
        # clear. Report it and move on.
        return (_OUT_NOTHING_DUE,
                "shipment is not delivered, so no COD collection is due"
                if (shipment.tracking_status or "").upper() != "DELIVERED"
                else "the order carries no collectable amount, so no COD collection "
                     "could be raised",
                None)
    _, exc = _attempt(lambda: record_cod_remittance_from_shipment_financial(
        db, business_id, sf, order=order))
    if exc is not None:
        return (_OUT_SKIPPED, f"collection backfill did not clear the remit: {_why(exc)}",
                None)
    # The backfill raised exactly this figure, so the residual can be read off the
    # order without touching the voucher rows -- which a dry run is about to roll
    # back and which must not be depended on.
    residual = _cod_residual(_cod_collected(order), sf)
    return _settled_outcome(dry_run, residual, backfilled=True) + (residual,)


def _settle_refusal(db: Session, business_id: str, sf, order, shipment, exc, *,
                    dry_run: bool) -> tuple[str, str, tuple | None]:
    """What to DO about a remittance the writer refused, told apart by type.

    Never by a bare ValueError: the three conditions mean different things, and
    one of them (a missing collection) is recoverable.
    """
    if isinstance(exc, CodCollectionMissing):
        return _backfill_collection(db, business_id, sf, order, shipment, exc,
                                    dry_run=dry_run)
    if isinstance(exc, CodSettlementMismatch):
        return (_OUT_SKIPPED, f"settlement does not reconcile: {exc}", None)
    if isinstance(exc, ValueError):
        # A negative component is a carrier clawback, which is a reversal, or the
        # period is closed. Either way: reported, never posted.
        return (_OUT_SKIPPED, f"not postable as a remittance: {exc}", None)
    return (_OUT_ERROR, _why(exc), None)


def _settled_outcome(dry_run: bool, residual, *, backfilled: bool) -> tuple[str, str]:
    """The outcome for a remittance that did land, given any residual it leaves.

    A residual is NOT success. Both vouchers posted, but COD Receivable does not
    reach zero, so the account carries a real shortfall that an operator has to
    see; it is reported with both figures and never written off here.
    """
    if residual is None:
        if dry_run:
            return (_OUT_WOULD_BACKFILL if backfilled else _OUT_WOULD, "")
        return (_OUT_BACKFILLED if backfilled else _OUT_POSTED, "")
    collected, cleared = residual
    return (_OUT_WOULD_SHORTFALL if dry_run else _OUT_SHORTFALL,
            f"collection raised {collected} but the carrier settled {cleared}: COD "
            f"Receivable keeps a residual of {collected - cleared}. Nothing is written "
            "off here; confirm the shortfall and post the difference as an ADJUSTMENT.")


def _post_one_settlement(db: Session, business_id: str, sf, order, shipment,
                         collected, *, dry_run: bool) -> tuple[str, str, tuple | None]:
    """Post (or would post) one carrier settlement. Returns (outcome, reason, residual).

    Never raises for a settlement-level problem. The three conditions that mean
    different things are told apart by type in _settle_refusal, never by a bare
    ValueError:

        CodCollectionMissing - OUR collection was never raised. Every COD shipment
            delivered before the collection writer shipped has none, so the first
            period this runs will hit it; it is backfilled and the remittance is
            then posted, rather than merely skipped.
        CodSettlementMismatch - the carrier's own figures contradict each other.
            Nothing is posted; the settlement is reported.
        ValueError - a negative component (a clawback), which is a reversal, or a
            closed period. Reported, never posted.

    `collected` is what the COD_COLLECTION already on file raised, read from the
    ledger by _cod_report, so a residual is measured against the figure actually
    posted rather than against what the order says today.
    """
    def work():
        rows, exc = _attempt(lambda: record_cod_remittance_from_shipment_financial(
            db, business_id, sf, order=order))
        if exc is not None:
            return _settle_refusal(db, business_id, sf, order, shipment, exc,
                                   dry_run=dry_run)
        if rows is None:
            return (_OUT_NOTHING_DUE,
                    "shipment not settled yet, or its order is not COD", None)
        residual = _cod_residual(collected, sf)
        return _settled_outcome(dry_run, residual, backfilled=False) + (residual,)

    outcome, exc = _isolated(db, work, dry_run=dry_run)
    if exc is not None:
        # Nothing anticipated this. The settlement loses its posting, named, and
        # the rest of the period carries on.
        return (_OUT_ERROR, _why(exc), None)
    return outcome


def _cod_report(db: Session, business_id: str, start, end, *, dry_run: bool) -> dict:
    """Post every carrier settlement dated in the period, and report each outcome.

    Loads the settlements, their orders and their shipments in three queries and
    one query for the vouchers already on file -- both the remittances and the
    collections, so a residual can be measured without a query per shipment.

    Invariant: posted + skipped + would_post always equals the number of
    settlements in the period. Anything that did not write lands in `skipped`,
    and the `settlements` list says which and why. Two conditions are also
    collected separately because they need an operator's decision rather than a
    retry: `corrections_pending` (a settlement changed after it posted) and
    `shortfalls` (the collection and the remittance disagree, so COD Receivable
    does not reach zero).
    """
    from app.models.order import Order
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial

    cod = _counters()
    cod["settlements"] = []
    cod["corrections_pending"] = []
    cod["shortfalls"] = []
    rows = db.query(ShipmentFinancial).filter_by(business_id=business_id).filter(
        ShipmentFinancial.settlement_date >= start,
        ShipmentFinancial.settlement_date < end).all()
    if not rows:
        return cod
    orders = {o.id: o for o in db.query(Order).filter(
        Order.id.in_([sf.order_id for sf in rows])).all()}
    ships = {s.id: s for s in db.query(Shipment).filter(
        Shipment.id.in_([sf.shipment_id for sf in rows])).all()}
    groups = _posted_groups(db, business_id, [
        *(f"COD_REMIT:{sf.id}" for sf in rows),
        *(f"COD_COLLECTION:{sf.shipment_id}" for sf in rows),
    ])

    for sf in rows:
        entry = {"shipment_financial_id": sf.id, "shipment_id": sf.shipment_id,
                 "order_id": sf.order_id,
                 "settlement_reference": sf.settlement_reference,
                 "outcome": _OUT_SKIPPED, "reason": ""}
        posted = _credited(groups, f"COD_REMIT:{sf.id}", ls.ACC_COD_RECEIVABLE)
        if posted is not None:
            # Already on file. A settlement corrected after it posted keeps the
            # FIRST figure: the key is spent and post_voucher would swallow the
            # re-post as a replay, so the disagreement is reported, not "fixed".
            entry["posted_amount"] = str(posted)
            if abs(posted - _cod_cleared(sf)) > _TOLERANCE:
                entry["outcome"] = _OUT_CORRECTION
                entry["current_amount"] = str(_cod_cleared(sf))
                entry["reason"] = (
                    f"settlement corrected after it posted: COD Receivable was credited "
                    f"{posted} but the settlement now totals {_cod_cleared(sf)}. "
                    "Correcting it needs a reversal of the original COD_REMIT voucher, "
                    "which does not exist yet; post the difference as an ADJUSTMENT.")
                cod["corrections_pending"].append(entry)
            else:
                entry["outcome"] = _OUT_ALREADY
                entry["reason"] = "already posted"
        else:
            entry["outcome"], entry["reason"], residual = _post_one_settlement(
                db, business_id, sf, orders.get(sf.order_id), ships.get(sf.shipment_id),
                _debited(groups, f"COD_COLLECTION:{sf.shipment_id}",
                         ls.ACC_COD_RECEIVABLE),
                dry_run=dry_run)
            if residual is not None:
                entry["collected_amount"] = str(residual[0])
                entry["settled_amount"] = str(residual[1])
                entry["residual_amount"] = str(residual[0] - residual[1])
                cod["shortfalls"].append(entry)
        cod[_COUNTER_FOR.get(entry["outcome"], "skipped")] += 1
        cod["settlements"].append(entry)
    return cod


def ensure_period_postings(db: Session, business_id: str, start, end, *,
                           dry_run: bool = False) -> dict:
    """Single idempotent entry point for every auto-posted period posting (§7).

    Called from the Tally export, from month-close, and from
    POST /api/v1/ledger/post-period-costs. Voucher keys make repeat calls no-ops,
    so calling it on every export is safe. It never commits: the caller owns the
    transaction. It never raises for a record-level problem either: costs and
    carrier settlements are posted one record at a time, each in its own
    SAVEPOINT, and every failure is reported with its exception named.

    A kill switch does not switch the writer off, it switches its writing off.
    With LEDGER_AUTO_POST_COSTS or _COD false the affected writer still evaluates
    every record and reports what it would have posted, and the ledger is
    untouched, so production can be dry-run before it is trusted.

    `auto_posted` is true only when both writers were enabled AND this was not a
    dry run; `switches` and `dry_run` carry the three inputs separately, so
    "switched off" and "asked for a dry run" are never reported as the same thing.
    """
    from app.config import settings

    start, end = _ts(start), _ts(end)
    auto_costs = bool(settings.ledger_auto_post_costs)
    auto_cod = bool(settings.ledger_auto_post_cod)
    costs = post_period_costs(db, business_id, start, end,
                              dry_run=dry_run or not auto_costs)
    cod = _cod_report(db, business_id, start, end,
                      dry_run=dry_run or not auto_cod)
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "costs": costs,
        "cod": cod,
        "auto_posted": auto_costs and auto_cod and not dry_run,
        "switches": {"costs": auto_costs, "cod": auto_cod},
        "dry_run": bool(dry_run),
    }
