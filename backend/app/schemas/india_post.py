"""India Post manual order schemas (pydantic v2)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


class OrderCreateManual(BaseModel):
    receiver_name: str
    receiver_mobile: str
    receiver_add1: str
    receiver_add2: Optional[str] = None
    receiver_city: str
    receiver_state: str
    receiver_pincode: str
    receiver_email: Optional[str] = None
    weight_grams: float = 930
    length_cm: float = 30
    breadth_cm: float = 20
    height_cm: float = 5
    shape: str = "NROL"
    cod_mode: str = "COD"
    total_amount: Optional[float] = None
    cod_value: Optional[float] = None
    barcode_no: Optional[str] = None
    sender_name: Optional[str] = None
    sender_add1: Optional[str] = None
    sender_city: Optional[str] = None
    sender_state: Optional[str] = None
    sender_pincode: Optional[str] = None
    sender_mobile: Optional[str] = None
    line_items: Optional[list[dict]] = None

    @field_validator("receiver_mobile")
    @classmethod
    def _mobile_10_digits(cls, v: str) -> str:
        clean = "".join(ch for ch in str(v or "") if ch.isdigit())
        if clean.startswith("91") and len(clean) == 12:
            clean = clean[2:]
        if len(clean) != 10:
            raise ValueError("Mobile must be 10 digits")
        return clean

    @field_validator("receiver_pincode")
    @classmethod
    def _pincode_6_digits(cls, v: str) -> str:
        clean = "".join(ch for ch in str(v or "") if ch.isdigit())
        if len(clean) != 6:
            raise ValueError("PINCODE must be 6 digits")
        return clean

    @field_validator("cod_mode")
    @classmethod
    def _cod_mode_upper(cls, v: str) -> str:
        u = (v or "").upper()
        if u not in ("COD", "PREPAID"):
            raise ValueError("cod_mode must be COD or PREPAID")
        return u

    @model_validator(mode="after")
    def _cod_value_required_for_cod(self):
        if (self.cod_mode or "").upper() == "COD":
            # If cod_value is not explicitly provided, total_amount must be > 0 so we can compute it
            has_val = self.cod_value is not None and float(self.cod_value) > 0
            has_tot = self.total_amount is not None and float(self.total_amount) > 0
            if not has_val and not has_tot:
                raise ValueError("cod_value or total_amount required > 0 when COD")
        return self
