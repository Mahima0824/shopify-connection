from sqlalchemy import ForeignKey, String, Integer, Numeric, DateTime, func, Text, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class SLARule(Base):
    __tablename__ = "carrier_sla_rules"
    __table_args__ = (UniqueConstraint("business_id", "carrier_code", "event_type", name="uq_sla_biz_carrier_event"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    carrier_code: Mapped[str] = mapped_column(String(32), default="*")
    event_type: Mapped[str] = mapped_column(String(32), default="RTO")
    start_event: Mapped[str] = mapped_column(String(32), default="RTO_INITIATED")
    allowed_days: Mapped[int] = mapped_column(Integer, default=45)
    warning_days: Mapped[int] = mapped_column(Integer, default=7)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ShipmentCase(Base):
    __tablename__ = "shipment_cases"
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"))
    case_type: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM")
    complaint_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="OPEN")
    opened_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_followup_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    next_followup_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ShipmentFinancial(Base):
    __tablename__ = "shipment_financials"
    __table_args__ = (UniqueConstraint("shipment_id", name="uq_shipfin_shipment"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shipment_id: Mapped[str] = mapped_column(String(36))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    expected_cod_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    collected_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    settled_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    fee_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    other_deduction: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    net_settlement: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    settlement_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    settlement_date: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="EXPECTED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
