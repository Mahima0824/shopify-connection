# backend/app/models/tally.py
from sqlalchemy import Boolean, ForeignKey, Numeric, String, Integer, DateTime, func, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class TallyMapping(Base):
    __tablename__ = "tally_mappings"
    __table_args__ = (UniqueConstraint("business_id", name="uq_tally_mapping_biz"),)
    
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    voucher_sales: Mapped[str] = mapped_column(String(64), default="Sales")
    voucher_sales_return: Mapped[str] = mapped_column(String(64), default="Sales Return")
    voucher_credit_note: Mapped[str] = mapped_column(String(64), default="Credit Note")
    ledger_razorpay: Mapped[str] = mapped_column(String(128), default="Razorpay Settlement")
    ledger_cod: Mapped[str] = mapped_column(String(128), default="COD Receivable")
    ledger_sales: Mapped[str] = mapped_column(String(128), default="Sales Account")
    ledger_cgst: Mapped[str] = mapped_column(String(128), default="Output CGST")
    ledger_sgst: Mapped[str] = mapped_column(String(128), default="Output SGST")
    ledger_igst: Mapped[str] = mapped_column(String(128), default="Output IGST")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ExportBatch(Base):
    __tablename__ = "export_batches"
    
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    batch_reference: Mapped[str] = mapped_column(String(64), unique=True)
    export_type: Mapped[str] = mapped_column(String(32), default="TALLY_EXCEL")
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # --- Task 3 hardening: batch lifecycle per #45 (additive, nullable) ---
    batch_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date_from: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    date_to: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    transaction_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

class TallyExportRecord(Base):
    """Duplicate prevention per #44: unique (business + transaction_id + voucher_type)."""

    __tablename__ = "tally_export_records"
    __table_args__ = (
        UniqueConstraint("business_id", "transaction_id", "voucher_type",
                         name="uq_tally_export_biz_txn_vtype"),
        Index("ix_tally_export_txn", "business_id", "transaction_id"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    transaction_id: Mapped[str] = mapped_column(String(64))
    export_batch_id: Mapped[str | None] = mapped_column(ForeignKey("export_batches.id"), nullable=True)
    voucher_type: Mapped[str] = mapped_column(String(64))
    voucher_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    exported_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    import_status: Mapped[str] = mapped_column(String(32), default="EXPORTED")
    tally_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)

class TallyLedgerMapping(Base):
    """Admin-configured ledger map per #48 (avoids hardcoding Tally ledger names)."""

    __tablename__ = "tally_ledger_mappings"
    __table_args__ = (
        UniqueConstraint("business_id", "internal_account", name="uq_tally_ledgermap_biz_acct"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    internal_account: Mapped[str] = mapped_column(String(64))
    tally_ledger_name: Mapped[str] = mapped_column(String(128), default="")
    voucher_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                               onupdate=func.now())
