from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

from .base import uuidpk


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = uuidpk()
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    fy_start_month: Mapped[int] = mapped_column(Integer, default=4)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
