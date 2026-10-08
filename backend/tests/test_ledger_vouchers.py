"""Task 1: voucher columns, new transaction types, pnl_class backfill, failure model.
Task 2: post_voucher - the balance-enforced multi-leg write primitive."""
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
    from sqlalchemy import UniqueConstraint
    from app.models.ledger_posting_failure import LedgerPostingFailure
    indexes = {ix.name: tuple(c.name for c in ix.columns)
               for ix in LedgerPostingFailure.__table__.indexes}
    assert ("business_id", "resolved_at") in indexes.values(), indexes
    unique = {tuple(c.name for c in uq.columns)
              for uq in LedgerPostingFailure.__table__.constraints
              if isinstance(uq, UniqueConstraint)}
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


# --- Task 2: post_voucher ---

def _db():
    from sqlalchemy.orm import sessionmaker
    from app.models.business import Business
    db = sessionmaker(bind=_engine())()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    return db, b


def test_post_voucher_rejects_unbalanced_and_writes_nothing():
    """Legs name a single side each (that is how a real voucher is built: two
    credits against one debit); 1100.00 debited with nothing credited is not a
    voucher, so nothing may reach the ledger."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import UnbalancedVoucher, post_voucher
    db, b = _db()
    legs = [{"debit": "Cash / Bank", "amount": "1000.00"},
            {"debit": "Carrier Freight / Fees", "amount": "100.00"}]
    try:
        post_voucher(db, b.id, "COD_REMIT", legs)
        raise AssertionError("expected UnbalancedVoucher")
    except UnbalancedVoucher as e:
        assert "1100.00" in str(e) and "0.00" in str(e), str(e)
    assert db.query(FinancialTransaction).count() == 0


def test_post_voucher_rejects_a_voucher_off_by_one_paisa():
    """The tolerance is exactly one cent, not 'close enough'."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import UnbalancedVoucher, post_voucher
    db, b = _db()
    legs = [{"debit": "COD Receivable", "amount": "1000.00"},
            {"credit": "Cash / Bank", "amount": "900.00"},
            {"credit": "COD Deductions / Write-off", "amount": "99.99"}]
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


def _legacy_row(db, b, txn_id, key):
    """A row written before migration 0020: pnl_class backfilled, group id never
    populated, so voucher_group_id IS NULL exactly as in production."""
    from datetime import datetime, timezone
    from decimal import Decimal
    from app.models.financial_transaction import FinancialTransaction
    row = FinancialTransaction(
        business_id=b.id, transaction_id=txn_id, transaction_type="SALE",
        transaction_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
        amount=Decimal("100.00"), tax_amount=Decimal("0.00"),
        net_amount=Decimal("100.00"), currency="INR", pnl_class="REVENUE",
        debit_account="Customer / Receivable", credit_account="Sales Revenue",
        status="POSTED", idempotency_key=key)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_post_voucher_ignores_legacy_rows_with_no_voucher_group():
    """A NULL-group legacy row is never swept in by a *group* lookup: two of them
    cannot be mistaken for one two-leg voucher, and neither is adopted by a key
    it does not hold."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import post_voucher
    db, b = _db()
    legacy = [_legacy_row(db, b, f"TXN-{i:08d}", f"legacy-{i}") for i in (1, 2)]
    assert {r.voucher_group_id for r in db.query(FinancialTransaction).all()} == {None}

    rows = post_voucher(db, b.id, "COD_REMIT",
                        [{"debit": "Cash / Bank", "credit": "COD Receivable", "amount": "100.00"}],
                        voucher_key="K-LEGACY")
    db.commit()
    all_rows = db.query(FinancialTransaction).all()
    assert len(all_rows) == 3
    assert not ({r.id for r in rows} & {r.id for r in legacy})
    assert {r.voucher_group_id for r in rows} == {"K-LEGACY"}


def test_replaying_a_legacy_key_adopts_the_legacy_row():
    """A pre-0020 row holding the key IS that voucher: backfill re-runs and webhook
    redelivery both replay keys that pre-date 0020, and before post_voucher they got
    that row back. Adopting it keeps them idempotent instead of 409-ing on a
    unique-constraint conflict that can never resolve."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    legacy = _legacy_row(db, b, "TXN-00000001", "SALE:order-1")
    assert legacy.voucher_group_id is None

    got = ls.record_event(db, b.id, "SALE", "100.00", "0.00", idempotency_key="SALE:order-1")
    db.commit()
    assert got.id == legacy.id
    assert db.query(FinancialTransaction).count() == 1
    assert db.query(FinancialTransaction).one().voucher_group_id is None


def test_post_voucher_refuses_to_adopt_a_legacy_row_for_a_multi_leg_voucher():
    """A legacy row is one leg, so adopting it for an N-leg voucher would return a
    single row, write nothing, and raise nothing -- the caller would read a 200 and
    believe the whole voucher landed. Any pre-0020 order keyed SALE:{order.id} is one
    refactor away from that, so it must be loud instead of silent."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    legacy = _legacy_row(db, b, "TXN-00000001", "K-MULTI")

    try:
        ls.post_voucher(db, b.id, "COD_REMIT",
                        [{"debit": "COD Receivable", "amount": "1000.00"},
                         {"credit": "Cash / Bank", "amount": "1000.00"}],
                        voucher_key="K-MULTI")
        raise AssertionError("expected VoucherKeyConflict")
    except ls.VoucherKeyConflict as e:
        assert "K-MULTI" in str(e), str(e)
        assert "2" in str(e), str(e)
    rows = db.query(FinancialTransaction).all()
    assert [r.id for r in rows] == [legacy.id], "the failed call wrote nothing"


def test_post_voucher_names_the_group_that_owns_a_key_it_was_given():
    """The leg0 key of one voucher can be the whole key of another (the known
    group/leg namespace overlap). That is not a retryable race and must not reach
    the API as a null-orig IntegrityError ("Transaction conflict: None")."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    # Two-leg voucher keyed "K": its leg 1 holds idempotency_key "K:1".
    ls.post_voucher(db, b.id, "COD_REMIT",
                    [{"debit": "COD Receivable", "amount": "1000.00"},
                     {"credit": "Cash / Bank", "amount": "1000.00"}], voucher_key="K")
    db.commit()

    try:
        ls.post_voucher(db, b.id, "COD_REMIT",
                        [{"debit": "COD Receivable", "credit": "Cash / Bank",
                          "amount": "5.00"}], voucher_key="K:1")
        raise AssertionError("expected VoucherKeyConflict")
    except ls.VoucherKeyConflict as e:
        assert "K:1" in str(e) and "'K'" in str(e), str(e)
    # A ValueError, so the API answers 400 with this message instead of a 409.
    assert issubclass(ls.VoucherKeyConflict, ValueError)
    assert db.query(FinancialTransaction).count() == 2


def test_post_voucher_gives_each_leg_its_own_transaction_id_under_autoflush_off():
    """app.database.SessionLocal runs autoflush=False. _next_txn_id counts committed
    rows, so a multi-leg voucher must flush as it goes or every leg is handed the
    same transaction_id and the unique constraint rejects the whole voucher."""
    from sqlalchemy.orm import sessionmaker
    from app.models.business import Business
    from app.services.ledger_service import post_voucher
    db = sessionmaker(bind=_engine(), autoflush=False)()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    rows = post_voucher(db, b.id, "COD_REMIT",
                        [{"debit": "COD Receivable", "amount": "1000.00"},
                         {"credit": "Cash / Bank", "amount": "900.00"},
                         {"credit": "Carrier Freight / Fees", "amount": "100.00"}],
                        voucher_key="K-AF")
    db.commit()
    assert len({r.transaction_id for r in rows}) == 3
    assert [r.leg_index for r in rows] == [0, 1, 2]


def test_post_voucher_writes_distinct_leg_keys_for_an_over_long_key():
    """idempotency_key is String(128); the auto-generated key can exceed that once
    order/payment/refund ids and an ISO timestamp are in it. Truncating each leg key
    would make every leg of the voucher share one key and blow the unique constraint."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.ledger_service import post_voucher
    db, b = _db()
    long_key = ("PAYMENT:" + "a" * 36 + ":" + "b" * 36 + ":" + "c" * 36 +
                ":1180.00:0.00:2026-09-10T10:00:00+00:00")
    assert len(long_key) > 128
    rows = post_voucher(db, b.id, "COD_REMIT",
                        [{"debit": "Cash / Bank", "credit": "COD Receivable", "amount": "900.00"},
                         {"debit": "Carrier Freight / Fees", "credit": "COD Receivable", "amount": "100.00"}],
                        voucher_key=long_key)
    db.commit()
    assert db.query(FinancialTransaction).count() == 2
    assert len({r.idempotency_key for r in rows}) == 2
    assert all(len(r.idempotency_key) <= 128 and len(r.voucher_group_id) <= 128 for r in rows)


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


def test_record_event_defaults_pnl_class_from_transaction_type():
    """No explicit class -> DEFAULT_PNL_CLASS for the type (here a COGS leg)."""
    from app.services import ledger_service as ls
    db, b = _db()
    t = ls.record_event(db, b.id, "COGS", "500.00", "0", idempotency_key="K5")
    db.commit()
    assert t.pnl_class == "COGS"


def test_record_event_honours_explicit_pnl_class():
    from app.services import ledger_service as ls
    db, b = _db()
    t = ls.record_event(db, b.id, "ADJUSTMENT", "-100.00", "0",
                        idempotency_key="K6", pnl_class="reversal")
    db.commit()
    assert t.pnl_class == "REVERSAL"


def test_reverse_event_inherits_the_class_it_reverses():
    """A reversal is never the generic ADJUSTMENT default (EXPENSE): reversing a
    SALE is REVERSAL, reversing a pure balance-sheet movement stays NONE."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    sale = ls.record_event(db, b.id, "SALE", "1180.00", "180.00",
                           debit_account="Customer / Receivable", credit_account="Sales Revenue",
                           idempotency_key="K7")
    payment = ls.record_event(db, b.id, "PAYMENT", "1180.00", "0",
                              debit_account="Cash / Bank", credit_account="Customer / Receivable",
                              idempotency_key="K8")
    db.commit()

    rev = ls.reverse_event(db, b.id, sale.transaction_id, reason="wrong amount")
    rev_pay = ls.reverse_event(db, b.id, payment.transaction_id, reason="wrong amount")
    db.commit()
    stored = {r.id: r for r in db.query(FinancialTransaction).all()}
    assert stored[rev.id].pnl_class == "REVERSAL", stored[rev.id].pnl_class
    assert str(stored[rev.id].amount) == "-1180.00"
    assert stored[rev_pay.id].pnl_class == "NONE"
    # the original is untouched: reversal is append-only
    assert stored[sale.id].pnl_class == "REVENUE"


# --- Task 6: readers classify P&L per leg ---

def test_pnl_class_of_falls_back_to_transaction_type():
    from app.services.ledger_service import pnl_class_of
    assert pnl_class_of({"transaction_type": "SALE"}) == "REVENUE"
    assert pnl_class_of({"transaction_type": "PAYMENT"}) == "NONE"
    assert pnl_class_of({"transaction_type": "COD_REMIT", "pnl_class": "EXPENSE"}) == "EXPENSE"
    assert pnl_class_of({"transaction_type": "NOPE"}) == "NONE"


def test_pnl_class_of_reads_a_stored_none_on_a_revenue_type_as_unclassified():
    """The column defaults to "NONE", so a row written before the class existed
    carries "NONE" on a SALE. Taking that at face value reports the sale's revenue as
    zero, so a stored NONE on a type that implies P&L means "never classified" and
    the type default stands in."""
    from app.models.financial_transaction import DEFAULT_PNL_CLASS
    from app.services.ledger_service import pnl_class_of
    for typ in ("SALE", "REFUND", "COGS", "SHIPPING_EXPENSE", "PAYMENT_GATEWAY_FEE"):
        assert pnl_class_of({"transaction_type": typ, "pnl_class": "NONE"}) == \
            DEFAULT_PNL_CLASS[typ], typ
    # and a stored class that does contradict the type still wins
    assert pnl_class_of({"transaction_type": "OTHER_EXPENSE", "pnl_class": "REVENUE"}) == "REVENUE"
    assert pnl_class_of({"transaction_type": "SALE", "pnl_class": "EXPENSE"}) == "EXPENSE"


def test_pnl_class_of_keeps_none_for_types_that_never_touch_pnl():
    """The fallback must not invent P&L for a balance-sheet movement: these types
    default to NONE, so their stored NONE is the real answer, not a missing one."""
    from app.services.ledger_service import pnl_class_of
    for typ in ("PAYMENT", "REFUND_PAYOUT", "COD_COLLECTION", "CANCELLATION", "COD_REMIT"):
        assert pnl_class_of({"transaction_type": typ, "pnl_class": "NONE"}) == "NONE", typ


def test_revenue_summary_ignores_cancellation_amounts():
    from app.services.ledger_service import revenue_summary
    r = revenue_summary([
        {"transaction_type": "SALE", "amount": "1180.00", "tax_amount": "180.00"},
        {"transaction_type": "CANCELLATION", "amount": "1180.00", "tax_amount": "180.00"},
    ])
    assert r["gross_inclusive"] == "1180.00"
    assert r["net_inclusive"] == "1180.00"
    assert r["cancellations_inclusive"] == "0.00"


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
    # the class decides, not the type: an expense row typed OTHER_EXPENSE but classed
    # REVENUE is revenue, and a SALE classed EXPENSE is not.
    r = revenue_summary([
        {"transaction_type": "OTHER_EXPENSE", "amount": "50.00", "tax_amount": "0.00",
         "pnl_class": "REVENUE"},
        {"transaction_type": "SALE", "amount": "100.00", "tax_amount": "0.00",
         "pnl_class": "EXPENSE"},
    ])
    assert r["gross_inclusive"] == "50.00"


def test_revenue_summary_counts_a_sale_whose_stored_class_is_none():
    """The regression the "NONE is unclassified" rule exists for: a legacy sale row
    whose pnl_class is the column default must still be revenue, not zero."""
    from app.services.ledger_service import revenue_summary
    r = revenue_summary([{"transaction_type": "SALE", "amount": "1180.00",
                          "tax_amount": "180.00", "pnl_class": "NONE"}])
    assert r["gross_inclusive"] == "1180.00"
    assert r["gst"] == "180.00"
    assert r["net_exclusive"] == "1000.00"


def test_period_summary_splits_carrier_fees_from_bank_leg():
    from datetime import datetime, timezone
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ls.record_event(db, b.id, "SALE", "1000.00", "0.00", transaction_date=dt, idempotency_key="S1")
    ls.post_voucher(db, b.id, "COD_REMIT", [
        {"debit": "Cash / Bank", "credit": "", "amount": "900.00", "pnl_class": "NONE"},
        {"debit": ls.ACC_CARRIER_FEE, "credit": "", "amount": "100.00",
         "pnl_class": "EXPENSE"},
        {"debit": "", "credit": "COD Receivable", "amount": "1000.00", "pnl_class": "NONE"},
    ], transaction_date=dt, voucher_key="CR1")
    db.commit()
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["profit"]["carrier_fees"] == "100.00"
    assert out["profit"]["operating_profit"] == "900.00"
    assert out["revenue"]["net_exclusive"] == "1000.00"
    # The fee is separated BY ACCOUNT, not by type: it must not also land in `other`.
    assert out["profit"]["other"] == "0.00"
    assert out["profit"]["cogs"] == "0.00"


def test_period_summary_reports_cod_deductions_separately():
    from datetime import datetime, timezone
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ls.record_event(db, b.id, "SALE", "1000.00", "0.00", transaction_date=dt, idempotency_key="S1")
    ls.post_voucher(db, b.id, "COD_REMIT", [
        {"debit": "Cash / Bank", "credit": "", "amount": "900.00", "pnl_class": "NONE"},
        {"debit": ls.ACC_CARRIER_FEE, "credit": "", "amount": "60.00",
         "pnl_class": "EXPENSE"},
        {"debit": ls.ACC_COD_DEDUCTION, "credit": "", "amount": "40.00",
         "pnl_class": "EXPENSE"},
        {"debit": "", "credit": "COD Receivable", "amount": "1000.00", "pnl_class": "NONE"},
    ], transaction_date=dt, voucher_key="CR2")
    db.commit()
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["profit"]["carrier_fees"] == "60.00"
    assert out["profit"]["cod_deductions"] == "40.00"
    assert out["profit"]["other"] == "0.00"
    assert out["profit"]["operating_profit"] == "900.00"


def test_period_summary_direct_costs_follow_the_class_not_the_type():
    """A SALE stored as EXPENSE is a cost, and it must leave the revenue side. A
    type-keyed reader would report it as revenue and never charge it."""
    from datetime import datetime, timezone
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ls.record_event(db, b.id, "SALE", "1180.00", "180.00", transaction_date=dt, idempotency_key="S1")
    ls.record_event(db, b.id, "SALE", "100.00", "0.00", transaction_date=dt,
                    idempotency_key="S2", pnl_class="EXPENSE")
    ls.record_event(db, b.id, "COGS", "500.00", "0.00", transaction_date=dt, idempotency_key="S3")
    ls.record_event(db, b.id, "SHIPPING_EXPENSE", "70.00", "0.00", transaction_date=dt,
                    idempotency_key="S4")
    db.commit()
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["revenue"]["gross_inclusive"] == "1180.00"
    assert out["revenue"]["net_exclusive"] == "1000.00"
    assert out["profit"]["cogs"] == "500.00"
    assert out["profit"]["shipping"] == "70.00"
    assert out["profit"]["other"] == "100.00"
    assert out["profit"]["gross_profit"] == "500.00"
    assert out["profit"]["operating_profit"] == "330.00"


def test_period_summary_does_not_charge_gst_twice():
    """DEFAULT_PNL_CLASS calls TAX an EXPENSE, but the SALE voucher's GST legs already
    carry the tax in tax_amount, which revenue_summary nets out of net sales. A
    standalone TAX event is the payment against that liability: charging it as a cost
    as well would take the same rupee out of profit twice."""
    from datetime import datetime, timezone
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ls.record_event(db, b.id, "SALE", "1180.00", "180.00", transaction_date=dt, idempotency_key="S1")
    ls.record_event(db, b.id, "TAX", "180.00", "0.00", transaction_date=dt, idempotency_key="T1")
    db.commit()
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["revenue"]["gst"] == "180.00"
    assert out["revenue"]["net_exclusive"] == "1000.00"
    assert out["profit"]["other"] == "0.00"
    assert out["profit"]["operating_profit"] == "1000.00"


def test_period_summary_counts_every_legacy_null_group_row_separately():
    """voucher_group_id is NULL on every pre-0020 row, so any grouping or counting by
    group id has to filter IS NOT NULL: two unrelated legacy rows of one business
    would otherwise collapse into one fake multi-leg voucher, and one of them would
    vanish from revenue. Their pnl_class is the column default, so this also pins
    that a stored NONE on a SALE is read as unclassified, not as "no P&L"."""
    from datetime import datetime, timezone
    from decimal import Decimal
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    db, b = _db()
    dt = datetime(2026, 9, 1, tzinfo=timezone.utc)
    for i, amt in enumerate(("100.00", "300.00"), start=1):
        db.add(FinancialTransaction(
            business_id=b.id, transaction_id=f"LEG-{i}", transaction_type="SALE",
            transaction_date=dt, amount=Decimal(amt), tax_amount=Decimal("0.00"),
            net_amount=Decimal(amt), currency="INR", debit_account=ls.ACC_RECEIVABLE,
            credit_account=ls.ACC_SALES, status="POSTED", pnl_class="NONE",
            idempotency_key=f"legacy-sale-{i}"))
    db.commit()
    assert {r.voucher_group_id for r in db.query(FinancialTransaction).all()} == {None}
    out = ls.period_summary(db, b.id, dt, dt.replace(month=10))
    assert out["revenue"]["gross_inclusive"] == "400.00"
    assert out["transaction_count"] == 2


def test_profit_summary_counts_carrier_fees_and_cod_deductions():
    from app.services.ledger_service import profit_summary
    # every pre-existing positional/keyword caller keeps working
    p = profit_summary("1000.00", "500.00", "70.00", "15.00", "20.00", "5.00", True, 0)
    assert p["operating_profit"] == "390.00"
    assert p["carrier_fees"] == "0.00" and p["cod_deductions"] == "0.00"

    p = profit_summary(net_sales_exclusive="1000.00", cogs="500.00", carrier_fees="60.00",
                       cod_deductions="40.00")
    assert p["carrier_fees"] == "60.00"
    assert p["cod_deductions"] == "40.00"
    assert p["operating_profit"] == "400.00"


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
