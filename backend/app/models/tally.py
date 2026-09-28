# backend/app/models/tally.py
from sqlalchemy import ForeignKey, String, Integer, DateTime, func, UniqueConstraint
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
