from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk

PNL_CLASSES = ("REVENUE", "COGS", "EXPENSE", "REVERSAL", "NONE")

# Per-leg P&L classification, keyed by transaction_type so that it can serve as the
# migration backfill and as the fallback a reader applies when a row's pnl_class is
# absent. It is NOT the classification of record: writers are expected to set
# pnl_class explicitly per leg, because one voucher of a single transaction_type can
# hold legs with different effects (COD_REMIT: the bank leg is NONE, while the fee and
# deduction legs are EXPENSE). Values:
#   REVENUE   - adds to gross revenue; the row's tax_amount splits taxable/tax
#   REVERSAL  - removes previously recognised value: a Credit Note reverses revenue
#               and tax, while a carrier claim reverses the shipping/COGS expense it
#               reimburses. Same class, opposite original posting.
#   COGS      - reduces profit
#   EXPENSE   - reduces profit
#   NONE      - balance-sheet movement only, never touches P&L
DEFAULT_PNL_CLASS = {
    "SALE": "REVENUE",
    "REFUND": "REVERSAL",
    "CARRIER_CLAIM": "REVERSAL",
    "COGS": "COGS",
    "SHIPPING_EXPENSE": "EXPENSE",
    "PACKAGING_EXPENSE": "EXPENSE",
    "PAYMENT_GATEWAY_FEE": "EXPENSE",
    "OTHER_EXPENSE": "EXPENSE",
    "TAX": "EXPENSE",
    "ADJUSTMENT": "EXPENSE",
    "COD_REMIT": "NONE",
    "PAYMENT": "NONE",
    "REFUND_PAYOUT": "NONE",
    "COD_COLLECTION": "NONE",
    "CANCELLATION": "NONE",
}

TRANSACTION_TYPES = (
    "SALE", "PAYMENT", "REFUND", "CANCELLATION", "COGS",
    "SHIPPING_EXPENSE", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
    "OTHER_EXPENSE", "TAX", "ADJUSTMENT",
    "COD_COLLECTION", "COD_REMIT", "CARRIER_CLAIM", "REFUND_PAYOUT",
)


class FinancialTransaction(Base):
    """Immutable financial event ledger (#21). Corrections via reversal/ADJUSTMENT only."""

    __tablename__ = "financial_transactions"
    __table_args__ = (
        UniqueConstraint("business_id", "transaction_id", name="uq_fintxn_biz_txnid"),
        UniqueConstraint("business_id", "idempotency_key", name="uq_fintxn_biz_idem"),
        Index("ix_fintxn_biz_order", "business_id", "order_id"),
        Index("ix_fintxn_biz_date", "business_id", "transaction_date"),
        Index("ix_fintxn_biz_type", "business_id", "transaction_type"),
        Index("ix_fintxn_biz_date_type", "business_id", "transaction_date", "transaction_type"),
        Index("ix_fintxn_biz_group", "business_id", "voucher_group_id"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    transaction_id: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    refund_id: Mapped[str | None] = mapped_column(ForeignKey("refunds.id"), nullable=True)
    expense_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transaction_type: Mapped[str] = mapped_column(String(32))
    # Voucher grouping (wave A §3): a voucher is N legs sharing one group id.
    voucher_group_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    leg_index: Mapped[int] = mapped_column(Integer, default=0)
    pnl_class: Mapped[str] = mapped_column(String(16), default="NONE")
    transaction_date: Mapped[object] = mapped_column(DateTime(timezone=True))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    tax_amount: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    net_amount: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    debit_account: Mapped[str] = mapped_column(String(128), default="")
    credit_account: Mapped[str] = mapped_column(String(128), default="")
    payment_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="POSTED")
    tally_voucher_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tally_voucher_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    reversal_of_id: Mapped[str | None] = mapped_column(ForeignKey("financial_transactions.id"), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
