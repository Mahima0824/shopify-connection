"""Task 1: voucher columns, new transaction types, pnl_class backfill, failure model."""
import importlib.util
import os
import re

import pytest
from sqlalchemy.exc import IntegrityError

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M0020 = os.path.join(BACKEND, "alembic", "versions", "0020_ledger_vouchers.py")


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return eng


def _squash(text: str) -> str:
    """Normalise source for comparison: drop all whitespace and trailing commas.

    Lets a DDL assertion survive re-wrapping/indentation without weakening it -
    a real deletion still changes the squashed text and fails the check.
    """
    return re.sub(r"\s+", "", text).replace(",)", ")")


def _migration_source() -> str:
    with open(M0020, encoding="utf-8") as fh:
        return _squash(fh.read())


def _business_session():
    from sqlalchemy.orm import sessionmaker
    from app.models.business import Business
    db = sessionmaker(bind=_engine())()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    return db, b


def test_new_transaction_types_present():
    from app.models.financial_transaction import TRANSACTION_TYPES
    for t in ("COD_COLLECTION", "COD_REMIT", "CARRIER_CLAIM", "REFUND_PAYOUT"):
        assert t in TRANSACTION_TYPES, t


def test_financial_transaction_has_voucher_columns():
    from sqlalchemy import Integer, String
    from app.models.financial_transaction import FinancialTransaction, PNL_CLASSES
    cols = FinancialTransaction.__table__.columns
    assert "voucher_group_id" in cols
    assert "leg_index" in cols
    assert "pnl_class" in cols
    assert PNL_CLASSES == ("REVENUE", "COGS", "EXPENSE", "REVERSAL", "NONE")

    # Types, nullability and Python-side defaults are plan-mandated, so pin them.
    group = cols["voucher_group_id"]
    assert isinstance(group.type, String)
    assert group.type.length == 128
    assert group.nullable is True

    leg = cols["leg_index"]
    assert isinstance(leg.type, Integer)
    assert leg.nullable is False
    assert leg.default is not None and leg.default.arg == 0

    pnl = cols["pnl_class"]
    assert isinstance(pnl.type, String)
    assert pnl.type.length == 16
    assert pnl.nullable is False
    assert pnl.default is not None and pnl.default.arg == "NONE"


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
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b = _business_session()
    f = LedgerPostingFailure(business_id=b.id, source_type="SHOPIFY_WEBHOOK",
                             source_id="gid://1", event_type="REFUND",
                             reason="boom", attempts=1)
    db.add(f)
    db.commit()
    db.refresh(f)
    assert f.id and f.resolved_at is None
    assert f.created_at is not None


def test_ledger_posting_failure_rejects_duplicate_source():
    """A retried posting failure must not pile up duplicate rows."""
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b = _business_session()
    same = dict(business_id=b.id, source_type="SHOPIFY_WEBHOOK", source_id="gid://1",
                event_type="REFUND", reason="boom", attempts=1)
    db.add(LedgerPostingFailure(**same))
    db.commit()
    db.add(LedgerPostingFailure(**same))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_ledger_posting_failure_allows_a_different_event_type():
    """Same source, different event -> a genuinely distinct failure, so allowed."""
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b = _business_session()
    common = dict(business_id=b.id, source_type="SHOPIFY_WEBHOOK", source_id="gid://1",
                  reason="boom", attempts=1)
    db.add(LedgerPostingFailure(**common, event_type="REFUND"))
    db.add(LedgerPostingFailure(**common, event_type="SALE"))
    db.commit()
    assert db.query(LedgerPostingFailure).count() == 2


def test_ledger_posting_failure_is_indexed_for_unresolved_queries():
    """Month close scans unresolved rows per business; that must not full-scan."""
    from app.models.ledger_posting_failure import LedgerPostingFailure
    indexes = {ix.name: tuple(c.name for c in ix.columns)
               for ix in LedgerPostingFailure.__table__.indexes}
    assert ("business_id", "resolved_at") in indexes.values(), indexes
    unique = {tuple(c.name for c in uq.columns)
              for uq in LedgerPostingFailure.__table__.constraints
              if uq.__class__.__name__ == "UniqueConstraint"}
    assert ("business_id", "source_type", "source_id", "event_type") in unique, unique


def test_migration_0020_declares_every_ledger_ddl_statement():
    """Every DDL statement in 0020 is load-bearing and none of it is executable here.

    upgrade() cannot be run against Base.metadata.create_all (it already builds the
    post-0020 schema) and `alembic upgrade head` is impossible on SQLite because
    0001/0004 use Postgres JSONB. So these are squashed-source assertions: immune to
    re-wrapping, but a deleted statement fails.
    """
    src = _migration_source()
    for fragment in (
        'op.add_column("financial_transactions", sa.Column("voucher_group_id", sa.String(128), nullable=True))',
        'op.add_column("financial_transactions", sa.Column("leg_index", sa.Integer(), server_default="0", nullable=False))',
        'op.add_column("financial_transactions", sa.Column("pnl_class", sa.String(16), server_default="NONE", nullable=False))',
        'op.create_index("ix_fintxn_biz_group", "financial_transactions", ["business_id", "voucher_group_id"])',
        'op.add_column("shipment_cases", sa.Column("claim_amount", sa.Numeric(12, 2), nullable=True))',
        'op.create_table("ledger_posting_failures"',
        'sa.Column("id", sa.String(36), primary_key=True)',
        'sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False)',
        'sa.Column("source_type", sa.String(32), nullable=False)',
        'sa.Column("source_id", sa.String(128), nullable=False)',
        'sa.Column("event_type", sa.String(32), nullable=False)',
        'sa.Column("reason", sa.Text(), nullable=False)',
        'sa.Column("attempts", sa.Integer(), server_default="1", nullable=False)',
        'sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True)',
        'sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)',
        'sa.UniqueConstraint("business_id", "source_type", "source_id", "event_type",',
        'op.drop_table("ledger_posting_failures")',
        'op.drop_column("shipment_cases", "claim_amount")',
        'op.drop_index("ix_fintxn_biz_group"',
        'op.drop_column("financial_transactions", "pnl_class")',
        'op.drop_column("financial_transactions", "leg_index")',
        'op.drop_column("financial_transactions", "voucher_group_id")',
    ):
        assert _squash(fragment) in src, fragment


def test_migration_0020_backfills_pnl_class():
    """The migration is self-contained SQL; this executes the exact statements."""
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker
    spec = importlib.util.spec_from_file_location("m0020", M0020)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    db = sessionmaker(bind=_engine())()
    # debit_account/credit_account/status are supplied because their defaults are
    # Python-side (mapped_column default=...), which raw SQL inserts bypass.
    db.execute(text("INSERT INTO financial_transactions "
                    "(id, business_id, transaction_id, transaction_type, transaction_date, "
                    "amount, tax_amount, net_amount, currency, idempotency_key, "
                    "pnl_class, leg_index, debit_account, credit_account, status) VALUES "
                    "('x1','b1','TXN-1','SALE','2026-09-01','1000.00','0.00','1000.00',"
                    "'INR','k1','NONE',0,'Dr Sales','Cr Receivable','POSTED')"))
    db.execute(text("INSERT INTO financial_transactions "
                    "(id, business_id, transaction_id, transaction_type, transaction_date, "
                    "amount, tax_amount, net_amount, currency, idempotency_key, "
                    "pnl_class, leg_index, debit_account, credit_account, status) VALUES "
                    "('x2','b1','TXN-2','PAYMENT','2026-09-01','1000.00','0.00','1000.00',"
                    "'INR','k2','REVENUE',0,'Dr Bank','Cr Receivable','POSTED')"))
    db.commit()
    for stmt in mod.BACKFILL_SQL:
        db.execute(text(stmt))
    db.commit()
    rows = {r.id: r.pnl_class for r in
            db.execute(text("SELECT id, pnl_class FROM financial_transactions")).all()}
    assert rows["x1"] == "REVENUE"
    assert rows["x2"] == "NONE"
