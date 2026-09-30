"""ShipSagar-side persistence: webhook failure log + retry queue.

NOTE: the operational ``shipment_events`` table lives in
``app.models.shipment`` (created by migration 0006). This module holds the
*additive* ShipSagar tables required by plan #20/#53/#69/#74/#75:

- ``ShipsagarWebhookFailure`` — every rejected/failed webhook payload,
  stored for debugging (plan #69).
- ``ShipsagarRetryJob`` — bounded retry queue with backoff
  (30s -> 2min -> 10min -> dead-letter, plan #74).

Identity chain (plan #17): parcel_id -> shipment_id ->
courier_tracking_number (shipments.awb_number) -> shipsagar_tracking_id.
ShipSagar IDs are NEVER business IDs.
"""

from sqlalchemy import ForeignKey, String, Text, DateTime, func, Index, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class ShipsagarWebhookFailure(Base):
    __tablename__ = "shipsagar_webhook_failures"
    __table_args__ = (Index("ix_ssfail_biz_time", "business_id", "created_at"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    reason: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShipsagarRetryJob(Base):
    __tablename__ = "shipsagar_retry_jobs"
    __table_args__ = (Index("ix_ssretry_status_next", "status", "next_retry_at"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    operation: Mapped[str] = mapped_column(String(64), default="register_tracking")
    shipment_id: Mapped[str | None] = mapped_column(ForeignKey("shipments.id"), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=4)
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    next_retry_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
