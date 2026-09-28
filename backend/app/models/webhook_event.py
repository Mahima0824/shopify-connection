from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class ShopifyWebhookEvent(Base):
    __tablename__ = "shopify_webhook_events"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    webhook_id: Mapped[str] = mapped_column(String(128), unique=True)
    topic: Mapped[str] = mapped_column(String(128), default="")
    shop_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # JSONB on Postgres, plain JSON elsewhere (e.g. sqlite in tests).
    payload: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    processing_status: Mapped[str] = mapped_column(String(16), default="RECEIVED", server_default="RECEIVED")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
