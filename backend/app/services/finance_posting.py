"""Domain-derived ledger postings (wave A §6).

Every function is idempotent on a stable voucher key and returns the posted
legs, or None when nothing is due. Balance is enforced upstream by post_voucher,
so a caller never has to re-check it.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

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


def record_cod_collection_from_shipment(db: Session, business_id: str, shipment):
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

    KNOWN GAP: orders.py lets cod_value be edited independently of total_amount,
    so when they differ the SALE debited Customer / Receivable at the order total
    while this and COD_REMIT only move COD Receivable, and the difference stays
    open on the books. Closing it is a decision about which figure the sale
    should have used, not a local fix here.
    """
    from app.models.order import Order
    from app.services import ledger_service as ls
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


def record_cod_remittance_from_shipment_financial(db: Session, business_id: str, sf):
    """Post a carrier COD settlement (§6).

    Dr Bank (net) / Dr Carrier Fee / Dr COD Deduction / Cr COD Receivable.

    Only the fee and deduction legs are EXPENSE; the bank and receivable legs are
    NONE, so the settlement clears a balance-sheet account without touching P&L.

    Returns None when the shipment has not been settled yet, or when its order is
    not COD. Raises, writing nothing, when the settlement cannot be posted as it
    stands:

        CodSettlementMismatch - net + fee + deductions does not equal the settled
            amount (beyond the ₹1 carriers round by), so the carrier's own figures
            contradict each other.
        CodCollectionMissing - no COD collection was raised for this shipment.
        ValueError - a negative component, which this voucher shape cannot
            express: a carrier clawback is a reversal, not a settlement.
    """
    from app.models.order import Order
    from app.services import ledger_service as ls
    # The statuses actually written to ShipmentFinancial.status by the statement
    # processor (api/statements.py). Not RECONCILED or COMPLETED: nothing writes
    # those here, and a partially-matched remittance is still money the carrier
    # paid, which must reach the bank rather than sit open forever.
    if (sf.status or "").upper() not in ("SETTLED", "PARTIALLY_SETTLED"):
        return None
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
