from sqlalchemy import ForeignKey, String, Boolean, DateTime, func, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Reconciliation(Base):
    __tablename__ = "reconciliations"
    __table_args__ = (
        UniqueConstraint("order_id", "issue_code", name="uq_recon_order_issue"),
        Index("ix_recon_resolved", "resolved"),
        Index("ix_recon_issue", "issue_code"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    reconciliation_status: Mapped[str] = mapped_column(String(32), default="EXCEPTION")
    severity: Mapped[str] = mapped_column(String(16))
    issue_code: Mapped[str] = mapped_column(String(64))
    issue_message: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
