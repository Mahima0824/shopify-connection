"""Durable record of ledger postings that failed (wave A §9).

A webhook must never 500 because the ledger rejected an event, but it must also
never silently drop one. Hooks raise; the webhook catches narrowly and writes
here, and month close is blocked until the row is resolved.

A failure is identified by (business_id, source_type, source_id, event_type), so
a retry updates `attempts` on the existing row instead of inserting another.
"""
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class LedgerPostingFailure(Base):
    __tablename__ = "ledger_posting_failures"
    __table_args__ = (
        # One row per failing source event. Retries must upsert (bump `attempts`)
        # rather than insert, or a retried posting would pile up duplicates.
        UniqueConstraint("business_id", "source_type", "source_id", "event_type",
                         name="uq_lpf_biz_source_event"),
        # Month close asks "unresolved failures for this business"; leading with
        # business_id keeps that off a full table scan.
        Index("ix_lpf_biz_resolved", "business_id", "resolved_at"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    source_type: Mapped[str] = mapped_column(String(32))   # SHOPIFY_WEBHOOK, COD_SETTLEMENT, ...
    source_id: Mapped[str] = mapped_column(String(128))    # shopify id, shipment_financial id, ...
    event_type: Mapped[str] = mapped_column(String(32))    # SALE, REFUND, COD_REMIT, ...
    reason: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    resolved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
