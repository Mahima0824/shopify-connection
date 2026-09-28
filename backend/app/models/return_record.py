from sqlalchemy import ForeignKey, String, Integer, DateTime, func, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class ReturnRecord(Base):
    __tablename__ = "returns"
    __table_args__ = (
        Index("ix_returns_order", "order_id"),
        Index("ix_returns_parcel", "parcel_id"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    return_type: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(32), nullable=True)
    received_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    inspected_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="RECEIVED")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_return_item_qty"),
        Index("ix_return_items_return", "return_id"),
    )
    id: Mapped[str] = uuidpk()
    return_id: Mapped[str] = mapped_column(ForeignKey("returns.id"))
    order_item_id: Mapped[str] = mapped_column(ForeignKey("order_items.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    condition: Mapped[str | None] = mapped_column(String(32), nullable=True)
