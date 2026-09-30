from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class AccountingPeriod(Base):
    """Monthly accounting lock (#76). OPEN -> checks -> CLOSED. No silent edits after close."""

    __tablename__ = "accounting_periods"
    __table_args__ = (
        UniqueConstraint("business_id", "year", "month", name="uq_acct_period_biz_ym"),
        Index("ix_acct_period_biz_status", "business_id", "status"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="OPEN")
    closed_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reopened_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    reopened_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
