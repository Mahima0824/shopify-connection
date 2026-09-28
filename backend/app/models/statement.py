from sqlalchemy import ForeignKey, String, Integer, Numeric, DateTime, func, Text, Index, JSON
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
    __table_args__ = (Index("ix_stmrow_awb", "awb_number"), Index("ix_stmrow_upload", "statement_upload_id"))
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
    reconciliation_status: Mapped[str] = mapped_column(String(16), default="UNMATCHED")
    matched_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    matched_shipment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
