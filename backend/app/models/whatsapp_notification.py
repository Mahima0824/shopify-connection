from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from .base import uuidpk


class WhatsAppNotification(Base):
    """Log of WhatsApp order confirmation and dispatch notifications."""

    __tablename__ = "whatsapp_notifications"
    __table_args__ = (
        Index("ix_whatsapp_notif_order_id", "order_id"),
        Index("ix_whatsapp_notif_phone", "phone_number"),
        Index("ix_whatsapp_notif_created_at", "created_at"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    shipment_id: Mapped[str | None] = mapped_column(ForeignKey("shipments.id"), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(32))
    notification_type: Mapped[str] = mapped_column(String(32))  # 'order_confirmation', 'order_dispatched', 'delivery_update'
    message_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="SENT")  # 'SENT', 'FAILED', 'SIMULATED'
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
