from sqlalchemy import ForeignKey, String, DateTime, func, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class Parcel(Base):
    __tablename__ = "parcels"
    __table_args__ = (
        UniqueConstraint("business_id", "barcode_value", name="uq_parcel_biz_barcode"),
        Index("ix_parcels_barcode", "barcode_value"),
        Index("ix_parcels_order", "order_id"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_code: Mapped[str] = mapped_column(String(32))
    barcode_value: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="CREATED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
