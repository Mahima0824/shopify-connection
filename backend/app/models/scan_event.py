from sqlalchemy import ForeignKey, String, DateTime, func, Index
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class ScanEvent(Base):
    __tablename__ = "scan_events"
    __table_args__ = (Index("ix_scan_parcel_created", "parcel_id", "created_at"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    performed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[str] = mapped_column(String(128), nullable=True)
    event_metadata: Mapped[dict] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
