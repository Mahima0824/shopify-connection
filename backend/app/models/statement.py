from sqlalchemy import ForeignKey, String, Integer, Numeric, DateTime, func, Text, Index, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class StatementUpload(Base):
    __tablename__ = "statement_uploads"
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    statement_type: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(64), default="")
    period_start: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    file_hash: Mapped[str] = mapped_column(String(64), default="")
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="READY")
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class StatementRow(Base):
    __tablename__ = "statement_rows"
    __table_args__ = (
        Index("ix_stmrow_awb", "awb_number"),
        Index("ix_stmrow_upload", "statement_upload_id"),
        Index("ix_stmrow_ref", "reference_number"),
        Index("ix_stmrow_bank", "bank_account_id"),
        UniqueConstraint("import_identity", name="uq_stmrow_import_identity"),
    )
    id: Mapped[str] = uuidpk()
    statement_upload_id: Mapped[str] = mapped_column(ForeignKey("statement_uploads.id"))
    row_number: Mapped[int] = mapped_column(Integer)
    external_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    awb_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transaction_date: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    gross_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    fee_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    transaction_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reconciliation_status: Mapped[str] = mapped_column(String(24), default="UNMATCHED")
    matched_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    matched_shipment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # --- Bank reconciliation hardening (Task 2, #32/#33/#35, NUMERIC(18,2) per #72, UTC per #73) ---
    bank_account_id: Mapped[str | None] = mapped_column(ForeignKey("bank_accounts.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(128), nullable=True)  # UTR / bank ref
    debit: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    credit: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    balance: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    value_date: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    import_identity: Mapped[str | None] = mapped_column(String(256), nullable=True)  # unique per #71
    match_level: Mapped[str | None] = mapped_column(String(8), nullable=True)  # L1/L2/L3/L4/MANUAL
    matched_payment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expected_amount: Mapped[object] = mapped_column(Numeric(18, 2), default=0)
    difference: Mapped[object] = mapped_column(Numeric(18, 2), default=0)  # actual - expected
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
