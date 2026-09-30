from sqlalchemy import ForeignKey, String, Text, DateTime, func, UniqueConstraint, Index, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class Shipment(Base):
    __tablename__ = "shipments"
    __table_args__ = (
        UniqueConstraint("business_id", "carrier_code", "awb_number", name="uq_ship_biz_carrier_awb"),
        Index("ix_ship_status", "business_id", "tracking_status"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    carrier_code: Mapped[str] = mapped_column(String(32))
    awb_number: Mapped[str] = mapped_column(String(64))
    # Identity chain (plan #17): parcel_id -> shipment_id -> awb_number
    # (courier_tracking_number) -> shipsagar_tracking_id. The ShipSagar ID is
    # a provider reference only, never a business ID.
    shipsagar_tracking_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tracking_status: Mapped[str] = mapped_column(String(32), default="BOOKED")
    carrier_status_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_checkpoint_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_checkpoint_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    tracking_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_delivery_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    shipped_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    rto_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ShipmentEvent(Base):
    __tablename__ = "shipment_events"
    __table_args__ = (
        UniqueConstraint("shipment_id", "carrier_event_id", name="uq_shipev_ship_event"),
        UniqueConstraint("provider", "provider_event_id", name="uq_shipev_provider_event"),
        Index("ix_shipev_time", "shipment_id", "event_time"),
        Index("ix_shipev_provider", "provider", "provider_event_id"),
    )
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"))
    # Provider identity for idempotent webhook ingest (plan #20/#53).
    # `provider` mirrors `source`; `provider_event_id` mirrors
    # `carrier_event_id` for ShipSagar rows. Legacy rows keep
    # provider_event_id NULL so the new unique constraint never collides.
    provider: Mapped[str] = mapped_column(String(32), default="MANUAL")
    provider_event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # `status`/`sub_status` are plan #20 names; `status` mirrors
    # `normalized_status` so both vocabularies query the same value.
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sub_status: Mapped[str | None] = mapped_column(String(128), nullable=True)
    carrier_event_id: Mapped[str] = mapped_column(String(128), default="")
    carrier_status_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    normalized_status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_time: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String(16), default="MANUAL")
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CarrierConnection(Base):
    __tablename__ = "carrier_connections"
    __table_args__ = (UniqueConstraint("business_id", "carrier_code", name="uq_carrier_biz_code"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    carrier_code: Mapped[str] = mapped_column(String(32))
    credentials_encrypted: Mapped[str] = mapped_column(Text, default="")
    environment: Mapped[str] = mapped_column(String(16), default="LIVE")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_success_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
