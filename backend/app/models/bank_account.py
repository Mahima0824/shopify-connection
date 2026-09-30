from sqlalchemy import ForeignKey, String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class BankAccount(Base):
    """Bank master per plan #32. Never store credentials — masked account number only."""

    __tablename__ = "bank_accounts"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    name: Mapped[str] = mapped_column(String(128), default="")
    bank_name: Mapped[str] = mapped_column(String(128), default="")
    account_number_masked: Mapped[str] = mapped_column(String(32), default="")
    ifsc: Mapped[str | None] = mapped_column(String(16), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                               onupdate=func.now())
