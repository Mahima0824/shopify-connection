# Ledger Correctness — Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the financial ledger encode each economic fact exactly once — kill the paid-cancellation double-count, stop silently losing events, and add freight / COD-remittance / carrier-claim postings with real GST legs.

**Architecture:** `post_voucher` becomes the single write primitive: a voucher is a list of `{debit, credit, amount, pnl_class}` legs, persisted as N `FinancialTransaction` rows sharing a `voucher_group_id`, and refused unless debits equal credits. `record_event` becomes a two-leg wrapper so all existing callers and tests are unaffected. Domain-derived writers (COD settlement, period costs) live in a new `finance_posting.py` and are idempotent, gated by two kill switches. Readers classify P&L per leg via a new `pnl_class` column rather than re-inferring from `transaction_type`.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy 2.x (`Mapped`/`mapped_column`), Alembic, SQLite (tests) / PostgreSQL (prod), Decimal for all money, pytest.

## Global Constraints

- All money is `Decimal`, quantized to `0.01` with `ROUND_HALF_UP` (`ledger_service._d`/`_s`). Never use float arithmetic for amounts.
- Ledger storage is UTC; display/date rendering is `Asia/Kolkata` (`DISPLAY_TZ`).
- The ledger is append-only. Corrections go through reversal/`ADJUSTMENT`, never UPDATE — **except** the one-off data remediation in Task 8, which is explicitly exempt and documented as such in its migration docstring.
- `pnl_class` ∈ `{REVENUE, COGS, EXPENSE, REVERSAL, NONE}` and is set by the writer at post time. Readers must never infer P&L from `transaction_type` when `pnl_class` is present.
- Every API error uses the envelope `{"success": false, "error": {"code": ..., "message": ...}}` with the status code matching `tally.py`'s `_err` helper pattern.
- Finance write routes are gated to roles `ADMIN` / `ACCOUNTANT`.
- **The 24 existing tests in `backend/tests/test_ledger.py` and `backend/tests/test_tally_hardening.py` must pass unchanged.** Do not edit them. `to_double_entry` is retained as an unused display helper purely so `test_ledger.py:14-21` and `:67-76` keep passing — no application code may call it after Task 6.
- Tests create their own in-memory SQLite engine via `Base.metadata.create_all`, so model changes need no alembic run. Alembic is verified separately by Task 1's and Task 8's tests.
- Run tests from the `backend` directory: `python -m pytest tests/<file> -q`.

---

### Task 1: Voucher schema + `pnl_class` backfill

**Files:**
- Create: `backend/alembic/versions/0020_ledger_vouchers.py`
- Modify: `backend/app/models/financial_transaction.py:8-11,36-50`
- Modify: `backend/app/models/sla.py:22-39`
- Create: `backend/app/models/ledger_posting_failure.py`
- Modify: `backend/app/models/__init__.py:19`
- Test: `backend/tests/test_ledger_vouchers.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `FinancialTransaction.voucher_group_id: str | None`, `FinancialTransaction.leg_index: int`, `FinancialTransaction.pnl_class: str`
  - `TRANSACTION_TYPES` gains `"COD_COLLECTION"`, `"COD_REMIT"`, `"CARRIER_CLAIM"`, `"REFUND_PAYOUT"`
  - `PNL_CLASSES = ("REVENUE", "COGS", "EXPENSE", "REVERSAL", "NONE")` exported from `app.models.financial_transaction`
  - `DEFAULT_PNL_CLASS: dict[str, str]` exported from `app.models.financial_transaction` — maps `transaction_type` → default `pnl_class`, used by the migration backfill and by readers when `pnl_class` is absent
  - `ShipmentCase.claim_amount: float | None`
  - `LedgerPostingFailure` model in `app.models.ledger_posting_failure` with fields `id, business_id, source_type, source_id, event_type, reason, attempts, resolved_at, created_at`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ledger_vouchers.py`:

```python
"""Task 1: voucher columns, new transaction types, pnl_class backfill, failure model."""
import importlib.util
import os
from datetime import datetime, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return eng


def test_new_transaction_types_present():
    from app.models.financial_transaction import TRANSACTION_TYPES
    for t in ("COD_COLLECTION", "COD_REMIT", "CARRIER_CLAIM", "REFUND_PAYOUT"):
        assert t in TRANSACTION_TYPES, t


def test_financial_transaction_has_voucher_columns():
    from app.models.financial_transaction import FinancialTransaction, PNL_CLASSES
    cols = FinancialTransaction.__table__.columns
    assert "voucher_group_id" in cols
    assert "leg_index" in cols
    assert "pnl_class" in cols
    assert PNL_CLASSES == ("REVENUE", "COGS", "EXPENSE", "REVERSAL", "NONE")


def test_default_pnl_class_covers_every_transaction_type():
    from app.models.financial_transaction import TRANSACTION_TYPES, DEFAULT_PNL_CLASS
    missing = [t for t in TRANSACTION_TYPES if t not in DEFAULT_PNL_CLASS]
    assert missing == [], missing
    # balance-sheet movements must never touch P&L
    for t in ("PAYMENT", "REFUND_PAYOUT", "COD_COLLECTION"):
        assert DEFAULT_PNL_CLASS[t] == "NONE", t
    assert DEFAULT_PNL_CLASS["SALE"] == "REVENUE"
    assert DEFAULT_PNL_CLASS["REFUND"] == "REVERSAL"
    assert DEFAULT_PNL_CLASS["COGS"] == "COGS"


def test_shipment_case_has_claim_amount():
    from app.models.sla import ShipmentCase
    assert "claim_amount" in ShipmentCase.__table__.columns


def test_ledger_posting_failure_model_round_trips():
    from sqlalchemy.orm import sessionmaker
    from app.models.business import Business
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db = sessionmaker(bind=_engine())()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    f = LedgerPostingFailure(business_id=b.id, source_type="SHOPIFY_WEBHOOK",
                             source_id="gid://1", event_type="REFUND",
                             reason="boom", attempts=1)
    db.add(f); db.commit(); db.refresh(f)
    assert f.id and f.resolved_at is None
    assert f.created_at is not None


def test_migration_0020_backfills_pnl_class_and_declares_columns():
    """The migration is self-contained SQL; this asserts its statements and runs them."""
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker
    path = os.path.join(BACKEND, "alembic", "versions", "0020_ledger_vouchers.py")
    spec = importlib.util.spec_from_file_location("m0020", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    assert "voucher_group_id" in "\n".join(mod.BACKFILL_SQL).lower()

    eng = _engine()
    db = sessionmaker(bind=eng)()
    db.execute(text("INSERT INTO financial_transactions "
                    "(id, business_id, transaction_id, transaction_type, transaction_date, "
                    "amount, tax_amount, net_amount, currency, idempotency_key, "
                    "pnl_class, leg_index) VALUES "
                    "('x1','b1','TXN-1','SALE','2026-09-01','1000.00','0.00','1000.00',"
                    "'INR','k1','NONE',0)"))
    db.execute(text("INSERT INTO financial_transactions "
                    "(id, business_id, transaction_id, transaction_type, transaction_date, "
                    "amount, tax_amount, net_amount, currency, idempotency_key, "
                    "pnl_class, leg_index) VALUES "
                    "('x2','b1','TXN-2','PAYMENT','2026-09-01','1000.00','0.00','1000.00',"
                    "'INR','k2','REVENUE',0)"))
    db.commit()
    for stmt in mod.BACKFILL_SQL:
        db.execute(text(stmt))
    db.commit()
    rows = {r.id: r.pnl_class for r in
            db.execute(text("SELECT id, pnl_class FROM financial_transactions")).all()}
    assert rows["x1"] == "REVENUE"
    assert rows["x2"] == "NONE"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.ledger_posting_failure'`

- [ ] **Step 3: Add the model columns and new types**

In `backend/app/models/financial_transaction.py`, replace the `TRANSACTION_TYPES` tuple and add the two module constants above it:

```python
PNL_CLASSES = ("REVENUE", "COGS", "EXPENSE", "REVERSAL", "NONE")

# Per-leg P&L classification. A voucher of one transaction_type can contain
# legs with different effects (COD_REMIT: the bank leg is NONE, the fee and
# deduction legs are EXPENSE), so classification is per leg, never per type.
#   REVENUE   - adds to gross revenue; the row's tax_amount splits taxable/tax
#   REVERSAL  - reverses revenue and tax (Credit Note, claim filed)
#   COGS      - reduces profit
#   EXPENSE   - reduces profit
#   NONE      - balance-sheet movement only, never touches P&L
DEFAULT_PNL_CLASS = {
    "SALE": "REVENUE",
    "REFUND": "REVERSAL",
    "CARRIER_CLAIM": "REVERSAL",
    "COGS": "COGS",
    "SHIPPING_EXPENSE": "EXPENSE",
    "PACKAGING_EXPENSE": "EXPENSE",
    "PAYMENT_GATEWAY_FEE": "EXPENSE",
    "OTHER_EXPENSE": "EXPENSE",
    "TAX": "EXPENSE",
    "ADJUSTMENT": "EXPENSE",
    "COD_REMIT": "NONE",
    "PAYMENT": "NONE",
    "REFUND_PAYOUT": "NONE",
    "COD_COLLECTION": "NONE",
    "CANCELLATION": "NONE",
}

TRANSACTION_TYPES = (
    "SALE", "PAYMENT", "REFUND", "CANCELLATION", "COGS",
    "SHIPPING_EXPENSE", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
    "OTHER_EXPENSE", "TAX", "ADJUSTMENT",
    "COD_COLLECTION", "COD_REMIT", "CARRIER_CLAIM", "REFUND_PAYOUT",
)
```

Add three columns to `FinancialTransaction`, immediately after `transaction_type`:

```python
    # Voucher grouping (wave A §3): a voucher is N legs sharing one group id.
    voucher_group_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    leg_index: Mapped[int] = mapped_column(Integer, default=0)
    pnl_class: Mapped[str] = mapped_column(String(16), default="NONE")
```

Add `Index("ix_fintxn_biz_group", "business_id", "voucher_group_id")` to `__table_args__`.

> **Spec deviation, deliberate:** spec §10 says `VARCHAR(64)` for `voucher_group_id`. The auto-generated idempotency key in `record_event` (`"{type}:{order}:{payment}:{refund}:{amount}:{tax}:{iso}"`) routinely exceeds 64 characters, so the column is `String(128)` and holds the voucher key verbatim.

- [ ] **Step 4: Add `claim_amount` to `ShipmentCase`**

In `backend/app/models/sla.py`, add after `notes` in `ShipmentCase`:

```python
    # Wave A: carrier claims are posted to the ledger by hand from this amount.
    claim_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
```

- [ ] **Step 5: Create the `LedgerPostingFailure` model**

Create `backend/app/models/ledger_posting_failure.py`:

```python
# backend/app/models/ledger_posting_failure.py
"""Durable record of ledger postings that failed (wave A §9).

A webhook must never 500 because the ledger rejected an event, but it must also
never silently drop one. Hooks raise; the webhook catches narrowly and writes
here, and month close is blocked until the row is resolved.
"""
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk


class LedgerPostingFailure(Base):
    __tablename__ = "ledger_posting_failures"

    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    source_type: Mapped[str] = mapped_column(String(32))   # SHOPIFY_WEBHOOK, COD_SETTLEMENT, ...
    source_id: Mapped[str] = mapped_column(String(128))    # shopify id, shipment_financial id, ...
    event_type: Mapped[str] = mapped_column(String(32))    # SALE, REFUND, COD_REMIT, ...
    reason: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    resolved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

In `backend/app/models/__init__.py`, add the import on a new line after line 19:

```python
from app.models.ledger_posting_failure import LedgerPostingFailure  # noqa: F401
```

- [ ] **Step 6: Create the migration**

Create `backend/alembic/versions/0020_ledger_vouchers.py`:

```python
"""0020 ledger vouchers: leg grouping + per-leg pnl_class (wave A §3, §8).

Adds multi-leg voucher support to the financial ledger and classifies each leg's
P&L effect at post time. BACKFILL_SQL is module-level and self-contained so the
migration is a permanent record that does not import application code, and so
tests/test_ledger_vouchers.py can execute the exact statements against a seeded
database.
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_ledger_vouchers"
down_revision = "0019_india_post_order_fields"
branch_labels = None
depends_on = None

BACKFILL_SQL = [
    "UPDATE financial_transactions SET pnl_class = 'REVENUE' WHERE transaction_type = 'SALE'",
    "UPDATE financial_transactions SET pnl_class = 'REVERSAL' WHERE transaction_type IN ('REFUND', 'CARRIER_CLAIM')",
    "UPDATE financial_transactions SET pnl_class = 'COGS' WHERE transaction_type = 'COGS'",
    "UPDATE financial_transactions SET pnl_class = 'EXPENSE' WHERE transaction_type IN "
    "('SHIPPING_EXPENSE', 'PACKAGING_EXPENSE', 'PAYMENT_GATEWAY_FEE', 'OTHER_EXPENSE', 'TAX', 'ADJUSTMENT')",
    "UPDATE financial_transactions SET pnl_class = 'NONE' WHERE transaction_type IN "
    "('PAYMENT', 'COD_REMIT', 'REFUND_PAYOUT', 'COD_COLLECTION', 'CANCELLATION')",
]


def upgrade():
    op.add_column("financial_transactions", sa.Column("voucher_group_id", sa.String(128), nullable=True))
    op.add_column("financial_transactions", sa.Column("leg_index", sa.Integer(), server_default="0", nullable=False))
    op.add_column("financial_transactions", sa.Column("pnl_class", sa.String(16), server_default="NONE", nullable=False))
    op.create_index("ix_fintxn_biz_group", "financial_transactions", ["business_id", "voucher_group_id"])
    op.add_column("shipment_cases", sa.Column("claim_amount", sa.Numeric(12, 2), nullable=True))
    op.create_table(
        "ledger_posting_failures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="1", nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for stmt in BACKFILL_SQL:
        op.execute(stmt)


def downgrade():
    op.drop_table("ledger_posting_failures")
    op.drop_column("shipment_cases", "claim_amount")
    op.drop_index("ix_fintxn_biz_group", table_name="financial_transactions")
    op.drop_column("financial_transactions", "pnl_class")
    op.drop_column("financial_transactions", "leg_index")
    op.drop_column("financial_transactions", "voucher_group_id")
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: 6 passed

- [ ] **Step 8: Run the full ledger/tally suite for regressions**

Run: `python -m pytest tests/test_ledger.py tests/test_tally_hardening.py -q`
Expected: 24 passed

- [ ] **Step 9: Commit**

```bash
git add backend/alembic/versions/0020_ledger_vouchers.py backend/app/models/financial_transaction.py backend/app/models/sla.py backend/app/models/ledger_posting_failure.py backend/app/models/__init__.py backend/tests/test_ledger_vouchers.py
git commit -m "feat(ledger): voucher grouping columns, pnl_class, new transaction types

Adds voucher_group_id/leg_index/pnl_class to financial_transactions, the
COD/claim/refund-payout transaction types, ShipmentCase.claim_amount, and
the ledger_posting_failures table, plus migration 0020 with a pnl_class
backfill from transaction_type."
```

---

### Task 2: `post_voucher` — the balance-enforced write primitive

**Files:**
- Modify: `backend/app/services/ledger_service.py:1-40,139-190`
- Test: `backend/tests/test_ledger_vouchers.py`

**Interfaces:**
- Consumes: `FinancialTransaction.voucher_group_id/leg_index/pnl_class`, `PNL_CLASSES`, `DEFAULT_PNL_CLASS` from Task 1.
- Produces:
  - `class UnbalancedVoucher(ValueError)` in `app.services.ledger_service`
  - `post_voucher(db, business_id, event_type, legs, *, order_id=None, payment_id=None, refund_id=None, expense_id=None, transaction_date=None, currency="INR", payment_method=None, reference_number=None, voucher_key=None, idempotency_key=None, reversal_of_id=None, tally_voucher_type=None, tally_voucher_number=None, _max_attempts=5) -> list[FinancialTransaction]`
    - `legs` is a list of dicts, each with keys `debit` (str), `credit` (str), `amount`, and optional `tax_amount` (default `"0"`), `pnl_class` (default: `DEFAULT_PNL_CLASS[event_type]`)
    - Returns the legs in `leg_index` order. On idempotent replay, returns the existing rows.
  - `record_event(...)` keeps its exact current signature and now delegates to `post_voucher`, returning `list[FinancialTransaction][0]`
  - Module constants `ACC_RECEIVABLE`, `ACC_SALES`, `ACC_COD_RECEIVABLE`, `ACC_CARRIER_FEE`, `ACC_COD_DEDUCTION`, `ACC_BANK`, `ACC_GATEWAY`, `ACC_INVENTORY`, `ACC_COGS`, `ACC_SALES_RETURNS`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ledger_vouchers.py`:

```python
def _db():
    from sqlalchemy.orm import sessionmaker
    from app.models.business import Business
    db = sessionmaker(bind=_engine())()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    return db, b


def test_post_voucher_rejects_unbalanced_and_writes_nothing():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import UnbalancedVoucher, post_voucher
    db, b = _db()
    legs = [{"debit": "Bank", "credit": "Receivable", "amount": "100.00"},
            {"debit": "Fee", "credit": "Receivable", "amount": "50.00"}]
    try:
        post_voucher(db, b.id, "COD_REMIT", legs)
        raise AssertionError("expected UnbalancedVoucher")
    except UnbalancedVoucher:
        pass
    assert db.query(FinancialTransaction).count() == 0


def test_post_voucher_writes_legs_sharing_one_group_in_order():
    from app.services.ledger_service import post_voucher
    db, b = _db()
    legs = [{"debit": "Bank", "credit": "COD Receivable", "amount": "900.00", "pnl_class": "NONE"},
            {"debit": "Carrier Fee", "credit": "COD Receivable", "amount": "100.00", "pnl_class": "EXPENSE"}]
    rows = post_voucher(db, b.id, "COD_REMIT", legs, voucher_key="K1")
    db.commit()
    assert [r.leg_index for r in rows] == [0, 1]
    assert len({r.voucher_group_id for r in rows}) == 1
    assert rows[0].voucher_group_id == "K1"
    assert rows[0].debit_account == "Bank" and rows[0].credit_account == "COD Receivable"
    assert rows[1].pnl_class == "EXPENSE"
    assert str(rows[1].amount) == "100.00"


def test_post_voucher_defaults_pnl_class_from_event_type():
    from app.services.ledger_service import post_voucher
    db, b = _db()
    rows = post_voucher(db, b.id, "SALE",
                        [{"debit": "Customer / Receivable", "credit": "Sales Revenue",
                          "amount": "1180.00", "tax_amount": "180.00"}], voucher_key="K2")
    db.commit()
    assert rows[0].pnl_class == "REVENUE"
    assert str(rows[0].net_amount) == "1000.00"


def test_post_voucher_is_idempotent_on_replay():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import post_voucher
    db, b = _db()
    legs = [{"debit": "Bank", "credit": "COD Receivable", "amount": "900.00"},
            {"debit": "Carrier Fee", "credit": "COD Receivable", "amount": "100.00"}]
    first = post_voucher(db, b.id, "COD_REMIT", legs, voucher_key="K3")
    db.commit()
    second = post_voucher(db, b.id, "COD_REMIT", legs, voucher_key="K3")
    db.commit()
    assert db.query(FinancialTransaction).count() == 2
    assert {r.id for r in first} == {r.id for r in second}


def test_record_event_behaviour_unchanged():
    from app.services import ledger_service as ls
    db, b = _db()
    t = ls.record_event(db, b.id, "SALE", "1180.00", "180.00", idempotency_key="K4")
    db.commit()
    assert t.transaction_type == "SALE"
    assert str(t.amount) == "1180.00" and str(t.tax_amount) == "180.00"
    assert str(t.net_amount) == "1000.00"
    assert t.debit_account == "" and t.credit_account == ""
    assert t.leg_index == 0 and t.pnl_class == "REVENUE"
    assert t.voucher_group_id == "K4"
    assert t.status == "POSTED"


def test_record_event_rejects_negative_amount_for_sale():
    from app.services import ledger_service as ls
    db, b = _db()
    try:
        ls.record_event(db, b.id, "SALE", "-5.00", "0")
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "Negative" in str(e)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: FAIL — `ImportError: cannot import name 'UnbalancedVoucher'`

- [ ] **Step 3: Add the exception, account constants, and `post_voucher`**

In `backend/app/services/ledger_service.py`, add immediately after `_Q = Decimal("0.01")`:

```python
class UnbalancedVoucher(ValueError):
    """Raised when a voucher's debit legs do not equal its credit legs.

    Balance is enforced at the only place that matters: an unbalanced voucher
    never reaches the ledger, so no downstream reader (reports, Tally export)
    can ever observe a malformed entry.
    """


# Canonical ledger account names. Wave B resolves these to the accountant's
# configured Tally ledger names; until then they are the internal names.
ACC_RECEIVABLE = "Customer / Receivable"
ACC_SALES = "Sales Revenue"
ACC_SALES_RETURNS = "Sales Returns / Refunds"
ACC_COD_RECEIVABLE = "COD Receivable"
ACC_CARRIER_FEE = "Carrier Freight / Fees"
ACC_COD_DEDUCTION = "COD Deductions / Write-off"
ACC_CARRIER_CLAIM = "Carrier Claim Receivable"
ACC_BANK = "Cash / Bank"
ACC_GATEWAY = "Payment Gateway"
ACC_INVENTORY = "Inventory / Stock"
ACC_COGS = "Cost of Goods Sold"
```

Import the new constants from the model, extending the existing import at line 11:

```python
from app.models.financial_transaction import (
    DEFAULT_PNL_CLASS, PNL_CLASSES, TRANSACTION_TYPES, FinancialTransaction,
)
```

Then add `post_voucher` immediately before `record_event`, and rewrite `record_event` to delegate:

```python
def _voucher_key(voucher_key, idempotency_key, event_type, order_id, payment_id,
                 refund_id, amount, tax, dt) -> str:
    return voucher_key or idempotency_key or (
        f"{event_type}:{order_id or '-'}:{payment_id or '-'}:{refund_id or '-'}:"
        f"{amount}:{tax}:{dt.isoformat()}")


def post_voucher(db: Session, business_id: str, event_type: str, legs: list[dict],
                 *, order_id=None, payment_id=None, refund_id=None, expense_id=None,
                 transaction_date=None, currency="INR", payment_method=None,
                 reference_number=None, voucher_key=None, idempotency_key=None,
                 reversal_of_id=None, tally_voucher_type=None, tally_voucher_number=None,
                 _max_attempts: int = 5) -> list[FinancialTransaction]:
    """Write a voucher as one FinancialTransaction row per leg, all sharing one
    voucher_group_id (wave A §3).

    `legs` items are ``{"debit": str, "credit": str, "amount": <Decimal-able>,
    "tax_amount": optional, "pnl_class": optional}``. Raises UnbalancedVoucher
    and writes nothing unless sum(debit legs) == sum(credit legs).
    """
    from sqlalchemy.exc import IntegrityError

    t = (event_type or "").upper()
    if t not in TRANSACTION_TYPES:
        raise ValueError(f"Unknown transaction_type '{event_type}'.")
    if not legs:
        raise ValueError("post_voucher requires at least one leg.")

    default_class = DEFAULT_PNL_CLASS.get(t, "NONE")
    prepared = []
    for raw in legs:
        amt, tax = _d(raw.get("amount")), _d(raw.get("tax_amount"))
        prepared.append({
            "debit": (raw.get("debit") or "").strip(),
            "credit": (raw.get("credit") or "").strip(),
            "amount": amt,
            "tax_amount": tax,
            "net_amount": amt - tax,
            "pnl_class": (raw.get("pnl_class") or default_class).upper(),
            "payment_method": raw.get("payment_method") or payment_method,
            "reference_number": raw.get("reference_number") or reference_number,
        })
        if prepared[-1]["pnl_class"] not in PNL_CLASSES:
            raise ValueError(f"Unknown pnl_class '{prepared[-1]['pnl_class']}'.")

    dr_total = sum((l["amount"] for l in prepared if l["debit"]), Decimal("0"))
    cr_total = sum((l["amount"] for l in prepared if l["credit"]), Decimal("0"))
    if abs(dr_total - cr_total) > _Q:
        raise UnbalancedVoucher(
            f"Voucher {t} does not balance: debits {_s(dr_total)} != credits {_s(cr_total)}.")

    dt = _utc(transaction_date)
    key = _voucher_key(voucher_key, idempotency_key, t, order_id, payment_id, refund_id,
                       prepared[0]["amount"], prepared[0]["tax_amount"], dt)
    group = key[:128]

    for _ in range(_max_attempts):
        existing = db.query(FinancialTransaction).filter_by(
            business_id=business_id, voucher_group_id=group).order_by(
            FinancialTransaction.leg_index).all()
        if existing:
            return existing  # idempotent replay, incl. a concurrent writer that won
        try:
            _acct_guard(db, business_id, dt, txn_type=t)
        except ImportError:
            pass
        rows: list[FinancialTransaction] = []
        savepoint = db.begin_nested()
        try:
            for i, leg in enumerate(prepared):
                leg_key = f"{key}:{i}"[:128]
                if db.query(FinancialTransaction).filter_by(
                        business_id=business_id, idempotency_key=leg_key).first():
                    savepoint.rollback()
                    rows = []
                    break
                rows.append(FinancialTransaction(
                    business_id=business_id,
                    transaction_id=_next_txn_id(db, business_id),
                    order_id=order_id, payment_id=payment_id, refund_id=refund_id,
                    expense_id=expense_id, transaction_type=t, transaction_date=dt,
                    amount=leg["amount"], tax_amount=leg["tax_amount"],
                    net_amount=leg["net_amount"], currency=currency or "INR",
                    debit_account=leg["debit"], credit_account=leg["credit"],
                    payment_method=leg["payment_method"],
                    reference_number=leg["reference_number"], status="POSTED",
                    idempotency_key=leg_key, reversal_of_id=reversal_of_id,
                    tally_voucher_type=tally_voucher_type,
                    tally_voucher_number=tally_voucher_number,
                    voucher_group_id=group, leg_index=i, pnl_class=leg["pnl_class"],
                ))
                db.add(rows[-1])
            else:
                db.flush()
                savepoint.commit()
                return rows
        except IntegrityError:
            savepoint.rollback()
            continue  # re-count transaction_ids and retry
    raise IntegrityError("voucher insert failed after retries", None, None)


def _acct_guard(db, business_id, dt, *, txn_type):
    """Closed-period guard; imported lazily so the module stays importable alone."""
    from app.services import accounting_service as _acct
    _acct.assert_open_period(db, business_id, dt, txn_type=txn_type)


def record_event(db: Session, business_id: str, transaction_type: str, amount,
                 tax_amount="0", transaction_date=None, order_id=None, payment_id=None,
                 refund_id=None, expense_id=None, currency="INR", debit_account="",
                 credit_account="", payment_method=None, reference_number=None,
                 idempotency_key=None, reversal_of_id=None,
                 tally_voucher_type=None, tally_voucher_number=None,
                 _max_attempts: int = 5) -> FinancialTransaction:
    """Single debit/credit pair. Now a two-leg wrapper over post_voucher (§3)."""
    leg = {"debit": debit_account or "", "credit": credit_account or "", "amount": amount}
    if _d(tax_amount) != 0:
        leg["tax_amount"] = tax_amount
    rows = post_voucher(
        db, business_id, transaction_type, [leg], order_id=order_id, payment_id=payment_id,
        refund_id=refund_id, expense_id=expense_id, transaction_date=transaction_date,
        currency=currency, payment_method=payment_method, reference_number=reference_number,
        idempotency_key=idempotency_key, reversal_of_id=reversal_of_id,
        tally_voucher_type=tally_voucher_type, tally_voucher_number=tally_voucher_number,
        _max_attempts=_max_attempts)
    return rows[0]
```

Delete the old body of `record_event` (the `from sqlalchemy.exc import IntegrityError` local import, the `_max_attempts` retry loop and the `raise IntegrityError` at the end of the current lines 139-190) — it is fully replaced.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: 12 passed

- [ ] **Step 5: Run the regression suite**

Run: `python -m pytest tests/test_ledger.py tests/test_tally_hardening.py -q`
Expected: 24 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ledger_service.py backend/tests/test_ledger_vouchers.py
git commit -m "feat(ledger): balance-enforced post_voucher primitive

A voucher is now a list of legs persisted as N FinancialTransaction rows
sharing one voucher_group_id, refused unless debits equal credits.
record_event becomes a two-leg wrapper with an unchanged signature."
```

---

### Task 3: Cancellation becomes a marker; refunds post real GST legs

**Files:**
- Modify: `backend/app/services/ledger_service.py:211-270` (`record_refund_from_refund`, `record_cancellation`)
- Modify: `backend/app/services/webhook_service.py:77-83,113-118`
- Modify: `backend/app/services/report_service.py:249-262` (backfill cancellation skip)
- Test: `backend/tests/test_refund_gst.py`

**Interfaces:**
- Consumes: `post_voucher` and account constants from Task 2.
- Produces:
  - `record_refund_from_refund(db, business_id, refund, order=None) -> list[FinancialTransaction]` — the `tax_amount` parameter is **removed**; tax is derived from the order's `OrderItem` rows. Returns the REFUND voucher legs plus the REFUND_PAYOUT voucher legs.
  - `refund_tax_split(db, order, refund_amount) -> tuple[Decimal, Decimal, Decimal]` — `(cgst, sgst, igst)` pro-rated to `refund_amount`
  - `record_cancellation(db, business_id, order, refund_required=None) -> list[FinancialTransaction]` — posts a zero-amount marker. **Ruling (pre-flight A):** `refund_required` is retained as an accepted-and-ignored keyword so the two existing tests that pass it keep working unchanged. Document it as deprecated.
- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_refund_gst.py`:

```python
"""Task 3: cancellation is a marker; refunds reverse revenue AND post GST legs."""
from datetime import datetime, timezone

DT = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)


def _env(items=(), total="1180.00", tax="180.00"):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    from app.models.business import Business
    from app.models.customer import Customer
    from app.models.order import Order, OrderItem
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    c = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(c); db.commit(); db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-1", shopify_order_id="g1",
              shopify_order_name="#1001", customer_id=c.id, currency="INR",
              subtotal_amount=float(total) - float(tax), discount_amount=0,
              shipping_amount=0, tax_amount=float(tax), total_amount=float(total),
              payment_status="PAID", financial_status="PAID",
              fulfillment_status="FULFILLED", operational_status="SHIPPED", order_date=DT)
    db.add(o); db.commit(); db.refresh(o)
    for idx, it in enumerate(items or ((None, "1000.00", "90.00", "90.00", "0.00", 1, 18.0),)):
        hsn, taxable, cgst, sgst, igst, qty, rate = it
        db.add(OrderItem(business_id=b.id, order_id=o.id, title=f"P{idx}", sku=f"S{idx}",
                         quantity=qty, price="1000.00", hsn_code=hsn,
                         taxable_amount=float(taxable), cgst_amount=float(cgst),
                         sgst_amount=float(sgst), igst_amount=float(igst),
                         gst_rate=rate, tax_amount=float(cgst) + float(sgst) + float(igst)))
    db.commit()
    return db, b, o


def _refund(db, b, o, amount):
    from app.models.refund import Refund
    r = Refund(business_id=b.id, order_id=o.id, shopify_refund_id="rf1",
               amount=float(amount), currency="INR", status="COMPLETED")
    db.add(r); db.commit(); db.refresh(r)
    return r


def test_refund_posts_real_cgst_sgst_legs():
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env()
    r = _refund(db, b, o, "1180.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    legs = db.query(FinancialTransaction).filter_by(transaction_type="REFUND").all()
    assert len(legs) == 3, [(l.debit_account, l.credit_account, str(l.amount)) for l in legs]
    assert str(sum((l.amount for l in legs if l.pnl_class == "REVERSAL"), 0)) == "1180.00"


def test_refund_mixed_rates_is_not_a_flat_half_split():
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    items = [(None, "400.00", "10.00", "10.00", "0.00", 1, 5.0),
             (None, "600.00", "36.00", "36.00", "0.00", 1, 12.0),
             (None, "0.00", "0.00", "27.00", "27.00", 1, 18.0)]
    db, b, o = _env(items=items, total="1000.00", tax="180.00")
    r = _refund(db, b, o, "1000.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    legs = db.query(FinancialTransaction).filter_by(transaction_type="REFUND").all()
    by = {(l.debit_account, l.credit_account): str(l.amount) for l in legs}
    assert by[("Sales Revenue", "Customer / Receivable")] == "820.00"
    assert by[("Output CGST", "Customer / Receivable")] == "73.00"
    assert by[("Output SGST", "Customer / Receivable")] == "73.00"
    assert by[("Output IGST", "Customer / Receivable")] == "34.00"


def test_refund_posts_a_separate_payout_voucher():
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env()
    r = _refund(db, b, o, "590.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    pay = db.query(FinancialTransaction).filter_by(transaction_type="REFUND_PAYOUT").all()
    assert len(pay) == 1
    assert pay[0].debit_account == "Customer / Receivable"
    assert pay[0].credit_account == "Payment Gateway"
    assert str(pay[0].amount) == "590.00"
    assert pay[0].pnl_class == "NONE"


def test_paid_cancel_then_refund_nets_to_zero_not_negative():
    from app.services import ledger_service as ls
    db, b, o = _env()
    ls.record_event(db, b.id, "SALE", "1180.00", "180.00", transaction_date=DT,
                    order_id=o.id, idempotency_key=f"SALE:{o.id}")
    r = _refund(db, b, o, "1180.00")
    ls.record_cancellation(db, b.id, o)
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    from app.services.ledger_service import revenue_summary
    rows = [{"transaction_type": x.transaction_type, "amount": str(x.amount),
             "tax_amount": str(x.tax_amount), "pnl_class": x.pnl_class}
            for x in db.query(FinancialTransaction).all()]
    rev = revenue_summary(rows)
    assert rev["gross_inclusive"] == "1180.00"
    assert rev["refunds_inclusive"] == "1180.00"
    assert rev["net_inclusive"] == "0.00"


def test_cancellation_marker_carries_no_amount():
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env()
    ls.record_cancellation(db, b.id, o)
    db.commit()
    rows = db.query(FinancialTransaction).filter_by(transaction_type="CANCELLATION").all()
    assert len(rows) == 1
    assert str(rows[0].amount) == "0.00"
    assert str(rows[0].tax_amount) == "0.00"
    assert rows[0].pnl_class == "NONE"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_refund_gst.py -q`
Expected: FAIL — `TypeError: record_cancellation() got an unexpected keyword argument 'refund_required'` / refund produces 1 leg not 3

- [ ] **Step 3: Implement `refund_tax_split` and rewrite the two hooks**

In `backend/app/services/ledger_service.py`, replace `record_refund_from_refund` and `record_cancellation` (current lines 242-269) with:

```python
def refund_tax_split(db: Session, order, refund_amount) -> tuple:
    """(cgst, sgst, igst) for a refund, pro-rated from the order's real OrderItem
    tax figures (wave A §5).

    Replaces the old tax/2 half-split, which ignored per-line GST rates and
    filed IGST as 0 whenever the jurisdiction was unknown. Falls back to a
    zero split when the order total is unusable; the caller surfaces that as a
    CA-review flag rather than inventing tax.
    """
    from app.models.order import OrderItem
    from decimal import Decimal as _Dec
    total = _d(getattr(order, "total_amount", 0) or 0)
    amt = _d(refund_amount)
    if total <= 0 or amt <= 0:
        return _Dec("0.00"), _Dec("0.00"), _Dec("0.00")
    ratio = amt / total
    try:
        items = db.query(OrderItem).filter_by(order_id=order.id).all()
    except Exception:
        items = []
    c = sum((_d(i.cgst_amount) for i in items), _Dec("0.00"))
    s = sum((_d(i.sgst_amount) for i in items), _Dec("0.00"))
    i = sum((_d(i.igst_amount) for i in items), _Dec("0.00"))
    if c + s + i <= 0:  # items carry no split tax; derive from the order tax
        tax = _d(getattr(order, "tax_amount", 0) or 0) * ratio
        half = (tax / 2).quantize(_Q, rounding=ROUND_HALF_UP)
        return half, tax - half, _Dec("0.00")
    return c * ratio, s * ratio, i * ratio


def record_refund_from_refund(db: Session, business_id: str, refund, order=None) -> list:
    """Credit Note (reverses revenue + GST) plus the gateway payout (§5).

    Both vouchers are required and they net: the credit note re-creates the
    receivable, the payout clears it. A single event cannot express this, which
    is why GST on credit notes was always zero before.
    """
    o = order
    if o is None:
        try:
            from app.models.order import Order
            o = db.query(Order).filter_by(id=refund.order_id).first()
        except Exception:
            o = None
    amt = _d(getattr(refund, "amount", 0) or 0)
    tax = _d(getattr(refund, "tax_amount", 0) or 0)
    if tax == 0 and o is not None:
        cgst, sgst, igst = refund_tax_split(db, o, amt)
        tax = cgst + sgst + igst
    else:
        cgst, sgst, igst = tax / 2, tax - (tax / 2), Decimal("0")
    taxable = amt - tax
    rows: list = []
    if taxable > 0:
        rows += post_voucher(
            db, business_id, "REFUND",
            [{"debit": ACC_SALES, "credit": ACC_RECEIVABLE, "amount": taxable}],
            order_id=refund.order_id, refund_id=refund.id,
            transaction_date=getattr(refund, "created_at", None),
            voucher_key=f"REFUND:{refund.id}:taxable",
            reference_number=getattr(refund, "shopify_refund_id", None),
            tally_voucher_type="Credit Note")
    for acct, val in ((ACC_OUTPUT_CGST, cgst), (ACC_OUTPUT_SGST, sgst), (ACC_OUTPUT_IGST, igst)):
        if val > 0:
            rows += post_voucher(
                db, business_id, "REFUND",
                [{"debit": acct, "credit": ACC_RECEIVABLE, "amount": val}],
                order_id=refund.order_id, refund_id=refund.id,
                transaction_date=getattr(refund, "created_at", None),
                voucher_key=f"REFUND:{refund.id}:{acct}",
                reference_number=getattr(refund, "shopify_refund_id", None),
                tally_voucher_type="Credit Note")
    if amt > 0:
        rows += post_voucher(
            db, business_id, "REFUND_PAYOUT",
            [{"debit": ACC_RECEIVABLE, "credit": ACC_GATEWAY, "amount": amt}],
            order_id=refund.order_id, refund_id=refund.id,
            transaction_date=getattr(refund, "created_at", None),
            voucher_key=f"REFUND_PAYOUT:{refund.id}",
            reference_number=getattr(refund, "shopify_refund_id", None),
            tally_voucher_type="Receipt")
    return rows


def record_cancellation(db: Session, business_id: str, order,
                        refund_required=None) -> list:
    """Void marker only (§2).

    A paid cancellation keeps its sale on the books until the refund actually
    posts: an unpaid liability is visible to an auditor, a silent write-off is
    not. No amount is ever carried here, so CANCELLATION cannot be double-
    counted against a REFUND.

    `refund_required` is DEPRECATED and ignored. It used to decide whether the
    full order total was written here, which double-counted every paid
    cancellation against its own refund. It is kept only so existing callers and
    tests keep working; nothing reads it.
    """
    return post_voucher(
        db, business_id, "CANCELLATION",
        [{"debit": ACC_SALES_RETURNS, "credit": ACC_RECEIVABLE, "amount": "0.00"}],
        order_id=order.id, transaction_date=getattr(order, "cancelled_at", None),
        reference_number=getattr(order, "cancel_reason", None),
        voucher_key=f"CANCELLATION:{order.id}")
```

Add three constants beside the other account constants added in Task 2:

```python
ACC_OUTPUT_CGST = "Output CGST"
ACC_OUTPUT_SGST = "Output SGST"
ACC_OUTPUT_IGST = "Output IGST"
```

- [ ] **Step 4: Update the two call sites**

`backend/app/services/webhook_service.py`, cancellation branch (lines 77-83):

```python
            try:  # additive ledger hook: void marker; never break webhook
                from app.services.ledger_service import record_cancellation
                record_cancellation(db, business_id, o)
                db.commit()
            except Exception:
                pass
```

The `except Exception: pass` in this block is removed properly in Task 7 (durable failure
records). Leave it in place for now — Task 3 is about the refund/cancellation amounts.

Refund branch (lines 113-118):

```python
            try:  # additive ledger hook: void marker; never break webhook
                from app.services.ledger_service import record_cancellation
                record_cancellation(db, business_id, o)
                db.commit()
            except Exception:
                pass
```

`backend/app/services/report_service.py` line 258 — pass the order through so tax resolves without a second query:

```python
            _ls.record_sale_from_order(db, business_id, o)
```
(unchanged — the sales hook already receives `o`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_refund_gst.py -q`
Expected: 5 passed

- [ ] **Step 6: Run the regression suite**

Run: `python -m pytest tests/test_ledger.py tests/test_tally_hardening.py -q`
Expected: 24 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/ledger_service.py backend/app/services/webhook_service.py backend/tests/test_refund_gst.py
git commit -m "fix(ledger): cancellation is a void marker, refunds carry real GST legs

A paid cancellation no longer writes an amount, so a sold-then-refunded
order nets to zero instead of negative. Refunds post a Credit Note with
CGST/SGST/IGST taken from the order's OrderItem rows plus a separate
REFUND_PAYOUT voucher, replacing the tax/2 half-split that always filed
IGST as zero."
```

---

### Task 4: COD collection and COD remittance writers

**Files:**
- Create: `backend/app/services/finance_posting.py`
- Test: `backend/tests/test_cod_posting.py`

**Interfaces:**
- Consumes: `post_voucher`, `UnbalancedVoucher`, and the account constants from Task 2.
- Produces:
  - `record_cod_collection_from_shipment(db, business_id, shipment) -> list[FinancialTransaction] | None` — idempotent on voucher key `COD_COLLECTION:{shipment.id}`; returns `None` when the order is not COD or nothing is collected
  - `record_cod_remittance_from_shipment_financial(db, business_id, sf) -> list[FinancialTransaction] | None` — raises `CodSettlementMismatch` when `net_settlement + fee_amount + other_deduction` differs from `settled_amount` by more than ₹1
  - `class CodSettlementMismatch(ValueError)`
- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_cod_posting.py`:

```python
"""Task 4: COD collection and carrier remittance writers."""
from datetime import datetime, timezone

DT = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)


def _env():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    from app.models.business import Business
    from app.models.customer import Customer
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    c = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(c); db.commit(); db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-COD", shopify_order_id="g9",
              shopify_order_name="#2001", customer_id=c.id, currency="INR",
              subtotal_amount=1000.0, discount_amount=0, shipping_amount=0,
              tax_amount=180.0, total_amount=1180.0, payment_status="PENDING",
              financial_status="PENDING", cod_mode="COD", cod_value=1180.0,
              fulfillment_status="FULFILLED", operational_status="DELIVERED", order_date=DT)
    db.add(o); db.commit(); db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, reference_code="PC1")
    db.add(p); db.commit(); db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number="AWB1", tracking_status="DELIVERED", delivered_at=DT)
    db.add(s); db.commit(); db.refresh(s)
    return db, b, o, s


def _sf(db, b, s, **kw):
    from app.models.sla import ShipmentFinancial
    vals = dict(business_id=b.id, shipment_id=s.id, order_id=s.order_id,
                expected_cod_amount=1000.0, collected_amount=1000.0,
                settled_amount=950.0, fee_amount=40.0, other_deduction=10.0,
                net_settlement=900.0, settlement_reference="ST1",
                settlement_date=DT, status="SETTLED")
    vals.update(kw)
    f = ShipmentFinancial(**vals)
    db.add(f); db.commit(); db.refresh(f)
    return f


def test_cod_collection_moves_receivable_to_carrier():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_collection_from_shipment
    db, b, o, s = _env()
    s.tracking_status = "DELIVERED"
    db.commit()
    rows = record_cod_collection_from_shipment(db, b.id, s)
    db.commit()
    assert rows and len(rows) == 1
    assert rows[0].debit_account == "COD Receivable"
    assert rows[0].credit_account == "Customer / Receivable"
    assert str(rows[0].amount) == "1180.00"
    assert rows[0].pnl_class == "NONE"


def test_cod_collection_skipped_for_prepaid_order():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_collection_from_shipment
    db, b, o, s = _env()
    o.cod_mode = "PREPAID"
    db.commit()
    assert record_cod_collection_from_shipment(db, b.id, s) is None
    assert db.query(FinancialTransaction).count() == 0


def test_cod_collection_is_idempotent():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_collection_from_shipment
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)
    db.commit()
    record_cod_collection_from_shipment(db, b.id, s)
    db.commit()
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COD_COLLECTION").count() == 1


def test_cod_remit_balances_and_classifies_legs():
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    db, b, o, s = _env()
    f = _sf(db, b, s)
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    by = {(r.debit_account, r.credit_account): (str(r.amount), r.pnl_class) for r in rows}
    assert by[("Cash / Bank", "")] == ("900.00", "NONE")
    assert by[("Carrier Freight / Fees", "")] == ("40.00", "EXPENSE")
    assert by[("COD Deductions / Write-off", "")] == ("10.00", "EXPENSE")
    assert by[("", "COD Receivable")] == ("950.00", "NONE")


def test_cod_remit_then_collection_nets_receivable_to_zero():
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    from decimal import Decimal
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)
    f = _sf(db, b, s, collected_amount=1180.0, expected_cod_amount=1180.0,
            settled_amount=1130.0, fee_amount=40.0, other_deduction=10.0,
            net_settlement=1080.0)
    record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    from app.models.financial_transaction import FinancialTransaction
    rows = db.query(FinancialTransaction).filter(
        FinancialTransaction.debit_account == "COD Receivable",
        FinancialTransaction.credit_account == "COD Receivable").all()
    assert rows == []
    debits = sum((r.amount for r in db.query(FinancialTransaction)
                  .filter_by(transaction_type="COD_COLLECTION").all()), Decimal("0"))
    credits = sum((r.amount for r in db.query(FinancialTransaction)
                   .filter(FinancialTransaction.credit_account == "COD Receivable").all()),
                  Decimal("0"))
    assert debits == credits


def test_cod_remit_refuses_when_settlement_does_not_reconcile():
    from app.services.finance_posting import (
        CodSettlementMismatch, record_cod_remittance_from_shipment_financial)
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    f = _sf(db, b, s, settled_amount=999.0)  # 900 + 40 + 10 = 950 != 999
    try:
        record_cod_remittance_from_shipment_financial(db, b.id, f)
        raise AssertionError("expected CodSettlementMismatch")
    except CodSettlementMismatch as e:
        assert "950.00" in str(e) and "999.00" in str(e)
    assert db.query(FinancialTransaction).count() == 0


def test_cod_remit_skips_zero_fee_and_deduction_legs():
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    db, b, o, s = _env()
    f = _sf(db, b, s, settled_amount=1000.0, fee_amount=0.0, other_deduction=0.0,
            net_settlement=1000.0)
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    assert len(rows) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_cod_posting.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.finance_posting'`

- [ ] **Step 3: Implement the module**

Create `backend/app/services/finance_posting.py`:

```python
# backend/app/services/finance_posting.py
"""Domain-derived ledger postings (wave A §6).

Every function is idempotent on a stable voucher key and returns the posted
legs, or None when nothing is due. Balance is enforced upstream by post_voucher,
so a caller never has to re-check it.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

_Q = Decimal("0.01")
_TOLERANCE = Decimal("1.00")  # carriers round settlements to the rupee


class CodSettlementMismatch(ValueError):
    """A carrier settlement whose net + fee + deductions != settled amount.

    Posting it would book money that the carrier never sent, so it is refused
    and surfaced instead.
    """


def _d(v) -> Decimal:
    from app.services.ledger_service import _d as _ld
    return _ld(v)


def _is_cod(order) -> bool:
    return (getattr(order, "cod_mode", "") or "").strip().upper() == "COD"


def record_cod_collection_from_shipment(db: Session, business_id: str, shipment):
    """On delivery of a COD order, move the debt from the customer to the
    carrier (§6). Without this the COD loop cannot close: COD_REMIT would have
    nothing to credit.
    """
    from app.models.order import Order
    from app.services import ledger_service as ls
    order = db.query(Order).filter_by(id=shipment.order_id).first()
    if order is None or not _is_cod(order):
        return None
    if (shipment.tracking_status or "").upper() != "DELIVERED":
        return None
    amount = _d(order.cod_value or order.total_amount)
    if amount <= 0:
        return None
    return ls.post_voucher(
        db, business_id, "COD_COLLECTION",
        [{"debit": ls.ACC_COD_RECEIVABLE, "credit": ls.ACC_RECEIVABLE,
          "amount": amount, "pnl_class": "NONE"}],
        order_id=order.id, transaction_date=shipment.delivered_at,
        reference_number=shipment.awb_number,
        voucher_key=f"COD_COLLECTION:{shipment.id}")


def record_cod_remittance_from_shipment_financial(db: Session, business_id: str, sf):
    """Post a carrier COD settlement (§6).

    Dr Bank (net) / Dr Carrier Fee / Dr COD Deduction / Cr COD Receivable.
    """
    from app.services import ledger_service as ls
    if (sf.status or "").upper() not in ("SETTLED", "RECONCILED", "COMPLETED"):
        return None
    net, fee, ded = _d(sf.net_settlement), _d(sf.fee_amount), _d(sf.other_deduction)
    settled = _d(sf.settled_amount)
    cleared = net + fee + ded
    if abs(cleared - settled) > _TOLERANCE:
        raise CodSettlementMismatch(
            f"Settlement {sf.settlement_reference or sf.id} does not reconcile: "
            f"net {net} + fee {fee} + deductions {ded} = {cleared} != settled {settled}.")
    if cleared <= 0:
        return None
    legs = []
    if net > 0:
        legs.append({"debit": ls.ACC_BANK, "credit": "", "amount": net, "pnl_class": "NONE"})
    if fee > 0:
        legs.append({"debit": ls.ACC_CARRIER_FEE, "credit": "", "amount": fee,
                     "pnl_class": "EXPENSE"})
    if ded > 0:
        legs.append({"debit": ls.ACC_COD_DEDUCTION, "credit": "", "amount": ded,
                     "pnl_class": "EXPENSE"})
    legs.append({"debit": "", "credit": ls.ACC_COD_RECEIVABLE, "amount": cleared,
                 "pnl_class": "NONE"})
    return ls.post_voucher(
        db, business_id, "COD_REMIT", legs,
        order_id=sf.order_id, transaction_date=sf.settlement_date,
        reference_number=sf.settlement_reference,
        voucher_key=f"COD_REMIT:{sf.id}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_cod_posting.py -q`
Expected: 7 passed

- [ ] **Step 5: Run the regression suite**

Run: `python -m pytest tests/test_ledger.py tests/test_tally_hardening.py -q`
Expected: 24 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/finance_posting.py backend/tests/test_cod_posting.py
git commit -m "feat(ledger): COD collection and carrier remittance postings

COD_COLLECTION moves the receivable from customer to carrier on delivery;
COD_REMIT posts Dr Bank / Dr Carrier Fee / Dr COD Deduction / Cr COD
Receivable and refuses to post a settlement that does not reconcile."
```

---

### Task 5: Period cost writers, `ensure_period_postings`, kill switches, endpoint

**Files:**
- Modify: `backend/app/services/finance_posting.py`
- Create: `backend/tests/test_period_costs.py`
- Modify: `backend/app/config.py:20-67`
- Modify: `backend/app/api/ledger.py:103-118`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `post_voucher` (Task 2), `cost_service.get_cost` (existing), `settings` (existing).
- Produces:
  - `settings.ledger_auto_post_costs: bool` (default `True`), `settings.ledger_auto_post_cod: bool` (default `True`)
  - `post_period_costs(db, business_id, start, end, *, dry_run=False) -> dict` — returns `{"cogs": {...}, "shipping": {...}, "packaging": {...}, "gateway_fee": {...}}`, each `{"posted": int, "skipped": int, "would_post": int}`
  - `ensure_period_postings(db, business_id, start, end, *, dry_run=False) -> dict` — orchestrator; returns `{"period": {...}, "costs": {...}, "cod": {...}, "auto_posted": bool}`
  - `close_checks(db, business_id, year, month, post_costs=False) -> dict` — gains an opt-in `post_costs` flag so it stays a pure read for its GET caller; only `close_month` passes `True`
  - `POST /api/v1/ledger/post-period-costs?year=&month=` — ADMIN/ACCOUNTANT, returns the `ensure_period_postings` payload

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_period_costs.py`:

```python
"""Task 5: period cost postings, ensure_period_postings idempotency, kill switches."""
from datetime import datetime, timezone

START = datetime(2026, 9, 1, tzinfo=timezone.utc)
END = datetime(2026, 10, 1, tzinfo=timezone.utc)


def _env(shipping="70.00", packaging="15.00", gateway="20.00", cogs="200.00"):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    from app.models.business import Business
    from app.models.cost import CostRule
    from app.models.customer import Customer
    from app.models.order import Order, OrderItem
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    c = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(c); db.commit(); db.refresh(c)
    for i, (qty,) in enumerate([(2,)]):
        o = Order(business_id=b.id, internal_order_number=f"ORD-{i}",
                  shopify_order_id=f"g{i}", shopify_order_name=f"#{i}",
                  customer_id=c.id, currency="INR", subtotal_amount=1000.0,
                  discount_amount=0, shipping_amount=0, tax_amount=180.0,
                  total_amount=1180.0, payment_status="PAID", financial_status="PAID",
                  fulfillment_status="SHIPPED", operational_status="SHIPPED",
                  order_date=datetime(2026, 9, 10, tzinfo=timezone.utc))
        db.add(o); db.commit(); db.refresh(o)
        db.add(OrderItem(business_id=b.id, order_id=o.id, title="P", sku="S",
                         quantity=qty, price="500.00"))
        p = Parcel(business_id=b.id, order_id=o.id, reference_code=f"PC{i}")
        db.add(p); db.commit(); db.refresh(p)
        db.add(Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id,
                        carrier_code="DTDC", awb_number=f"AWB{i}",
                        tracking_status="IN_TRANSIT"))
    db.commit()
    for key, amt in (("COGS_DEFAULT", cogs), ("SHIPPING", shipping),
                     ("PACKAGING", packaging), ("GATEWAY_FEE", gateway)):
        db.add(CostRule(business_id=b.id, key=key, amount=float(amt), source="MANUAL",
                        effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc)))
    db.commit()
    return db, b


def test_period_costs_post_four_expense_types():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    post_period_costs(db, b.id, START, END)
    db.commit()
    got = {r.transaction_type: str(r.amount)
           for r in db.query(FinancialTransaction).all()}
    assert got["COGS"] == "400.00"          # 2 units x 200.00
    assert got["SHIPPING_EXPENSE"] == "70.00"
    assert got["PACKAGING_EXPENSE"] == "15.00"
    assert got["PAYMENT_GATEWAY_FEE"] == "20.00"
    assert all(r.pnl_class in ("EXPENSE", "COGS")
               for r in db.query(FinancialTransaction).all())


def test_period_cogs_debits_cogs_and_credits_inventory():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    post_period_costs(db, b.id, START, END)
    db.commit()
    r = db.query(FinancialTransaction).filter_by(transaction_type="COGS").one()
    assert r.debit_account == "Cost of Goods Sold"
    assert r.credit_account == "Inventory / Stock"
    assert r.pnl_class == "COGS"


def test_period_costs_idempotent_across_three_runs():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import ensure_period_postings
    db, b = _env()
    for _ in range(3):
        ensure_period_postings(db, b.id, START, END)
        db.commit()
    rows = db.query(FinancialTransaction).all()
    assert len(rows) == 4, [(r.transaction_type, str(r.amount)) for r in rows]


def test_dry_run_writes_nothing_but_reports_what_it_would_post():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    out = post_period_costs(db, b.id, START, END, dry_run=True)
    assert db.query(FinancialTransaction).count() == 0
    assert out["cogs"]["would_post"] == 1
    assert out["shipping"]["would_post"] == 1


def test_kill_switch_off_writes_nothing_but_still_reports():
    from app.models.financial_transaction import FinancialTransaction
    from app.config import settings
    from app.services.finance_posting import ensure_period_postings
    db, b = _env()
    original = settings.ledger_auto_post_costs
    settings.ledger_auto_post_costs = False
    try:
        out = ensure_period_postings(db, b.id, START, END)
        assert out["auto_posted"] is False
        assert out["costs"]["cogs"]["would_post"] == 1
    finally:
        settings.ledger_auto_post_costs = original
    assert db.query(FinancialTransaction).count() == 0


def test_ensure_period_postings_respects_date_bounds():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    post_period_costs(db, b.id, datetime(2026, 10, 1, tzinfo=timezone.utc),
                      datetime(2026, 11, 1, tzinfo=timezone.utc))
    db.commit()
    assert db.query(FinancialTransaction).count() == 0


def test_carrier_claim_is_postable_by_hand_via_the_api():
    """Spec §6: claims have no auto-writer. The generic POST /ledger route is the
    path, so it must accept the type and default to REVERSAL."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base, get_db
    import app.models  # noqa: F401
    from app.main import app
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    from app.models.sla import ShipmentCase
    from app.services import ledger_service as ls
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in",
             password_hash=hash_password("x"), role="ACCOUNTANT")
    db.add(u); db.commit()
    sc = ShipmentCase(business_id=b.id, shipment_id="sh-1", case_type="LOST",
                      claim_amount=450.00)
    db.add(sc); db.commit()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login",
                 json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = c.post("/api/v1/ledger", headers=h, json={
        "transaction_type": "CARRIER_CLAIM", "amount": "450.00", "tax_amount": "0.00",
        "transaction_date": "2026-09-20T00:00:00+00:00",
        "debit_account": ls.ACC_CARRIER_CLAIM, "credit_account": ls.ACC_SALES_RETURNS,
        "idempotency_key": f"CARRIER_CLAIM:{sc.id}"})
    assert r.status_code == 200, r.text
    row = r.json()["data"]
    assert row["transaction_type"] == "CARRIER_CLAIM"
    assert row["amount"] == "450.00"
    assert row["status"] == "POSTED"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_period_costs.py -q`
Expected: FAIL — `ImportError: cannot import name 'post_period_costs'`

- [ ] **Step 3: Add the kill switches to config**

In `backend/app/config.py`, add two fields after `shopify_client_secret: str = ""`:

```python
    # Ledger auto-posting (wave A §7). Both default ON; set either to false in
    # .env to make the writer a no-op that still reports what it would post, so
    # production can be dry-run before it is trusted.
    ledger_auto_post_costs: bool = True
    ledger_auto_post_cod: bool = True
```

- [ ] **Step 4: Implement the cost writers**

Append to `backend/app/services/finance_posting.py`:

```python
def _in_range(dt, start, end) -> bool:
    from app.services.ledger_service import _utc
    d = _utc(dt)
    return _utc(start) <= d < _utc(end)


def _counter(bucket: dict, key: str, n: int = 1) -> None:
    slot = bucket.setdefault(key, {"posted": 0, "skipped": 0, "would_post": 0})
    slot["posted"] += n


def _would(bucket: dict, key: str) -> None:
    slot = bucket.setdefault(key, {"posted": 0, "skipped": 0, "would_post": 0})
    slot["would_post"] += 1


def _already(db, business_id, voucher_key) -> bool:
    from app.models.financial_transaction import FinancialTransaction
    return db.query(FinancialTransaction).filter_by(
        business_id=business_id, voucher_group_id=voucher_key[:128]).first() is not None


def post_period_costs(db: Session, business_id: str, start, end, *,
                      dry_run: bool = False) -> dict:
    """Post the period's COGS, freight, packaging and gateway fees (§6).

    Freight is per shipment, the rest are per order. Cost figures come from
    ProductCostHistory where available and CostRule otherwise, so the source of
    each number stays traceable and monthly_report's ESTIMATED label stays honest.
    """
    from datetime import timedelta
    from app.config import settings
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order, OrderItem
    from app.models.shipment import Shipment
    from app.services import ledger_service as ls
    from app.services.cost_service import get_cost

    bucket: dict = {}
    orders = db.query(Order).filter_by(business_id=business_id).filter(
        Order.order_date >= ls._utc(start), Order.order_date < ls._utc(end)).all()
    anchor = ls._utc(end) - timedelta(microseconds=1)

    for o in orders:
        if dry_run:
            _would(bucket, "cogs")
        elif _already(db, business_id, f"COGS:{o.id}"):
            _counter(bucket, "cogs", 0)
        else:
            items = db.query(OrderItem).filter_by(order_id=o.id).all()
            total = Decimal("0.00")
            for it in items:
                unit, _src = get_cost(db, business_id, "COGS_DEFAULT", anchor,
                                      product_id=it.product_id)
                total += _d(unit) * int(it.quantity or 0)
            if total > 0:
                ls.post_voucher(
                    db, business_id, "COGS",
                    [{"debit": ls.ACC_COGS, "credit": ls.ACC_INVENTORY, "amount": total}],
                    order_id=o.id, transaction_date=o.order_date,
                    voucher_key=f"COGS:{o.id}")
                _counter(bucket, "cogs")
            else:
                _counter(bucket, "cogs", 0)

        for key, acct, ledger_key in (
                ("PACKAGING", ls.ACC_BANK, "PACKAGING_EXPENSE"),
                ("GATEWAY_FEE", ls.ACC_GATEWAY, "PAYMENT_GATEWAY_FEE")):
            amount, _src = get_cost(db, business_id, key, anchor)
            amount = _d(amount)
            if amount <= 0:
                _counter(bucket, ledger_key, 0)
                continue
            if dry_run:
                _would(bucket, ledger_key)
                continue
            if _already(db, business_id, f"{ledger_key}:{o.id}"):
                _counter(bucket, ledger_key, 0)
                continue
            ls.post_voucher(
                db, business_id, ledger_key,
                [{"debit": f"{ledger_key.title().replace('_', ' ')}", "credit": acct,
                  "amount": amount, "pnl_class": "EXPENSE"}],
                order_id=o.id, transaction_date=o.order_date,
                voucher_key=f"{ledger_key}:{o.id}")
            _counter(bucket, ledger_key)

    ships = db.query(Shipment).filter_by(business_id=business_id).all()
    for s in ships:
        o = next((x for x in orders if x.id == s.order_id), None)
        if o is None or not _in_range(o.order_date, start, end):
            continue
        amount, _src = get_cost(db, business_id, "SHIPPING", anchor)
        amount = _d(amount)
        if amount <= 0:
            _counter(bucket, "SHIPPING_EXPENSE", 0)
            continue
        if dry_run:
            _would(bucket, "SHIPPING_EXPENSE")
            continue
        if _already(db, business_id, f"SHIPPING_EXPENSE:{s.id}"):
            _counter(bucket, "SHIPPING_EXPENSE", 0)
            continue
        ls.post_voucher(
            db, business_id, "SHIPPING_EXPENSE",
            [{"debit": "Shipping Expense", "credit": ls.ACC_BANK, "amount": amount,
              "pnl_class": "EXPENSE"}],
            order_id=o.id, transaction_date=o.order_date,
            reference_number=s.awb_number, voucher_key=f"SHIPPING_EXPENSE:{s.id}")
        _counter(bucket, "SHIPPING_EXPENSE")

    if dry_run:
        db.rollback()
    return bucket


def ensure_period_postings(db: Session, business_id: str, start, end, *,
                           dry_run: bool = False) -> dict:
    """Single idempotent entry point for every auto-posted period posting (§7).

    Called from the Tally export, from month-close checks, and from
    POST /api/v1/ledger/post-period-costs. Idempotency keys make repeat calls
    no-ops, so calling it on every export is safe.
    """
    from app.config import settings
    from app.models.sla import ShipmentFinancial
    from app.services import ledger_service as ls

    auto_costs = bool(settings.ledger_auto_post_costs)
    auto_cod = bool(settings.ledger_auto_post_cod)
    costs = post_period_costs(db, business_id, start, end,
                              dry_run=dry_run or not auto_costs)
    cod: dict = {"posted": 0, "skipped": 0, "would_post": 0}
    if auto_cod and not dry_run:
        rows = db.query(ShipmentFinancial).filter_by(business_id=business_id).all()
        for sf in rows:
            if not _in_range(sf.settlement_date, start, end):
                continue
            if _already(db, business_id, f"COD_REMIT:{sf.id}"):
                cod["skipped"] += 1
                continue
            record_cod_remittance_from_shipment_financial(db, business_id, sf)
            cod["posted"] += 1
    return {
        "period": {"from": ls._utc(start).isoformat(), "to": ls._utc(end).isoformat()},
        "costs": costs,
        "cod": cod,
        "auto_posted": auto_costs and auto_cod,
    }
```

- [ ] **Step 5: Add the endpoint**

In `backend/app/api/ledger.py`, add after the `backfill` route (line 117):

```python
@router.post("/post-period-costs")
def post_period_costs_ep(year: int = Query(...), month: int = Query(...),
                         dry_run: bool = Query(default=False),
                         db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """Post this period's COGS, freight, packaging and gateway fees (wave A §7)."""
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    from app.services import accounting_service as acct
    from app.services.finance_posting import ensure_period_postings
    try:
        start, end = acct.month_window(year, month)
    except Exception:
        return _err(400, "BAD_REQUEST", "year/month must be integers")
    return {"success": True, "data": ensure_period_postings(
        db, u.get("business_id"), start, end, dry_run=dry_run)}
```

- [ ] **Step 6: Wire `ensure_period_postings` into the two WRITE paths only**

Spec §7 said "the top of `close_checks`", but the pre-flight scan ruled that out:
`close_checks` is reached from `GET /api/v1/accounting/periods/{year}/{month}`
(`accounting.py:50-55`), so posting there would write to the ledger from a read request,
and would break `test_final_fixes.py:72`, which hands `close_checks` a deliberately broken
session to prove it fails closed. `close_checks` therefore stays read-only and pure, and the
auto-post happens at the two write paths instead.

In `backend/app/services/accounting_service.py`, change the signature at line 91 and add the
guarded call as the first statement:

```python
def close_checks(db: Session, business_id: str, year: int, month: int,
                 post_costs: bool = False) -> dict:
    """The five checks from #76, plus unresolved ledger posting failures (#95, wave A §9).

    `post_costs` is False by default so this stays a pure read: it is called from
    GET /accounting/periods/{year}/{month} and must never write. Only close_month,
    which is a POST that actually changes state, passes True.
    """
    from app.services.finance_posting import ensure_period_postings
    start, end = month_window(year, month)
    if post_costs:
        ensure_period_postings(db, business_id, start, end)
```

And change the call in `close_month` at line 216 to:

```python
    checks = close_checks(db, business_id, year, month, post_costs=True)
```

In `backend/app/services/tally_service.py`, at the top of `generate_workbook_export`,
immediately after the `from app.models.tally import TallyExportRecord` import and before
`rows = collect_export_rows(...)`:

```python
    # An export must carry the period's freight and COGS, not just sales (wave A §7).
    # With no explicit window there is no period to post, so skip rather than guess.
    if date_from is not None and date_to is not None:
        from app.services.finance_posting import ensure_period_postings
        ensure_period_postings(db, business_id, date_from, date_to)
```

Add a test to `backend/tests/test_period_costs.py` proving `close_checks` stays read-only
by default:

```python
def test_close_checks_is_read_only_by_default():
    from app.models.financial_transaction import FinancialTransaction
    from app.services import accounting_service as acct
    db, b = _env()
    acct.close_checks(db, b.id, 2026, 9)
    db.commit()
    assert db.query(FinancialTransaction).count() == 0
```

- [ ] **Step 7: Document the switches in `.env.example`**

Append:

```
# Ledger auto-posting (wave A §7). Set either to false to make the writer a
# no-op that still reports what it would post — dry-run production first.
LEDGER_AUTO_POST_COSTS=true
LEDGER_AUTO_POST_COD=true
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `python -m pytest tests/test_period_costs.py -q`
Expected: 8 passed

- [ ] **Step 9: Run the full suite for regressions**

Run: `python -m pytest tests/ -q`
Expected: all pass, no new failures

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/finance_posting.py backend/app/services/tally_service.py backend/app/services/accounting_service.py backend/app/config.py backend/app/api/ledger.py backend/tests/test_period_costs.py .env.example
git commit -m "feat(ledger): auto-posted period costs with kill switches

Adds post_period_costs (COGS per order, freight per shipment, packaging and
gateway fees per order), the idempotent ensure_period_postings orchestrator
wired into the Tally export and close_month (never into close_checks, which
serves a GET), POST /ledger/post-period-costs, and LEDGER_AUTO_POST_COSTS / _COD
switches that turn a writer into a reporting dry run."
```

---

### Task 6: Readers classify P&L per leg; retire `to_double_entry`

**Files:**
- Modify: `backend/app/services/ledger_service.py:47-100,272-329`
- Modify: `backend/app/services/tally_service.py:139-150` (row projection must carry `pnl_class`)
- Test: `backend/tests/test_ledger_vouchers.py`

**Interfaces:**
- Consumes: `FinancialTransaction.pnl_class`, `DEFAULT_PNL_CLASS` (Task 1).
- Produces:
  - `pnl_class_of(row: dict) -> str` in `app.services.ledger_service` — returns `row["pnl_class"]` when present and valid, else `DEFAULT_PNL_CLASS[row["transaction_type"]]`, else `"NONE"`
  - `revenue_summary(txns: list[dict]) -> dict` — now reads `pnl_class` per row; the `CANCELLATION` branch is removed
  - `profit_summary(...)` — unchanged signature; `period_summary` gains `carrier_fees` and `cod_deductions` inputs and output lines
  - `period_summary(...) -> dict` — `profit` gains `carrier_fees` and `cod_deductions` keys
  - `order_timeline(...) -> list[dict]` — `double_entry` is now read from the stored legs

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ledger_vouchers.py`:

```python
def test_pnl_class_of_falls_back_to_transaction_type():
    from app.services.ledger_service import pnl_class_of
    assert pnl_class_of({"transaction_type": "SALE"}) == "REVENUE"
    assert pnl_class_of({"transaction_type": "PAYMENT"}) == "NONE"
    assert pnl_class_of({"transaction_type": "COD_REMIT", "pnl_class": "EXPENSE"}) == "EXPENSE"
    assert pnl_class_of({"transaction_type": "NOPE"}) == "NONE"


def test_revenue_summary_ignores_cancellation_amounts():
    from app.services.ledger_service import revenue_summary
    r = revenue_summary([
        {"transaction_type": "SALE", "amount": "1180.00", "tax_amount": "180.00"},
        {"transaction_type": "CANCELLATION", "amount": "1180.00", "tax_amount": "180.00"},
    ])
    assert r["gross_inclusive"] == "1180.00"
    assert r["net_inclusive"] == "1180.00"


def test_revenue_summary_uses_pnl_class_over_type():
    from app.services.ledger_service import revenue_summary
    # Both rows are COD_REMIT; only the fee leg may touch profit, and neither
    # may touch revenue.
    r = revenue_summary([
        {"transaction_type": "SALE", "amount": "1000.00", "tax_amount": "0.00"},
        {"transaction_type": "COD_REMIT", "amount": "900.00", "tax_amount": "0.00",
         "pnl_class": "NONE"},
    ])
    assert r["gross_inclusive"] == "1000.00"
    assert r["net_inclusive"] == "1000.00"


def test_period_summary_splits_carrier_fees_from_bank_leg():
    from datetime import datetime, timezone
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ls.record_event(db, b.id, "SALE", "1000.00", "0.00", transaction_date=dt, idempotency_key="S1")
    ls.post_voucher(db, b.id, "COD_REMIT", [
        {"debit": "Cash / Bank", "credit": "", "amount": "900.00", "pnl_class": "NONE"},
        {"debit": "Carrier Freight / Fees", "credit": "", "amount": "100.00",
         "pnl_class": "EXPENSE"},
        {"debit": "", "credit": "COD Receivable", "amount": "1000.00", "pnl_class": "NONE"},
    ], transaction_date=dt, voucher_key="CR1")
    db.commit()
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["profit"]["carrier_fees"] == "100.00"
    assert out["profit"]["operating_profit"] == "900.00"
    assert out["revenue"]["net_exclusive"] == "1000.00"


def test_order_timeline_reads_stored_legs():
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b = _db()
    ls.record_event(db, b.id, "SALE", "1180.00", "180.00",
                    debit_account="Customer / Receivable", credit_account="Sales Revenue",
                    idempotency_key="S9")
    db.commit()
    row = db.query(FinancialTransaction).first()
    row.order_id = "o-1"
    db.commit()
    items = ls.order_timeline(db, b.id, "o-1")
    assert len(items) == 1
    entry = items[0]["double_entry"][0]
    assert entry["debit"] == "Customer / Receivable"
    assert entry["credit"] == "Sales Revenue"
    assert entry["amount"] == "1180.00"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: FAIL — `ImportError: cannot import name 'pnl_class_of'`

- [ ] **Step 3: Add `pnl_class_of` and rework `revenue_summary`**

In `backend/app/services/ledger_service.py`, add immediately above `revenue_summary`:

```python
def pnl_class_of(row: dict) -> str:
    """Per-leg P&L class (§8).

    Prefers the stored `pnl_class`; falls back to the type default so rows
    written before the column existed — and the pure-function tests that pass
    dicts without it — keep classifying correctly.
    """
    explicit = (row.get("pnl_class") or "").strip().upper()
    if explicit in PNL_CLASSES:
        return explicit
    return DEFAULT_PNL_CLASS.get((row.get("transaction_type") or "").upper(), "NONE")
```

Replace the body of `revenue_summary` (current lines 72-100) with:

```python
def revenue_summary(txns: list[dict]) -> dict:
    """Revenue = Gross(SALE) - Refunds - negative Adjustments (§23, §8).

    Classification is per leg via pnl_class_of, so a COD_REMIT's bank leg never
    registers as revenue. CANCELLATION is a void marker and carries no amount,
    so it has no branch here at all.
    """
    gross = tax = refunds = refund_tax = disc = Decimal("0")
    for t in txns:
        cls = pnl_class_of(t)
        a, x = _d(t.get("amount")), _d(t.get("tax_amount"))
        if cls == "REVENUE":
            gross += a
            tax += x
        elif cls == "REVERSAL":
            refunds += a
            refund_tax += x
        elif (t.get("transaction_type") or "").upper() == "ADJUSTMENT" and a < 0:
            disc += -a
    net_inc = gross - refunds - disc
    net_tax = tax - refund_tax
    return {
        "gross_inclusive": _s(gross),
        "discounts": _s(disc),
        "refunds_inclusive": _s(refunds),
        "cancellations_inclusive": "0.00",
        "net_inclusive": _s(net_inc),
        "gst": _s(net_tax),
        "gross_exclusive": _s(gross - tax),
        "net_exclusive": _s(net_inc - net_tax),
    }
```

> `cancellations_inclusive` is retained as a key so existing consumers do not break, but it is now always `"0.00"` because cancellation carries no amount. Wave C may remove it once its consumers are updated.

- [ ] **Step 4: Add carrier fees to `profit_summary` and `period_summary`**

Change the `profit_summary` signature to accept two new keyword arguments with defaults, so existing positional and keyword callers keep working:

```python
def profit_summary(net_sales_exclusive, cogs="0", shipping="0", packaging="0",
                   gateway_fees="0", other="0", costs_complete=True,
                   missing_cogs_count=0, carrier_fees="0", cod_deductions="0") -> dict:
    """Net Sales - COGS = Gross; Gross - direct exp = Operating (§24, §8)."""
    net, c, s, p, g, o, cf, cd = (_d(v) for v in (
        net_sales_exclusive, cogs, shipping, packaging, gateway_fees, other,
        carrier_fees, cod_deductions))
    gross_profit = net - c
    operating = gross_profit - s - p - g - o - cf - cd
    label = "OPERATING PROFIT" if costs_complete else "ESTIMATED OPERATING PROFIT"
    warning = "" if costs_complete else (
        f"Profit calculation incomplete: COGS missing for {int(missing_cogs_count)} products.")
    margin = (operating / net * 100).quantize(_Q, rounding=ROUND_HALF_UP) if net != 0 else Decimal("0.00")
    return {
        "net_sales_exclusive": _s(net), "cogs": _s(c), "gross_profit": _s(gross_profit),
        "shipping": _s(s), "packaging": _s(p), "gateway_fees": _s(g), "other": _s(o),
        "carrier_fees": _s(cf), "cod_deductions": _s(cd),
        "operating_profit": _s(operating), "label": label, "warning": warning,
        "margin_pct": _s(margin),
    }
```

In `period_summary` (current lines 288-329), change the row projection to carry `pnl_class`, replace the `_sum` type-based calls with class-based sums, and pass the new arguments:

```python
    txns = [{"transaction_type": r.transaction_type, "amount": str(r.amount),
             "tax_amount": str(r.tax_amount), "pnl_class": r.pnl_class} for r in rows]
    rev = revenue_summary(txns)

    def _sum_cls(*classes):
        return _s(sum((_d(r.amount) for r in rows
                       if pnl_class_of({"transaction_type": r.transaction_type,
                                        "pnl_class": r.pnl_class}) in classes),
                      Decimal("0")))

    cogs_v, ship_v, pack_v, fee_v, other_v = (
        _sum_cls("COGS"),
        _sum("SHIPPING_EXPENSE"),
        _sum("PACKAGING_EXPENSE"),
        _sum("PAYMENT_GATEWAY_FEE"),
        _sum("OTHER_EXPENSE"))
    def _sum_acct(account):
        return _s(sum((_d(r.amount) for r in rows
                       if r.debit_account == account), Decimal("0")))

    carrier_v = _sum_acct(ACC_CARRIER_FEE)
    ded_v = _sum_acct(ACC_COD_DEDUCTION)
```

Replace the final `profit = profit_summary(...)` call and return dict with:

```python
    carrier_v = _sum_acct(ACC_CARRIER_FEE)
    ded_v = _sum_acct(ACC_COD_DEDUCTION)
    profit = profit_summary(rev["net_exclusive"], cogs_v, ship_v, pack_v, fee_v, other_v,
                            costs_complete=(missing == 0), missing_cogs_count=missing,
                            carrier_fees=carrier_v, cod_deductions=ded_v)
    return {
        "revenue": rev, "profit": profit,
        "cogs_total": cogs_v, "transaction_count": len(rows),
        "display_timezone": DISPLAY_TZ,
        "period": {"from": _utc(start).isoformat(), "to": _utc(end).isoformat()},
    }
```

> Carrier fees and COD deductions share the `EXPENSE` class with shipping, packaging and
> gateway fees, so they are separated by their debit account rather than by class. That is
> the one place the plan keys on an account name, and it is exact because Task 2 owns
> those constants.

- [ ] **Step 5: Make `order_timeline` read stored legs**

Replace the `double_entry` key in `order_timeline` (current line 282-284) with a read of the stored leg:

```python
    return [{
        "transaction_id": r.transaction_id, "transaction_type": r.transaction_type,
        "amount": str(r.amount), "tax_amount": str(r.tax_amount), "net_amount": str(r.net_amount),
        "currency": r.currency, "transaction_date": r.transaction_date.isoformat() if r.transaction_date else None,
        "transaction_date_ist": to_ist_iso(r.transaction_date),
        "debit_account": r.debit_account, "credit_account": r.credit_account,
        "pnl_class": r.pnl_class,
        # The double entry IS the stored leg now that vouchers are balance-checked
        # (wave A §8). Re-deriving it here is what produced hardcoded account
        # names that ignored the configured ledger mapping.
        "double_entry": [{"debit": r.debit_account, "credit": r.credit_account,
                          "amount": _s(Decimal(str(r.amount)))}],
    } for r in rows]
```

Leave the `to_double_entry` function itself in place and unimported — `test_ledger.py:14-21` and `:67-76` still exercise it directly, and no application code may call it.

- [ ] **Step 6: Carry `pnl_class` through the Tally row projection**

In `backend/app/services/tally_service.py`, in `collect_export_rows`, add one key to the row dict after `"credit_account"`:

```python
            "pnl_class": t.pnl_class or "NONE",
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python -m pytest tests/test_ledger_vouchers.py -q`
Expected: 17 passed

- [ ] **Step 8: Run the full suite for regressions**

Run: `python -m pytest tests/ -q`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/ledger_service.py backend/app/services/tally_service.py backend/tests/test_ledger_vouchers.py
git commit -m "refactor(ledger): classify P&L per leg instead of per type

revenue_summary and period_summary read pnl_class so a COD_REMIT's bank leg
never counts as revenue while its fee and deduction legs do. Carrier fees
and COD deductions become visible lines in the profit summary, and
order_timeline reads the stored leg instead of re-deriving it."
```

---

### Task 7: Silent event loss becomes a durable, close-blocking record

**Files:**
- Modify: `backend/app/services/ledger_service.py` (the four `record_*` hooks)
- Modify: `backend/app/services/webhook_service.py:77-83,113-118`
- Modify: `backend/app/services/accounting_service.py:102-105,205-209`
- Create: `backend/tests/test_posting_failures.py`

**Interfaces:**
- Consumes: `LedgerPostingFailure` (Task 1).
- Produces:
  - `record_posting_failure(db, business_id, source_type, source_id, event_type, reason) -> LedgerPostingFailure` in `app.services.ledger_service`
  - `safe_post(db, business_id, source_type, source_id, event_type)` — a context manager in `app.services.ledger_service` that runs a posting, and on exception rolls back, records a committed failure row, and re-raises nothing (so the webhook continues)
  - `close_checks(...) -> dict` gains a `ledger_posting_failures` issue list

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_posting_failures.py`:

```python
"""Task 7: hooks raise, the webhook records a durable failure, close is blocked."""
from datetime import datetime, timezone

DT = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)


def _db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    from app.models.business import Business
    from app.models.customer import Customer
    from app.models.order import Order
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    c = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(c); db.commit(); db.refresh(c)
    o = Order(business_id=b.id, internal_order_number="ORD-F", shopify_order_id="gf",
              shopify_order_name="#F1", customer_id=c.id, currency="INR",
              subtotal_amount=1000.0, discount_amount=0, shipping_amount=0,
              tax_amount=180.0, total_amount=1180.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED",
              operational_status="NEW", order_date=DT)
    db.add(o); db.commit(); db.refresh(o)
    return db, b, o


def test_record_sale_hook_raises_instead_of_returning_none():
    from app.services import ledger_service as ls
    from app.models.order import Order
    db, b, o = _db()
    bad = Order(business_id=b.id, internal_order_number="ORD-BAD", shopify_order_id="gbad",
                shopify_order_name="#BAD", total_amount=None, tax_amount=None,
                order_date=DT)
    db.add(bad); db.commit(); db.refresh(bad)
    bad.total_amount = "not-a-number"
    try:
        ls.record_sale_from_order(db, b.id, bad)
        raise AssertionError("expected the hook to raise, not swallow")
    except Exception:
        pass


def test_safe_post_records_a_failure_and_does_not_propagate():
    from app.services import ledger_service as ls
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b, o = _db()

    def boom():
        raise ValueError("closed period")

    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        boom()
    rows = db.query(LedgerPostingFailure).all()
    assert len(rows) == 1
    assert rows[0].event_type == "SALE"
    assert "closed period" in rows[0].reason
    assert rows[0].resolved_at is None


def test_close_checks_blocks_on_unresolved_posting_failures():
    from app.services import accounting_service as acct
    from app.services import ledger_service as ls
    db, b, o = _db()
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "REFUND"):
        raise ValueError("nope")
    db.commit()
    out = acct.close_checks(db, b.id, 2026, 9)
    assert len(out["checks"]["ledger_posting_failures"]) == 1
    assert out["counts"]["ledger_posting_failures"] == 1
    assert out["total"] > 0


def test_resolved_failure_does_not_block_close():
    from datetime import datetime, timezone
    from app.models.ledger_posting_failure import LedgerPostingFailure
    from app.services import accounting_service as acct
    from app.services import ledger_service as ls
    db, b, o = _db()
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "REFUND"):
        raise ValueError("nope")
    db.commit()
    f = db.query(LedgerPostingFailure).one()
    f.resolved_at = datetime.now(timezone.utc)
    db.commit()
    out = acct.close_checks(db, b.id, 2026, 9)
    assert out["checks"]["ledger_posting_failures"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_posting_failures.py -q`
Expected: FAIL — `ImportError: cannot import name 'safe_post'`

- [ ] **Step 3: Add `safe_post` and `record_posting_failure`**

In `backend/app/services/ledger_service.py`, add after `record_event`:

```python
def record_posting_failure(db: Session, business_id: str, source_type: str,
                           source_id: str, event_type: str, reason: str):
    """Durably record a ledger posting that failed (§9).

    The webhook path must not 500 because the ledger rejected an event, but it
    must not silently drop one either. This converts "lost revenue nobody can
    see" into "a month you cannot close until it is fixed".
    """
    from app.models.ledger_posting_failure import LedgerPostingFailure
    f = LedgerPostingFailure(business_id=business_id, source_type=source_type,
                             source_id=str(source_id), event_type=event_type,
                             reason=str(reason)[:2000], attempts=1)
    db.add(f)
    db.commit()
    return f


@contextmanager
def safe_post(db: Session, business_id: str, source_type: str, source_id: str,
              event_type: str):
    """Run a ledger posting; on failure, record it durably and carry on.

    Swallows the exception so the caller (typically a Shopify webhook) can finish
    its own work, but never loses the event: the failure row is committed before
    the context exits. `db` and `business_id` are explicit parameters rather than
    ambient state, so a failure is always attributable to the right business.
    """
    try:
        yield
    except Exception as exc:
        try:
            db.rollback()
            record_posting_failure(db, business_id, source_type, source_id,
                                   event_type, f"{type(exc).__name__}: {exc}")
        except Exception:
            pass
```

`db.rollback()` before recording matters: a failed posting inside `post_voucher` may
have left a nested savepoint or a partially-flushed batch, and the failure row must be
the only thing committed by this context.

- [ ] **Step 4: Remove the swallowing `except` from the four hooks**

In `backend/app/services/ledger_service.py`, delete the trailing
`except Exception:\n        return None` from `record_sale_from_order` and
`record_payment_from_payment`. `record_cancellation` and `record_refund_from_refund`
were already rewritten without it in Task 3, so nothing else needs changing here.

`record_sale_from_order` becomes:

```python
def record_sale_from_order(db: Session, business_id: str, order) -> list:
    return record_event(
        db, business_id, "SALE", order.total_amount or 0, order.tax_amount or 0,
        transaction_date=getattr(order, "order_date", None), order_id=order.id,
        currency=getattr(order, "currency", "INR") or "INR",
        debit_account=ACC_RECEIVABLE, credit_account=ACC_SALES,
        reference_number=getattr(order, "shopify_order_name", None),
        idempotency_key=f"SALE:{order.id}",
        tally_voucher_type="Sales",
        tally_voucher_number=getattr(order, "shopify_order_name", None),
    )
```

`record_payment_from_payment` likewise returns its `record_event` call directly, with
debit `ACC_GATEWAY` and credit `ACC_RECEIVABLE`.

Update the return annotation on both from `FinancialTransaction | None` to `list`.

- [ ] **Step 5: Wrap the webhook ledger calls**

In `backend/app/services/webhook_service.py`, replace the cancellation hook (lines 77-83) with:

```python
            from app.services import ledger_service as ls
            with ls.safe_post(db, business_id, "SHOPIFY_WEBHOOK",
                              str(payload.get("id", "")), "CANCELLATION"):
                ls.record_cancellation(db, business_id, o)
                db.commit()
```

And the refund hook (lines 113-118) with:

```python
        from app.services import ledger_service as ls
        with ls.safe_post(db, business_id, "SHOPIFY_WEBHOOK", rid, "REFUND"):
            ls.record_refund_from_refund(db, business_id, r, order=o)
            db.commit()
```

- [ ] **Step 6: Make `close_checks` block on unresolved failures**

In `backend/app/services/accounting_service.py`, add `"ledger_posting_failures": []` to the `issues` dict (line 104), and add this block immediately before `total = sum(len(v) for v in issues.values())` (line 205):

```python
    try:
        from app.models.ledger_posting_failure import LedgerPostingFailure
        for f in db.query(LedgerPostingFailure).filter_by(business_id=business_id).filter(
                LedgerPostingFailure.resolved_at.is_(None)).all():
            issues["ledger_posting_failures"].append(str(f.id))
    except Exception as exc:
        _block("ledger_posting_failures", exc)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python -m pytest tests/test_posting_failures.py -q`
Expected: 4 passed

- [ ] **Step 8: Run the full suite for regressions**

Run: `python -m pytest tests/ -q`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/ledger_service.py backend/app/services/webhook_service.py backend/app/services/accounting_service.py backend/tests/test_posting_failures.py
git commit -m "fix(ledger): stop silently dropping ledger events

record_* hooks raise instead of returning None. The webhook wraps postings in
safe_post, which records a durable ledger_posting_failures row and commits it
before continuing, and month close is blocked until it is resolved."
```

---

### Task 8: Data remediation migration for existing production rows

**Files:**
- Create: `backend/alembic/versions/0021_ledger_remediation.py`
- Create: `backend/tests/test_migration_0021.py`

**Interfaces:**
- Consumes: nothing at runtime (standalone SQL).
- Produces: migration `0021_ledger_remediation` with module-level `REMEDIATION_SQL`, and a documented operator runbook.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_migration_0021.py`:

```python
"""Task 8: the remediation zeroes amount-bearing CANCELLATION rows exactly once."""
import importlib.util
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mod():
    path = os.path.join(BACKEND, "alembic", "versions", "0021_ledger_remediation.py")
    spec = importlib.util.spec_from_file_location("m0021", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _seed(db):
    from sqlalchemy import text
    rows = [
        ("a1", "TXN-1", "CANCELLATION", "1180.00", "180.00", "1000.00"),
        ("a2", "TXN-2", "CANCELLATION", "0.00", "0.00", "0.00"),
        ("a3", "TXN-3", "SALE", "1180.00", "180.00", "1000.00"),
        ("a4", "TXN-4", "REFUND", "590.00", "0.00", "590.00"),
    ]
    for rid, tid, typ, amt, tax, net in rows:
        db.execute(text(
            "INSERT INTO financial_transactions (id, business_id, transaction_id, "
            "transaction_type, transaction_date, amount, tax_amount, net_amount, "
            "currency, idempotency_key, pnl_class, leg_index) VALUES "
            "(:i,'b1',:t,:ty,'2026-09-01',:a,:x,:n,'INR',:k,'NONE',0)"),
            {"i": rid, "t": tid, "ty": typ, "a": amt, "x": tax, "n": net, "k": "k" + rid})
    db.commit()


def test_remediation_zeroes_only_amount_bearing_cancellations():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    _seed(db)
    mod = _mod()
    for stmt in mod.REMEDIATION_SQL:
        db.execute(text(stmt))
    db.commit()
    got = {r[0]: (r[1], r[2], r[3]) for r in db.execute(text(
        "SELECT id, amount, tax_amount, net_amount FROM financial_transactions")).all()}
    assert got["a1"] == ("0.00", "0.00", "0.00")
    assert got["a2"] == ("0.00", "0.00", "0.00")
    assert got["a3"] == ("1180.00", "180.00", "1000.00")   # untouched
    assert got["a4"][1] == "0.00"                          # untouched


def test_remediation_is_idempotent():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    _seed(db)
    mod = _mod()
    for _ in range(3):
        for stmt in mod.REMEDIATION_SQL:
            db.execute(text(stmt))
    db.commit()
    n = db.execute(text(
        "SELECT count(*) FROM financial_transactions "
        "WHERE transaction_type='CANCELLATION' AND amount <> 0")).scalar()
    assert n == 0


def test_migration_docstring_records_the_immutability_exception():
    mod = _mod()
    doc = (mod.__doc__ or "")
    assert "ADJUSTMENT" in doc
    assert "immutab" in doc.lower() or "append-only" in doc.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migration_0021.py -q`
Expected: FAIL — `FileNotFoundError` for `0021_ledger_remediation.py`

- [ ] **Step 3: Write the migration**

Create `backend/alembic/versions/0021_ledger_remediation.py`:

```python
"""0021 ledger remediation: repair mis-encoded CANCELLATION amounts (wave A §10).

Deliberate, documented exception to the append-only rule: this migration UPDATEs
existing rows in place instead of posting ADJUSTMENT reversals. The amounts being
zeroed were never real economic events - they were a write-side encoding bug in
record_cancellation, which wrote the full order total on a paid cancellation
while the refund also wrote its own reversal. Posting reversals would double the
correction, so the wrong encoding is repaired directly. This alembic revision is
the audit trail for that change.

Before running, record the expected row count:
    SELECT count(*) FROM financial_transactions
     WHERE transaction_type = 'CANCELLATION' AND amount <> 0;
After running, that query must return 0.
"""
from alembic import op

revision = "0021_ledger_remediation"
down_revision = "0020_ledger_vouchers"
branch_labels = None
depends_on = None

REMEDIATION_SQL = [
    "UPDATE financial_transactions SET amount = 0, tax_amount = 0, net_amount = 0 "
    "WHERE transaction_type = 'CANCELLATION' AND amount <> 0",
]


def upgrade():
    for stmt in REMEDIATION_SQL:
        op.execute(stmt)


def downgrade():
    # Irreversible by design: the original amounts were wrong, so there is
    # nothing correct to restore.
    pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_migration_0021.py -q`
Expected: 3 passed

- [ ] **Step 5: Add the operator runbook to README**

Append to `README.md` under the existing ops/checklist section:

```markdown
### Ledger remediation (migration 0021)

Wave A repairs rows written by the old cancellation bug. Take a backup, then:

1. `SELECT count(*) FROM financial_transactions WHERE transaction_type = 'CANCELLATION' AND amount <> 0;`
2. `alembic upgrade head`
3. Re-run step 1 — it must return `0`. The two numbers must match.

`LEDGER_AUTO_POST_COSTS` and `LEDGER_AUTO_POST_COD` default to on. Run
`POST /api/v1/ledger/post-period-costs?year=&month=&dry_run=true` for the
current and prior month and review the output before leaving them on.
```

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/0021_ledger_remediation.py backend/tests/test_migration_0021.py README.md
git commit -m "fix(ledger): remediate amount-bearing CANCELLATION rows

Documents the one deliberate append-only exception: the amounts were a
write-side encoding bug, not real economic events, so they are repaired in
place rather than reversed. Includes the operator runbook and its
before/after row-count check."
```

---

## Deferred to later waves

- `_next_txn_id` recomputes the identical id after an `IntegrityError`, so a genuine `transaction_id` collision (possible only if rows were deleted) burns all 5 retries. `test_ledger.py:206` exercises the retry loop but not that case. Not in wave A scope.
- Wave B: Tally XML exporter, single-sided Receipts/Expenses sheets, per-line HSN/GSTIN, ledger-name resolution on every sheet, the dead completeness gate, duplicate-export blocking on abandoned batches, UTC/IST export-boundary drift.
- Wave C: `monthly_report`'s second P&L, `payments_pending`, the legacy `POST /api/v1/tally/export` CSV endpoint.