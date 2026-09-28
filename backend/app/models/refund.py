from sqlalchemy import ForeignKey, String, Numeric, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (UniqueConstraint("business_id", "shopify_refund_id", name="uq_refund_biz_shopify"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    shopify_refund_id: Mapped[str] = mapped_column(String(64))
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
