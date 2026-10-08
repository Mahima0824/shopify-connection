"""Task 7: hooks raise, the webhook records a durable failure, close is blocked."""
from datetime import datetime, timezone
from decimal import InvalidOperation

import pytest

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
    bid = b.id  # read before the row goes dirty: a later commit() expires it, and
    # re-reading it inside the hook would autoflush the bad value instead
    bad = Order(business_id=b.id, internal_order_number="ORD-BAD", shopify_order_id="gbad",
                shopify_order_name="#BAD", total_amount=None, tax_amount=None,
                order_date=DT)
    db.add(bad); db.commit(); db.refresh(bad)
    bad.total_amount = "not-a-number"
    # pytest.raises, not `try: ... except Exception: pass`: that shape also catches
    # the AssertionError a bare "raise if nothing happened" throws, so the test
    # passed while the hook was still swallowing.
    with pytest.raises(InvalidOperation):
        ls.record_sale_from_order(db, bid, bad)


def test_record_payment_hook_raises_instead_of_returning_none():
    """The payment hook was the other swallowing writer: a ClosedPeriodError or an
    integrity error came back as None and the caller read that as "nothing to do"."""
    from app.services import ledger_service as ls
    from app.models.payment import Payment
    db, b, o = _db()
    bid = b.id  # see above: keep the dirty payment row out of an autoflush
    p = Payment(business_id=b.id, order_id=o.id, amount=0, payment_status="PAID")
    db.add(p); db.commit(); db.refresh(p)
    p.amount = "not-a-number"
    with pytest.raises(InvalidOperation):
        ls.record_payment_from_payment(db, bid, p)


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


# --- uq_lpf_biz_source_event: a recurring failure is the SAME failure, so it must
# upsert. A plain insert raises IntegrityError inside the error handler, and the
# original failure -- the whole point of the table -- is lost with it.

def test_recurring_failure_upserts_instead_of_piling_up_rows():
    from app.services import ledger_service as ls
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b, o = _db()
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        raise ValueError("first")
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        raise ValueError("second")
    rows = db.query(LedgerPostingFailure).all()
    assert len(rows) == 1
    assert rows[0].attempts == 2
    assert "second" in rows[0].reason


def test_a_failure_that_recurs_reopens_a_resolved_row():
    """Resolved means "somebody fixed it and checked the box". If it breaks again it
    is unresolved again, and the month must close-block again."""
    from app.models.ledger_posting_failure import LedgerPostingFailure
    from app.services import ledger_service as ls
    db, b, o = _db()
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        raise ValueError("first")
    db.commit()
    db.query(LedgerPostingFailure).one().resolved_at = datetime.now(timezone.utc)
    db.commit()
    with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        raise ValueError("again")
    rows = db.query(LedgerPostingFailure).all()
    assert len(rows) == 1
    assert rows[0].resolved_at is None
    assert rows[0].attempts == 2


def test_a_distinct_source_event_is_its_own_failure_row():
    """Same business, same event type, different source: not a duplicate."""
    from app.services import ledger_service as ls
    from app.models.ledger_posting_failure import LedgerPostingFailure
    db, b, o = _db()
    for sid in ("g1", "g2"):
        with ls.safe_post(db, b.id, "SHOPIFY_WEBHOOK", sid, "SALE"):
            raise ValueError("nope")
    assert db.query(LedgerPostingFailure).count() == 2


def test_safe_post_rolls_the_session_back_before_recording_the_failure():
    """The failure row is the only thing this context commits: work already flushed
    into the doomed transaction must not ride along with it.

    Scoped to pending session work, not a finished voucher. post_voucher's savepoint
    issues a REAL commit when it is not nested inside an outer transaction, so a
    voucher that completed is already durable and cannot be rolled back here; a
    posting that failed leaves that savepoint uncommitted and is discarded.
    """
    from app.models.payment import Payment
    from app.models.ledger_posting_failure import LedgerPostingFailure
    from app.services import ledger_service as ls
    db, b, o = _db()
    bid = b.id
    with ls.safe_post(db, bid, "SHOPIFY_WEBHOOK", "g1", "SALE"):
        db.add(Payment(business_id=bid, order_id=o.id, amount=5, payment_status="PAID"))
        db.flush()  # on disk, but inside the transaction the failure will discard
        raise ValueError("closed period")
    db.rollback()  # so both counts are read off disk, not the identity map
    assert db.query(Payment).count() == 0
    assert db.query(LedgerPostingFailure).count() == 1