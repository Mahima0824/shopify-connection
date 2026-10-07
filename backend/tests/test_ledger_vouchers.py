"""Task 1: voucher columns, new transaction types, pnl_class backfill, failure model."""
import importlib.util
import os

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

    source = open(path, encoding="utf-8").read()
    # BACKFILL_SQL only backfills pnl_class; voucher_group_id is declared in upgrade().
    assert 'sa.Column("voucher_group_id", sa.String(128), nullable=True)' in source
    assert 'sa.Column("pnl_class", sa.String(16), server_default="NONE", nullable=False)' in source

    eng = _engine()
    db = sessionmaker(bind=eng)()
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