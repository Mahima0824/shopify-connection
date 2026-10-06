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
    receiver_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    receiver_company: Mapped[str | None] = mapped_column(String(128), nullable=True)
    receiver_add1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receiver_add2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receiver_city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receiver_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receiver_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
    receiver_mobile: Mapped[str | None] = mapped_column(String(16), nullable=True)
    receiver_email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sender_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default="Reshamgath")
    sender_add1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sender_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sender_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
    sender_mobile: Mapped[str | None] = mapped_column(String(16), nullable=True)
    weight_grams: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    shape: Mapped[str | None] = mapped_column(String(16), nullable=True, default="NROL")
    length_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    breadth_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    barcode_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bulk_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cod_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cod_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    dropoff_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
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
