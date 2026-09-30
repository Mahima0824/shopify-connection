from datetime import datetime

from pydantic import BaseModel, Field


class LedgerCreate(BaseModel):
    transaction_type: str = Field(description="SALE|PAYMENT|REFUND|CANCELLATION|COGS|... (#21)")
    amount: str = Field(description="Decimal string, NUMERIC(18,2)")
    tax_amount: str = "0.00"
    transaction_date: datetime | None = None
    order_id: str | None = None
    payment_id: str | None = None
    refund_id: str | None = None
    expense_id: str | None = None
    currency: str = "INR"
    debit_account: str = ""
    credit_account: str = ""
    payment_method: str | None = None
    reference_number: str | None = None
    idempotency_key: str | None = None
    tally_voucher_type: str | None = None
    tally_voucher_number: str | None = None


class LedgerReverse(BaseModel):
    transaction_id: str
    reason: str = ""
