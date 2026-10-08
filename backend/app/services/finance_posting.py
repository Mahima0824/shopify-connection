"""Domain-derived ledger postings (wave A §6).

Every function is idempotent on a stable voucher key and returns the posted
legs, or None when nothing is due. Balance is enforced upstream by post_voucher,
so a caller never has to re-check it.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

_TOLERANCE = Decimal("1.00")  # carriers round settlements to the rupee


class CodSettlementMismatch(ValueError):
    """A carrier settlement whose net + fee + deductions != settled amount.

    Posting it would book money that the carrier never sent, so it is refused
    and surfaced instead.
    """


def _d(v) -> Decimal:
    from app.services.ledger_service import _d as _ld
    return _ld(v)


def _is_cod(order) -> bool:
    return (getattr(order, "cod_mode", "") or "").strip().upper() == "COD"


def record_cod_collection_from_shipment(db: Session, business_id: str, shipment):
    """On delivery of a COD order, move the debt from the customer to the
    carrier (§6). Without this the COD loop cannot close: COD_REMIT would have
    nothing to credit.

    The amount is the order's own cod_value, i.e. what the courier collected from
    the customer at the door, and it is posted on delivered_at. Taken from the
    shipment's financial row instead it would be both late (that row only exists
    once the carrier reconciles) and unable to correct itself: the voucher key is
    the shipment, so a later, different collected_amount would replay onto the
    first post instead of superseding it.
    """
    from app.models.order import Order
    from app.services import ledger_service as ls
    order = db.query(Order).filter_by(id=shipment.order_id).first()
    if order is None or not _is_cod(order):
        return None
    if (shipment.tracking_status or "").upper() != "DELIVERED":
        return None
    amount = _d(order.cod_value or order.total_amount)
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
    """
    from app.services import ledger_service as ls
    if (sf.status or "").upper() not in ("SETTLED", "RECONCILED", "COMPLETED"):
        return None
    net, fee, ded = _d(sf.net_settlement), _d(sf.fee_amount), _d(sf.other_deduction)
    settled = _d(sf.settled_amount)
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