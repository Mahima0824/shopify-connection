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

# Outcome names reported per settlement. "posted" and "skipped" also move the
# counters in the same payload; the others are detail: already on file, nothing was
# due, the settlement was corrected after it posted (a reversal is needed, which
# the ledger cannot do yet), or the dry-run shapes of the posting outcomes.
_OUT_POSTED = "posted"
_OUT_BACKFILLED = "posted_with_backfill"
_OUT_SKIPPED = "skipped"
_OUT_REPLAY = "already_posted"
_OUT_NOTHING_DUE = "nothing_due"
_OUT_CORRECTION = "correction_pending"
_OUT_WOULD = "would_post"
_OUT_WOULD_BACKFILL = "would_post_backfill"


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
    """The counter shape every cost report key uses: posted / skipped / would_post.

    `skipped` means nothing was written and here is why -- either the voucher is
    already on file, or no cost rule is in force for the period, or the order
    carries no costed line. The cost payload has no per-record detail, so the
    per-settlement detail lives in ensure_period_postings' `cod` section.
    """
    return bucket.setdefault(key, _counters())


def _blank_costs() -> dict:
    """Every cost key present at zero, so a dry run always reports the same shape."""
    return {"cogs": _counters(), **{key: _counters() for key, *_ in _FLAT_COSTS}}


def _posted_groups(db: Session, business_id: str, keys) -> dict:
    """One query for the whole period: group id -> its (credit_account, amount) legs.

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
        out.setdefault(r.voucher_group_id, []).append((r.credit_account or "", _d(r.amount)))
    return out


def _credited(groups: dict, key: str, account: str) -> Decimal | None:
    """What the voucher on file credited to `account`, or None if it never posted."""
    legs = groups.get(ls._fit_key(key))
    if legs is None:
        return None
    return sum((a for cr, a in legs if cr == account), Decimal("0.00"))


def post_period_costs(db: Session, business_id: str, start, end, *,
                      dry_run: bool = False) -> dict:
    """Post the period's COGS, freight, packaging and gateway fees (§7).

    Freight is per shipment, the rest are per order. Cost figures come from
    ProductCostHistory where available and CostRule otherwise, so the source of
    each number stays traceable and monthly_report's ESTIMATED label stays honest.

    Every voucher is keyed `TYPE:{record id}`, so this is idempotent per record:
    a repeat run reports the record as skipped rather than appending a second
    voucher. Each leg names both of its accounts -- a leg with one side empty
    contributes 0 to that side and balances trivially, so a passing balance check
    would not prove the accounts are right.

    A dry run takes no branch that writes, so it needs no rollback. Deliberate:
    rolling the session back would discard the caller's own uncommitted work, which
    is not this function's to undo.

    Raises ClosedPeriodError (from post_voucher) when the period is closed. That
    is a whole-period condition, not a per-record one, so it is loud rather than
    quietly reported as a skip.
    """
    from app.models.order import Order, OrderItem
    from app.models.shipment import Shipment
    from app.services.cost_service import get_cost

    bucket = _blank_costs()
    start, end = _ts(start), _ts(end)
    orders = db.query(Order).filter_by(business_id=business_id).filter(
        Order.order_date >= start, Order.order_date < end).all()
    by_order = {o.id: o for o in orders}
    ships = db.query(Shipment).filter(
        Shipment.order_id.in_(list(by_order))).all() if orders else []

    # The cost rule in force at the END of the period. A rate changed mid-period is
    # therefore applied from the next run rather than being backdated into this one.
    anchor = end - timedelta(microseconds=1)
    rates = {rule: _d(get_cost(db, business_id, rule, anchor)[0])
             for rule in (_COGS_RULE, *(e[2] for e in _FLAT_COSTS))}
    items_by_order: dict[str, list] = {}
    for it in db.query(OrderItem).filter(
            OrderItem.order_id.in_(list(by_order))).all():
        items_by_order.setdefault(it.order_id, []).append(it)

    groups = _posted_groups(db, business_id, [
        *(f"{e[1]}:{o.id}" for o in orders for e in _PER_ORDER),
        *(f"{e[1]}:{s.id}" for s in ships for e in _PER_SHIPMENT),
        *(f"COGS:{o.id}" for o in orders),
    ])

    def _report(report_key: str, vtype: str, key: str, legs, order, reference=None) -> None:
        if key in groups:
            _slot(bucket, report_key)["skipped"] += 1
        elif dry_run:
            _slot(bucket, report_key)["would_post"] += 1
        else:
            ls.post_voucher(db, business_id, vtype, legs, order_id=order.id,
                            transaction_date=order.order_date,
                            reference_number=reference, voucher_key=key)
            _slot(bucket, report_key)["posted"] += 1

    # COGS: priced per line, so it is not the flat rate.
    for o in orders:
        total = Decimal("0.00")
        for it in items_by_order.get(o.id, []):
            unit, _src = get_cost(db, business_id, _COGS_RULE, anchor,
                                  product_id=it.product_id)
            total += _d(unit) * int(it.quantity or 0)  # Decimal throughout, never the float
        total = _d(total)
        if total <= 0:
            _slot(bucket, "cogs")["skipped"] += 1  # no costed line: nothing due
            continue
        _report("cogs", "COGS", f"COGS:{o.id}",
                [{"debit": ls.ACC_COGS, "credit": ls.ACC_INVENTORY,
                  "amount": total, "pnl_class": "COGS"}], o)

    # Packaging and gateway fee: a flat rate each, charged per order.
    for o in orders:
        for report_key, vtype, rule, debit, credit in _PER_ORDER:
            if rates[rule] <= 0:
                _slot(bucket, report_key)["skipped"] += 1  # no rate in force
                continue
            _report(report_key, vtype, f"{vtype}:{o.id}",
                    [{"debit": debit, "credit": credit, "amount": rates[rule],
                      "pnl_class": "EXPENSE"}], o)

    # Freight is per shipment, dated on its order so it lands in the same period.
    for s in ships:
        for report_key, vtype, rule, debit, credit in _PER_SHIPMENT:
            if rates[rule] <= 0:
                _slot(bucket, report_key)["skipped"] += 1  # no rate in force
                continue
            _report(report_key, vtype, f"{vtype}:{s.id}",
                    [{"debit": debit, "credit": credit, "amount": rates[rule],
                      "pnl_class": "EXPENSE"}], by_order[s.order_id], s.awb_number)

    return bucket


def _post_one_settlement(db: Session, business_id: str, sf, order, shipment, *,
                         dry_run: bool) -> tuple[str, str]:
    """Post (or would post) one carrier settlement. Returns (outcome, reason).

    Never raises for a settlement-level problem. An uncaught raise here would abort
    every other posting in the period, and the three failure conditions need
    different actions, so each is caught by name rather than as a bare ValueError:

        CodCollectionMissing - OUR collection was never raised. Every COD shipment
            delivered before the collection writer shipped has none, so the first
            period this runs will hit it; it is backfilled and the remittance is
            then posted, rather than merely skipped.
        CodSettlementMismatch - the carrier's own figures contradict each other.
            Nothing is posted; the settlement is reported.
        ValueError - a negative component (a clawback), which is a reversal, or a
            closed period. Reported, never posted.

    Everything written happens inside a SAVEPOINT that a dry run always rolls
    back, so `dry_run` is structural rather than a promise about which branches
    happen to be skipped.
    """
    savepoint = db.begin_nested()
    try:
        try:
            rows = record_cod_remittance_from_shipment_financial(
                db, business_id, sf, order=order)
        except CodCollectionMissing as exc:
            if shipment is None:
                outcome = (_OUT_SKIPPED, f"no COD collection and shipment "
                           f"{sf.shipment_id} is not on file: {exc}")
            else:
                # Backfill the collection, then post the remittance against it.
                raised = record_cod_collection_from_shipment(
                    db, business_id, shipment, order=order)
                if raised is None:
                    # Nothing was collectable at the door, so this is not a failure:
                    # the courier has not handed over the customer's cash yet and
                    # there is no receivable to clear. Report it and move on.
                    outcome = (_OUT_NOTHING_DUE,
                               "shipment is not delivered, so no COD collection is due"
                               if (shipment.tracking_status or "").upper() != "DELIVERED"
                               else "the order carries no collectable amount, so no COD "
                                    "collection could be raised")
                else:
                    try:
                        rows = record_cod_remittance_from_shipment_financial(
                            db, business_id, sf, order=order)
                    except CodCollectionMissing as again:
                        outcome = (_OUT_SKIPPED,
                                   f"collection backfill did not clear the remit: {again}")
                    else:
                        outcome = (_OUT_WOULD_BACKFILL if dry_run
                                   else _OUT_BACKFILLED, "")
        except CodSettlementMismatch as exc:
            outcome = (_OUT_SKIPPED, f"settlement does not reconcile: {exc}")
        except ValueError as exc:
            outcome = (_OUT_SKIPPED, f"not postable as a remittance: {exc}")
        except Exception as exc:  # noqa: BLE001 - one bad row must not lose the period
            outcome = (_OUT_SKIPPED, f"{type(exc).__name__}: {exc}")
        else:
            if rows is None:
                outcome = (_OUT_NOTHING_DUE,
                           "shipment not settled yet, or its order is not COD")
            else:
                outcome = (_OUT_WOULD if dry_run else _OUT_POSTED, "")
    finally:
        if dry_run:
            savepoint.rollback()
        else:
            savepoint.commit()
    return outcome


def _cod_report(db: Session, business_id: str, start, end, *, dry_run: bool) -> dict:
    """Post every carrier settlement dated in the period, and report each outcome.

    Loads the settlements, their orders and their shipments in three queries and
    one query for the vouchers already on file, so a period with hundreds of
    settlements does not issue a query per shipment.

    Invariant: posted + skipped + would_post always equals the number of
    settlements in the period. Anything that did not write lands in `skipped`,
    and the `settlements` list says which and why.
    """
    from app.models.order import Order
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial

    cod = _counters()
    cod["settlements"] = []
    cod["corrections_pending"] = []
    rows = db.query(ShipmentFinancial).filter_by(business_id=business_id).filter(
        ShipmentFinancial.settlement_date >= start,
        ShipmentFinancial.settlement_date < end).all()
    if not rows:
        return cod
    orders = {o.id: o for o in db.query(Order).filter(
        Order.id.in_([sf.order_id for sf in rows])).all()}
    ships = {s.id: s for s in db.query(Shipment).filter(
        Shipment.id.in_([sf.shipment_id for sf in rows])).all()}
    groups = _posted_groups(db, business_id, [f"COD_REMIT:{sf.id}" for sf in rows])

    for sf in rows:
        key = f"COD_REMIT:{sf.id}"
        entry = {"shipment_financial_id": sf.id, "shipment_id": sf.shipment_id,
                 "order_id": sf.order_id,
                 "settlement_reference": sf.settlement_reference,
                 "outcome": _OUT_SKIPPED, "reason": ""}
        posted = _credited(groups, key, ls.ACC_COD_RECEIVABLE)
        if posted is not None:
            # Already on file. A settlement corrected after it posted keeps the
            # FIRST figure: the key is spent and post_voucher would swallow the
            # re-post as a replay, so the disagreement is reported, not "fixed".
            entry["posted_amount"] = str(posted)
            current = _d(sf.net_settlement) + _d(sf.fee_amount) + _d(sf.other_deduction)
            if abs(posted - current) > _TOLERANCE:
                entry["outcome"] = _OUT_CORRECTION
                entry["current_amount"] = str(_d(current))
                entry["reason"] = (
                    f"settlement corrected after it posted: COD Receivable was credited "
                    f"{posted} but the settlement now totals {current}. Correcting it "
                    "needs a reversal of the original COD_REMIT voucher, which does not "
                    "exist yet; post the difference as an ADJUSTMENT.")
                cod["corrections_pending"].append(entry)
            else:
                entry["outcome"] = _OUT_REPLAY
                entry["reason"] = "already posted"
            cod[_OUT_SKIPPED] += 1
        else:
            entry["outcome"], entry["reason"] = _post_one_settlement(
                db, business_id, sf, orders.get(sf.order_id),
                ships.get(sf.shipment_id), dry_run=dry_run)
            if entry["outcome"] in (_OUT_POSTED, _OUT_BACKFILLED):
                cod[_OUT_POSTED] += 1
            elif entry["outcome"] in (_OUT_WOULD, _OUT_WOULD_BACKFILL):
                cod[_OUT_WOULD] += 1
            else:
                cod[_OUT_SKIPPED] += 1
        cod["settlements"].append(entry)
    return cod


def ensure_period_postings(db: Session, business_id: str, start, end, *,
                           dry_run: bool = False) -> dict:
    """Single idempotent entry point for every auto-posted period posting (§7).

    Called from the Tally export, from month-close, and from
    POST /api/v1/ledger/post-period-costs. Voucher keys make repeat calls no-ops,
    so calling it on every export is safe. It never commits: the caller owns the
    transaction.

    A kill switch does not switch the writer off, it switches its writing off. With
    LEDGER_AUTO_POST_COSTS or _COD false the affected writer reports what it would
    have posted and the ledger is untouched, so production can be dry-run before it
    is trusted. `auto_posted` is true only when both writers actually wrote.
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
        "auto_posted": auto_costs and auto_cod,
        "switches": {"costs": auto_costs, "cod": auto_cod},
        "dry_run": bool(dry_run),
    }