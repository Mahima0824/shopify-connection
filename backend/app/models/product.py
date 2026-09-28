from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    shopify_product_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
