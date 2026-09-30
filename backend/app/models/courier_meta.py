from sqlalchemy import ForeignKey, String, Integer, Text, DateTime, func, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class BookingIdempotency(Base):
    __tablename__ = "booking_idempotency"
    __table_args__ = (UniqueConstraint("business_id", "key", name="uq_bookidem_biz_key"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    key: Mapped[str] = mapped_column(String(64))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class ShipmentAttempt(Base):
    __tablename__ = "shipment_attempts"
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str | None] = mapped_column(ForeignKey("parcels.id"), nullable=True)
    carrier_code: Mapped[str] = mapped_column(String(32), default="")
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    occurred_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CourierStatusMapping(Base):
    __tablename__ = "courier_status_mappings"
    __table_args__ = (UniqueConstraint("provider", "provider_status_code", name="uq_csmap_prov_code"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    provider: Mapped[str] = mapped_column(String(32))
    provider_status_code: Mapped[str] = mapped_column(String(128))
    normalized_status: Mapped[str] = mapped_column(String(32))
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False)
    is_delivered: Mapped[bool] = mapped_column(Boolean, default=False)
    is_ndr: Mapped[bool] = mapped_column(Boolean, default=False)
    is_rto: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hub_event: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CarrierFeature(Base):
    __tablename__ = "carrier_features"
    __table_args__ = (UniqueConstraint("business_id", "provider", "capability", name="uq_cfeat_biz_prov_cap"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    provider: Mapped[str] = mapped_column(String(32))
    capability: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
