from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class ShopifyStore(Base):
    __tablename__ = "shopify_stores"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shop_domain: Mapped[str] = mapped_column(String(255))
    # Fernet-encrypted access token. Never expose via API; decrypt only in service layer.
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    api_version: Mapped[str] = mapped_column(String(16), default="2026-01")
    last_sync_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
