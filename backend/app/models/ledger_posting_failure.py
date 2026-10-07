"""Durable record of ledger postings that failed (wave A §9).

A webhook must never 500 because the ledger rejected an event, but it must also
never silently drop one. Hooks raise; the webhook catches narrowly and writes
here, and month close is blocked until the row is resolved.
"""
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class LedgerPostingFailure(Base):
    __tablename__ = "ledger_posting_failures"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    source_type: Mapped[str] = mapped_column(String(32))   # SHOPIFY_WEBHOOK, COD_SETTLEMENT, ...
    source_id: Mapped[str] = mapped_column(String(128))    # shopify id, shipment_financial id, ...
    event_type: Mapped[str] = mapped_column(String(32))    # SALE, REFUND, COD_REMIT, ...
    reason: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    resolved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())