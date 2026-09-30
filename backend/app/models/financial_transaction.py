from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk

TRANSACTION_TYPES = (
    "SALE", "PAYMENT", "REFUND", "CANCELLATION", "COGS",
    "SHIPPING_EXPENSE", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
    "OTHER_EXPENSE", "TAX", "ADJUSTMENT",
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
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    transaction_id: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    refund_id: Mapped[str | None] = mapped_column(ForeignKey("refunds.id"), nullable=True)
    expense_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transaction_type: Mapped[str] = mapped_column(String(32))
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
