from sqlalchemy import ForeignKey, String, Integer, DateTime, func, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class ParcelItem(Base):
    __tablename__ = "parcel_items"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_parcel_item_qty"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    order_item_id: Mapped[str] = mapped_column(ForeignKey("order_items.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
