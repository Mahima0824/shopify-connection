from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class Order(Base):
    """Sprint 1: 1 order = 1 parcel assumption (no parcels table)."""

    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("business_id", "shopify_order_id", name="uq_orders_business_shopify"),
        Index("ix_orders_shopify_order_id", "shopify_order_id"),
        Index("ix_orders_order_date", "order_date"),
        Index("ix_orders_operational_status", "operational_status"),
    )

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    internal_order_number: Mapped[str] = mapped_column(String(64), unique=True)
    shopify_order_id: Mapped[str] = mapped_column(String(64))
    shopify_order_name: Mapped[str] = mapped_column(String(64), default="")
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    order_date: Mapped[object] = mapped_column(DateTime(timezone=True))
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    subtotal_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    shipping_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    payment_status: Mapped[str] = mapped_column(String(32), default="PENDING")
    financial_status: Mapped[str] = mapped_column(String(32), default="PENDING")
    fulfillment_status: Mapped[str] = mapped_column(String(32), default="UNFULFILLED")
    operational_status: Mapped[str] = mapped_column(String(32), default="NEW")
    cancelled_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ship_state_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    place_of_supply: Mapped[str | None] = mapped_column(String(8), nullable=True)
    business_state_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    shopify_created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    shopify_updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    hsn_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gst_rate: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    taxable_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    cgst_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    sgst_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    igst_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    tax_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
