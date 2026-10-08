"""Task 5: period cost postings, ensure_period_postings idempotency, kill switches."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

START = datetime(2026, 9, 1, tzinfo=timezone.utc)
END = datetime(2026, 10, 1, tzinfo=timezone.utc)
COGS_AMOUNT = "200.00"  # the COGS_DEFAULT CostRule the fixture installs


def _db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return eng, sessionmaker(bind=eng)


def _order(db, b, c, *, name, qty=2, cod=False, date=None):
    from app.models.order import Order, OrderItem
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    dt = date or datetime(2026, 9, 10, tzinfo=timezone.utc)
    o = Order(business_id=b.id, internal_order_number=f"ORD-{name}", shopify_order_id=f"g{name}",
              shopify_order_name=f"#{name}", customer_id=c.id, currency="INR",
              subtotal_amount=1000.0, discount_amount=0, shipping_amount=0, tax_amount=180.0,
              total_amount=1180.0, payment_status="PENDING" if cod else "PAID",
              financial_status="PAID", cod_mode="COD" if cod else "PREPAID",
              cod_value=1180.0 if cod else None, fulfillment_status="SHIPPED",
              operational_status="DELIVERED" if cod else "SHIPPED", order_date=dt)
    db.add(o); db.commit(); db.refresh(o)
    db.add(OrderItem(business_id=b.id, order_id=o.id, title="P", sku=f"S-{name}", quantity=qty,
                     price="500.00"))
    db.add(Parcel(business_id=b.id, order_id=o.id, parcel_code=f"PC-{name}",
                  barcode_value=f"BC-{name}"))
    db.commit()
    return o


def _ship(db, b, o, *, status="DELIVERED", awb=None):
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    p = db.query(Parcel).filter_by(order_id=o.id).first()
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=awb or f"AWB-{o.internal_order_number}", tracking_status=status,
                 delivered_at=datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
                 if status == "DELIVERED" else None)
    db.add(s); db.commit(); db.refresh(s)
    return s


def _biz(db):
    from app.models.business import Business
    from app.models.customer import Customer
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    c = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(c); db.commit(); db.refresh(c)
    return b, c


def _cost_rules(db, b, shipping="70.00", packaging="15.00", gateway="20.00", cogs=COGS_AMOUNT):
    from app.models.cost import CostRule
    for key, amt in (("COGS_DEFAULT", cogs), ("SHIPPING", shipping),
                     ("PACKAGING", packaging), ("GATEWAY_FEE", gateway)):
        db.add(CostRule(business_id=b.id, key=key, amount=float(amt), source="MANUAL",
                        effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc)))
    db.commit()


def _env(shipping="70.00", packaging="15.00", gateway="20.00", cogs=COGS_AMOUNT,
         two_orders=False):
    """One prepaid order (two unless `two_orders`), one shipment, four cost rules."""
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    names = ["A", "B"] if two_orders else ["A"]
    for i, name in enumerate(names):
        o = _order(db, b, c, name=name, qty=2)
        _ship(db, b, o, status="IN_TRANSIT", awb=f"AWB-{name}")
    _cost_rules(db, b, shipping, packaging, gateway, cogs)
    return db, b


def _sf(db, b, s, **kw):
    from app.models.sla import ShipmentFinancial
    vals = dict(business_id=b.id, shipment_id=s.id, order_id=s.order_id,
                expected_cod_amount=1180.0, collected_amount=1180.0,
                settled_amount=1180.0, fee_amount=40.0, other_deduction=10.0,
                net_settlement=1130.0, settlement_reference="ST1",
                settlement_date=datetime(2026, 9, 25, tzinfo=timezone.utc), status="SETTLED")
    vals.update(kw)
    f = ShipmentFinancial(**vals)
    db.add(f); db.commit(); db.refresh(f)
    return f


def _rows(db, **kw):
    from app.models.financial_transaction import FinancialTransaction
    q = db.query(FinancialTransaction).filter_by(**kw)
    return {r.transaction_type: str(r.amount) for r in q}


# --- Step 1: the brief's seven tests ------------------------------------------

def _cod_collected(db, business_id):
    """What the ledger raised to COD Receivable, and what it credited: two queries.

    Totalled rather than read off the two voucher amounts: two equal amounts is
    the same assertion as "the account is zero", except that a collection which
    raised nothing would net to zero against an equal remit of nothing.
    """
    from app.models.financial_transaction import FinancialTransaction
    def total(**kw):
        return sum((r.amount for r in db.query(FinancialTransaction).filter_by(
            business_id=business_id, **kw)), Decimal("0"))
    on_account = total(debit_account="COD Receivable")
    to_account = total(credit_account="COD Receivable")
    return on_account, to_account


def test_period_costs_post_four_expense_types():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    post_period_costs(db, b.id, START, END)
    db.commit()
    got = _rows(db)
    assert got["COGS"] == "400.00"          # 2 units x 200.00
    assert got["SHIPPING_EXPENSE"] == "70.00"
    assert got["PACKAGING_EXPENSE"] == "15.00"
    assert got["PAYMENT_GATEWAY_FEE"] == "20.00"
    assert len(got) == 4, got
    assert all(r.pnl_class in ("EXPENSE", "COGS")
               for r in db.query(FinancialTransaction).all())


def test_cogs_figure_comes_from_the_cost_rule_default_not_from_a_silent_zero():
    """The `400.00` assertion above is only worth anything if get_cost really returns
    200.00 here. This item carries no product_id, so the figure comes from the
    COGS_DEFAULT CostRule effective 2026-01-01, NOT from ProductCostHistory -- and a
    naive datetime that matched nothing would yield 0.0 and make every COGS
    assertion below vacuously pass."""
    from app.models.order import OrderItem
    from app.services.cost_service import get_cost
    db, b = _env()
    item = db.query(OrderItem).one()
    assert item.product_id is None
    at = END - timedelta(microseconds=1)
    amount, source = get_cost(db, b.id, "COGS_DEFAULT", at, product_id=item.product_id)
    assert amount == 200.0, amount
    assert source == "MANUAL", source


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


def test_a_repeat_run_reports_the_cost_rows_as_skipped_not_as_posted():
    """post_voucher already refuses to append a second voucher under a spent key, so
    the row count cannot prove the guard works: it is the REPORT that has to stop
    claiming a second run posted something."""
    from app.services.finance_posting import _FLAT_COSTS, ensure_period_postings
    keys = ["cogs", *[e[0] for e in _FLAT_COSTS]]
    db, b = _env()
    first = ensure_period_postings(db, b.id, START, END)
    db.commit()
    assert all(first["costs"][k]["posted"] == 1 for k in keys), first
    second = ensure_period_postings(db, b.id, START, END)
    db.commit()
    assert all(second["costs"][k]["posted"] == 0 for k in keys), second
    assert all(second["costs"][k]["skipped"] == 1 for k in keys), second
    assert {r["outcome"] for r in second["costs"]["records"]} == {"already_posted"}


def test_dry_run_writes_nothing_but_reports_what_it_would_post():
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import _FLAT_COSTS, post_period_costs
    db, b = _env()
    out = post_period_costs(db, b.id, START, END, dry_run=True)
    assert db.query(FinancialTransaction).count() == 0
    assert out["cogs"]["would_post"] == 1
    assert out["shipping"]["would_post"] == 1
    assert out["packaging"]["would_post"] == 1
    assert out["gateway_fee"]["would_post"] == 1
    keys = ["cogs", *[e[0] for e in _FLAT_COSTS]]
    assert all(out[k]["posted"] == 0 for k in keys), out
    assert all(out[k]["skipped"] == 0 for k in keys), out
    assert {r["outcome"] for r in out["records"]} == {"would_post"}


def test_kill_switch_off_writes_nothing_but_still_reports():
    from app.config import settings
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import ensure_period_postings
    db, b = _env()
    original = settings.ledger_auto_post_costs
    settings.ledger_auto_post_costs = False
    try:
        out = ensure_period_postings(db, b.id, START, END)
        assert out["auto_posted"] is False
        assert out["costs"]["cogs"]["would_post"] == 1
        assert out["costs"]["gateway_fee"]["would_post"] == 1
        assert out["costs"]["shipping"]["would_post"] == 1
        # Nothing written, checked while the switch is still off.
        assert db.query(FinancialTransaction).count() == 0
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
    from app.database import get_db
    from app.main import app
    from app.models.business import Business
    from app.models.user import User
    from app.services import ledger_service as ls
    from app.services.auth_service import hash_password
    eng, mk = _db()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in",
             password_hash=hash_password("x"), role="ACCOUNTANT")
    db.add(u); db.commit()
    app.dependency_overrides[get_db] = lambda: mk()
    try:
        c = TestClient(app)
        tok = c.post("/api/v1/auth/login",
                     json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = c.post("/api/v1/ledger", headers=h, json={
            "transaction_type": "CARRIER_CLAIM", "amount": "450.00", "tax_amount": "0.00",
            "transaction_date": "2026-09-20T00:00:00+00:00",
            "debit_account": ls.ACC_CARRIER_CLAIM, "credit_account": ls.ACC_SALES_RETURNS,
            "idempotency_key": "CARRIER_CLAIM:sh-1"})
        assert r.status_code == 200, r.text
        row = r.json()["data"]
        assert row["transaction_type"] == "CARRIER_CLAIM"
        assert row["amount"] == "450.00"
        assert row["status"] == "POSTED"
    finally:
        app.dependency_overrides.clear()


# --- Step 6: close_checks stays a pure read -----------------------------------

def test_close_checks_is_read_only_by_default():
    """Row count, not just a return value: this is the call the
    GET /accounting/periods/{year}/{month} handler makes."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import accounting_service as acct
    db, b = _env()
    out = acct.close_checks(db, b.id, 2026, 9)
    db.commit()
    assert db.query(FinancialTransaction).count() == 0
    assert isinstance(out["total"], int)


def test_close_checks_posts_the_period_only_when_asked():
    """The flag exists so the write happens on close_month's POST, not on the GET."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import accounting_service as acct
    db, b = _env()
    acct.close_checks(db, b.id, 2026, 9, post_costs=True)
    db.commit()
    assert sorted(_rows(db)) == ["COGS", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
                                 "SHIPPING_EXPENSE"]
    # Idempotent: close_month may be retried, and so may the check itself.
    acct.close_checks(db, b.id, 2026, 9, post_costs=True)
    db.commit()
    assert db.query(FinancialTransaction).count() == 4, _rows(db)


# --- Obligation 1: per-settlement isolation, backfill, reporting --------------

def _cod_env(*, delivered=True, rules=True, n=1):
    """`n` delivered COD shipments, no collection ever posted."""
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    ships = []
    for i in range(n):
        o = _order(db, b, c, name=f"COD{i}", cod=True)
        ships.append(_ship(db, b, o, status="DELIVERED" if delivered else "IN_TRANSIT"))
    if rules:
        _cost_rules(db, b)
    return db, b, ships


def _ensure(db, b, **kw):
    from app.services.finance_posting import ensure_period_postings
    out = ensure_period_postings(db, b.id, START, END, **kw)
    db.commit()
    return out


def test_missing_cod_collection_is_backfilled_then_the_remit_posts():
    """Every COD shipment delivered before Task 4 shipped has no collection voucher,
    so the first period this runs WILL hit CodCollectionMissing. It must be
    recoverable, not merely skipped -- and it must actually close the loop."""
    db, b, ships = _cod_env()
    _sf(db, b, ships[0])
    out = _ensure(db, b)
    rows = _rows(db)
    assert rows.get("COD_COLLECTION") == "1180.00", rows
    assert rows.get("COD_REMIT") is not None, rows
    settled = [s for s in out["cod"]["settlements"]
               if s["outcome"] == "posted_with_backfill"]
    assert len(settled) == 1, out["cod"]["settlements"]
    assert out["cod"]["posted"] == 1, out["cod"]
    # The two row amounts matching is not the claim under test: COD RECEIVABLE
    # NETTING TO ZERO is. A backfill that raised nothing would net to zero against
    # an equal remit of nothing, so both sides are asserted by figure.
    raised, cleared = _cod_collected(db, b.id)
    assert str(raised) == "1180.00", rows
    assert str(cleared) == "1180.00", rows
    assert raised == cleared
    assert not out["cod"]["shortfalls"], out["cod"]


def test_a_backfill_shortfall_is_reported_not_folded_into_success():
    """A short or partial collection is the common case, and it leaves COD Receivable
    non-zero. The remit only checks that a collection EXISTS, so without an explicit
    reconciliation the payload would claim a clean post while the account still
    carries the shortfall."""
    db, b, ships = _cod_env()
    # Collected 1180.00 at the door, but the carrier only settled 900.00
    # (850 net + 30 fee + 20 deduction). The receivable keeps a 280.00 residual.
    _sf(db, b, ships[0], net_settlement=850.0, fee_amount=30.0, other_deduction=20.0,
        settled_amount=900.0, collected_amount=900.0, expected_cod_amount=1180.0)
    out = _ensure(db, b)
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "posted_with_shortfall", entry
    assert entry["collected_amount"] == "1180.00", entry
    assert entry["settled_amount"] == "900.00", entry
    assert entry["residual_amount"] == "280.00", entry
    assert "280.00" in entry["reason"], entry
    assert len(out["cod"]["shortfalls"]) == 1, out["cod"]
    # Both vouchers really posted, and nothing was quietly written off.
    assert _rows(db).get("COD_COLLECTION") == "1180.00", _rows(db)
    raised, cleared = _cod_collected(db, b.id)
    assert str(raised) == "1180.00" and str(cleared) == "900.00", (raised, cleared)
    assert raised - cleared == Decimal("280.00")


def test_a_shortfall_on_an_already_collected_shipment_is_also_reported():
    """The same residual, reached without a backfill: the collection was raised by the
    delivery flow and the carrier under-settled. Measured against the figure
    actually posted, not against what the order says today."""
    db, b, ships = _cod_env()
    from app.services.finance_posting import record_cod_collection_from_shipment
    record_cod_collection_from_shipment(db, b.id, ships[0])
    db.commit()
    _sf(db, b, ships[0], net_settlement=850.0, fee_amount=30.0, other_deduction=20.0,
        settled_amount=900.0)
    out = _ensure(db, b)
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "posted_with_shortfall", entry
    assert entry["residual_amount"] == "280.00", entry
    assert out["cod"]["shortfalls"] and out["cod"]["posted"] == 1, out["cod"]


def test_dry_run_reports_the_shortfall_it_would_leave():
    from app.models.financial_transaction import FinancialTransaction
    db, b, ships = _cod_env()
    _sf(db, b, ships[0], net_settlement=850.0, fee_amount=30.0, other_deduction=20.0,
        settled_amount=900.0)
    out = _ensure(db, b, dry_run=True)
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "would_post_with_shortfall", entry
    assert entry["residual_amount"] == "280.00", entry
    assert db.query(FinancialTransaction).count() == 0


# --- Important 1: no single record may abort the period ------------------------

def test_backfill_into_a_closed_month_does_not_abort_the_period():
    """The ordinary legacy case: a COD shipment delivered 2026-08-20 with August
    closed, settling 2026-09-05 with September open. The collection write is dated
    on delivered_at, so post_voucher's closed-period guard raises ClosedPeriodError
    from INSIDE the backfill handler. That must cost this one shipment its posting
    -- not every other settlement's, and not the period's cost rows."""
    from app.models.accounting_period import AccountingPeriod
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order
    db, b, ships = _cod_env(n=2)
    legacy_order = db.query(Order).filter_by(id=ships[0].order_id).one()
    legacy_order.order_date = datetime(2026, 8, 20, tzinfo=timezone.utc)
    ships[0].delivered_at = datetime(2026, 8, 20, tzinfo=timezone.utc)
    db.add(AccountingPeriod(business_id=b.id, year=2026, month=8, status="CLOSED"))
    db.commit()
    _sf(db, b, ships[0], settlement_reference="LEGACY",
        settlement_date=datetime(2026, 9, 5, tzinfo=timezone.utc))
    _sf(db, b, ships[1], settlement_reference="SEPT")

    out = _ensure(db, b)
    by_ref = {s["settlement_reference"]: s for s in out["cod"]["settlements"]}
    legacy = by_ref["LEGACY"]
    # The failure is named, and reported as the BACKFILL failing -- which is what
    # tells an operator to reopen August rather than to chase the carrier.
    assert "ClosedPeriodError" in legacy["reason"], legacy
    assert legacy["reason"].startswith("collection backfill failed:"), legacy
    assert legacy["outcome"] == "skipped", legacy
    assert by_ref["SEPT"]["outcome"] == "posted_with_backfill", by_ref["SEPT"]
    assert out["cod"]["posted"] == 1, out["cod"]
    assert out["cod"]["skipped"] == 1, out["cod"]
    # Only the September settlement posted, and its cost rows are on the ledger:
    # the endpoint's rollback never fired.
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COD_REMIT").count() == 4, _rows(db)
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COD_COLLECTION").count() == 1, _rows(db)
    assert sorted(_rows(db)) == ["COD_COLLECTION", "COD_REMIT", "COGS",
                                 "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
                                 "SHIPPING_EXPENSE"], _rows(db)


def test_a_settlement_refusal_still_does_not_abort_the_period_when_the_whole_session_fails(monkeypatch):
    """The second line of defence: even a failure nothing anticipated is contained,
    named, and costs only its own settlement."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import finance_posting as fp
    db, b, ships = _cod_env(n=2)
    _sf(db, b, ships[0], settlement_reference="FIRST")
    _sf(db, b, ships[1], settlement_reference="SECOND")
    real = fp.record_cod_remittance_from_shipment_financial
    seen = {"n": 0}

    def flaky(*a, **kw):
        if seen["n"] == 0:
            seen["n"] += 1
            raise ZeroDivisionError("simulated driver fault")
        seen["n"] += 1
        return real(*a, **kw)

    monkeypatch.setattr(fp, "record_cod_remittance_from_shipment_financial", flaky)
    out = _ensure(db, b)
    entries = out["cod"]["settlements"]
    assert entries[0]["outcome"] == "error", entries[0]
    assert "ZeroDivisionError" in entries[0]["reason"], entries[0]
    assert entries[1]["outcome"] == "posted_with_backfill", entries[1]
    assert out["cod"]["posted"] == 1 and out["cod"]["skipped"] == 1, out["cod"]
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COD_REMIT").count() == 4, _rows(db)


def test_one_cost_record_failure_does_not_abort_the_period(monkeypatch):
    """The cost loops used to have no per-record guard at all, so a get_cost or
    database error on one order took the whole period -- and the endpoint's
    rollback took the already-posted rows with it."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import ledger_service as ls
    from app.services.finance_posting import ensure_period_postings
    db, b = _env(two_orders=True)
    real = ls.post_voucher
    seen = {"n": 0}

    def flaky(*a, **kw):
        # Fail the SECOND order's COGS, so there is a sibling to lose if the
        # isolation is not there.
        if kw.get("voucher_key", "").startswith("COGS:") and seen["n"] == 1:
            seen["n"] += 1
            raise RuntimeError("simulated pricing failure")
        seen["n"] += 1
        return real(*a, **kw)

    monkeypatch.setattr(ls, "post_voucher", flaky)
    out = ensure_period_postings(db, b.id, START, END)
    db.commit()
    failed = [r for r in out["costs"]["records"] if r["outcome"] == "error"]
    assert len(failed) == 1, out["costs"]["records"]
    assert "RuntimeError" in failed[0]["reason"], failed
    assert "pricing failure" in failed[0]["reason"], failed
    # The other order's COGS and every flat-rate row still landed.
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COGS").count() == 1, _rows(db)
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="PAYMENT_GATEWAY_FEE").count() == 2, _rows(db)


def test_a_cost_rate_read_failure_is_reported_not_read_as_no_cost_data():
    """If the cost rows cannot be read, NO record can be priced. That is a failure,
    and it must be reported as one -- not as "no cost configured" for every order in
    the period, which is what month-close's missing_cogs check would read as."""
    from app.services import finance_posting as fp
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    original = fp._load_rate_book

    def boom(*a, **kw):
        raise RuntimeError("simulated rule read failure")

    fp._load_rate_book = boom
    try:
        out = post_period_costs(db, b.id, START, END)
    finally:
        fp._load_rate_book = original
    assert out["records_total"] == 4, out
    assert {r["outcome"] for r in out["records"]} == {"error"}, out["records"]
    assert all("rule read failure" in r["reason"] for r in out["records"]), out["records"]
    assert out["outcome_counts"] == {"error": 4}, out
    for cost_type in ("cogs", "shipping", "packaging", "gateway_fee"):
        assert out[cost_type]["posted"] == 0 and out[cost_type]["skipped"] == 1, out
    from app.models.financial_transaction import FinancialTransaction
    assert db.query(FinancialTransaction).count() == 0


def test_missing_collection_on_an_undelivered_shipment_is_nothing_due_not_an_error():
    """The courier collects from the customer at the door, so before delivery there
    is no receivable to raise -- a gap, not a failure."""
    from app.models.financial_transaction import FinancialTransaction
    db, b, ships = _cod_env(delivered=False)
    _sf(db, b, ships[0])
    out = _ensure(db, b)
    assert db.query(FinancialTransaction).filter(
        FinancialTransaction.transaction_type.in_(
            ("COD_COLLECTION", "COD_REMIT"))).count() == 0
    assert out["cod"]["posted"] == 0
    assert out["cod"]["skipped"] == 1, out["cod"]["settlements"]
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "nothing_due", entry
    assert "not delivered" in entry["reason"], entry


def test_one_refused_settlement_does_not_abort_the_others():
    """An uncaught raise in a period loop loses every other posting in that period."""
    from app.models.financial_transaction import FinancialTransaction
    db, b, ships = _cod_env(n=3)
    f_bad = _sf(db, b, ships[1], settlement_reference="BAD",
                settled_amount=999.0)  # 1130 + 40 + 10 = 1180 != 999
    _sf(db, b, ships[0], settlement_reference="OK1")
    _sf(db, b, ships[2], settlement_reference="OK2")
    out = _ensure(db, b)
    remits = db.query(FinancialTransaction).filter_by(transaction_type="COD_REMIT").all()
    # Four legs per remit (bank, fee, deduction, receivable) for the two that can
    # post; the refused one contributes nothing.
    assert len(remits) == 2 * 4, [r.reference_number for r in remits]
    assert sorted({r.reference_number for r in remits}) == ["OK1", "OK2"]
    assert out["cod"]["posted"] == 2, out["cod"]
    assert out["cod"]["skipped"] == 1, out["cod"]
    bad = [s for s in out["cod"]["settlements"] if s["settlement_reference"] == "BAD"]
    assert len(bad) == 1 and bad[0]["outcome"] == "skipped", out["cod"]["settlements"]
    # The three COD conditions must not be conflated, so a mismatch is reported under
    # its OWN handler's wording, not the catch-all one a bare ValueError would give.
    assert bad[0]["reason"].startswith("settlement does not reconcile:"), bad
    assert "999.00" in bad[0]["reason"], bad
    assert f_bad.id == bad[0]["shipment_financial_id"]


def test_cod_outcomes_are_reported_per_settlement_with_reasons():
    """An operator has to see what was posted, what was skipped, and why."""
    db, b, ships = _cod_env(n=2)
    _sf(db, b, ships[0], settlement_reference="OK", status="EXPECTED")  # nothing due
    _sf(db, b, ships[1], settlement_reference="MISMATCH", settled_amount=5.0)
    out = _ensure(db, b)
    by_ref = {s["settlement_reference"]: s for s in out["cod"]["settlements"]}
    assert set(by_ref) == {"OK", "MISMATCH"}, out["cod"]["settlements"]
    assert by_ref["OK"]["outcome"] == "nothing_due", by_ref["OK"]
    assert by_ref["MISMATCH"]["outcome"] == "skipped", by_ref["MISMATCH"]
    for entry in out["cod"]["settlements"]:
        assert {"shipment_financial_id", "shipment_id", "outcome", "reason"} <= set(entry), entry


def test_cod_counters_account_for_every_settlement_in_the_period():
    """posted + skipped + would_post must equal the settlement count, or the summary
    cannot be trusted: an outcome that moves no counter is an invisible one."""
    db, b, ships = _cod_env(n=3)
    for i, s in enumerate(ships):
        _sf(db, b, s, settlement_reference=f"R{i}",
            status="EXPECTED" if i == 0 else "SETTLED",
            **({"settled_amount": 5.0} if i == 2 else {}))
    out = _ensure(db, b)
    cod = out["cod"]
    assert cod["posted"] + cod["skipped"] + cod["would_post"] == len(cod["settlements"]) == 3, cod
    assert cod["posted"] == 1 and cod["skipped"] == 2, cod
    out2 = _ensure(db, b)
    assert (out2["cod"]["posted"] + out2["cod"]["skipped"] + out2["cod"]["would_post"]
            == 3), out2["cod"]


def test_cod_kill_switch_off_writes_nothing_but_still_reports():
    from app.config import settings
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import ensure_period_postings
    db, b, ships = _cod_env()
    _sf(db, b, ships[0])
    original = settings.ledger_auto_post_cod
    settings.ledger_auto_post_cod = False
    try:
        out = ensure_period_postings(db, b.id, START, END)
        assert out["auto_posted"] is False
        assert out["cod"]["would_post"] == 1, out["cod"]
        assert out["cod"]["settlements"][0]["outcome"] == "would_post_with_backfill", out["cod"]
        # Nothing COD on the ledger; the cost switch is still on, so the period's
        # four cost rows are written -- the kill switch is scoped, not global.
        assert db.query(FinancialTransaction).filter(
            FinancialTransaction.transaction_type.in_(
                ("COD_COLLECTION", "COD_REMIT"))).count() == 0
        assert sorted(_rows(db)) == ["COGS", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
                                     "SHIPPING_EXPENSE"]
    finally:
        settings.ledger_auto_post_cod = original
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="COD_COLLECTION").count() == 0


def test_cod_dry_run_reports_the_collection_it_would_backfill():
    from app.models.financial_transaction import FinancialTransaction
    db, b, ships = _cod_env()
    _sf(db, b, ships[0])
    out = _ensure(db, b, dry_run=True)
    assert db.query(FinancialTransaction).count() == 0
    assert out["cod"]["would_post"] == 1, out["cod"]
    assert out["cod"]["settlements"][0]["outcome"] == "would_post_with_backfill", out["cod"]


# --- Obligation 2: a corrected settlement is surfaced, not swallowed ----------

def test_corrected_settlement_is_reported_as_pending_correction_not_as_success():
    """ShipmentFinancial is UNIQUE per shipment and COD_REMIT is keyed by its id, so
    re-posting a corrected settlement is swallowed as an idempotent replay and COD
    Receivable keeps the first, superseded figure. The payload has to say so."""
    db, b, ships = _cod_env()
    f = _sf(db, b, ships[0], net_settlement=1100.0, fee_amount=60.0, other_deduction=20.0)
    _ensure(db, b)
    assert _rows(db).get("COD_REMIT") == "1180.00", _rows(db)
    # The carrier issues a supplementary settlement: same row, new figures
    # (1000 + 60 + 20 = 1080, still reconciling against settled_amount).
    f.net_settlement = 1000.0
    f.settled_amount = 1080.0
    db.commit()
    out = _ensure(db, b)
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "correction_pending", entry
    assert entry["posted_amount"] == "1180.00", entry
    assert entry["current_amount"] == "1080.00", entry
    assert out["cod"]["corrections_pending"], out["cod"]
    # The ledger is unchanged, and the report does not claim the correction landed.
    assert _rows(db).get("COD_REMIT") == "1180.00"


def test_an_unchanged_replay_is_reported_as_already_posted():
    db, b, ships = _cod_env()
    _sf(db, b, ships[0])
    _ensure(db, b)
    out = _ensure(db, b)
    entry = out["cod"]["settlements"][0]
    assert entry["outcome"] == "already_posted", entry
    assert out["cod"]["posted"] == 0 and out["cod"]["skipped"] == 1, out["cod"]
    assert not out["cod"]["corrections_pending"]


# --- Obligation 3: no query per settlement ------------------------------------

def _count_order_queries(eng, fn):
    from sqlalchemy import event
    seen = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        if "FROM orders" in statement:
            seen.append(statement)
    event.listen(eng, "before_cursor_execute", _before)
    try:
        fn()
    finally:
        event.remove(eng, "before_cursor_execute", _before)
    return len(seen)


def test_cod_loop_does_not_query_orders_once_per_settlement():
    """The COD writer looks its order up per settlement. In a period loop that is one
    query per shipment; the count must not grow with the number of settlements."""
    def run(n):
        db, b, ships = _cod_env(n=n, rules=False)
        for s in ships:
            _sf(db, b, s)
        db.commit()
        eng = db.get_bind()
        return _count_order_queries(eng, lambda: _ensure(db, b))

    one = run(1)
    four = run(4)
    assert four == one, f"orders queries grew with settlement count: 1 -> {one}, 4 -> {four}"


# --- Important 4: the cost side carries per-record detail ---------------------

def test_cost_records_separate_the_three_skip_reasons():
    """`skipped: 4` cannot distinguish "the period is fully posted" from "four
    records have no cost data" -- and the second is the condition month-close's
    missing_cogs check exists to catch."""
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    first = post_period_costs(db, b.id, START, END)
    db.commit()
    # A second run: every record is already on file.
    second = post_period_costs(db, b.id, START, END)
    db.commit()
    assert {r["outcome"] for r in second["records"]} == {"already_posted"}
    # A fresh business with no cost rules at all: nothing is due, per record.
    db2, b2 = _db_env_no_rules()
    third = post_period_costs(db2, b2.id, START, END)
    assert third["cogs"]["skipped"] == 1 and third["shipping"]["skipped"] == 1, third
    assert third["packaging"]["skipped"] == 1 and third["gateway_fee"]["skipped"] == 1
    assert {r["outcome"] for r in third["records"]} == {"no_rate_in_force",
                                                        "no_costed_line"}, third["records"]
    assert first["cogs"]["posted"] == 1


def _db_env_no_rules():
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    o = _order(db, b, c, name="A", qty=2)
    _ship(db, b, o, status="IN_TRANSIT")
    return db, b


def test_cost_records_name_the_order_and_the_voucher_key():
    """An operator has to be able to act on a record, which needs the order id."""
    from app.models.order import Order
    from app.services.finance_posting import post_period_costs
    db, b = _env(two_orders=True)
    out = post_period_costs(db, b.id, START, END)
    orders = {o.id for o in db.query(Order).all()}
    freight = [r for r in out["records"] if r["cost_type"] == "shipping"]
    assert len(freight) == 2, freight
    for r in freight:
        assert r["order_id"] in orders, r
        assert r["shipment_id"], r
        assert r["voucher_key"].startswith("SHIPPING_EXPENSE:"), r
        assert r["reason"] == "", r
    for r in out["records"]:
        assert {"cost_type", "order_id", "shipment_id", "voucher_key", "outcome",
                "reason"} <= set(r), r


def test_a_voucher_key_longer_than_the_column_is_matched_the_same_way_on_both_sides():
    """_posted_groups stores fitted keys, so the lookup must fit too. Every real key
    is TYPE:<uuid> and short, so only an oversized key exposes the mismatch -- and
    with it, a report that claims `posted` forever while post_voucher swallows the
    replay."""
    from app.services import ledger_service as ls
    from app.services import finance_posting as fp
    key = "PAYMENT_GATEWAY_FEE:" + ("x" * 200)
    groups = {ls._fit_key(key): [("", "Payment Gateway", Decimal("20.00"))]}
    assert key not in groups, "the fixture must actually be oversized"
    assert fp._on_file(groups, key) is True, "an oversized key must still be found"
    assert fp._credited(groups, key, "Payment Gateway") == Decimal("20.00")


def _versioned_cost(db, b, key, old, new, effective_from, start="2026-01-01"):
    """Two versions of one rule, written the way cost_service.set_cost versions them:
    the open rule is closed at the new effective_from and a new one opened there."""
    from app.services.cost_service import set_cost
    set_cost(db, b.id, key, float(old), "MANUAL",
             datetime.fromisoformat(start).replace(tzinfo=timezone.utc))
    db.commit()
    set_cost(db, b.id, key, float(new), "MANUAL", effective_from)
    db.commit()


def _shipped(db, b, o, *, shipped_at):
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    p = db.query(Parcel).filter_by(order_id=o.id).first()
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=f"AWB-{o.internal_order_number}", tracking_status="SHIPPED",
                 shipped_at=shipped_at)
    db.add(s); db.commit(); db.refresh(s)
    return s


# --- Important 3: each record is priced at its OWN date (human-ruled) ----------

def test_an_order_before_a_rate_change_prices_at_the_old_rate():
    """Pricing a whole period at one instant would charge this 2026-09-01 order at a
    rate that only became effective on 2026-09-15 -- a rate that did not apply when
    the order was placed."""
    from app.models.order import Order
    from app.services.finance_posting import post_period_costs
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    early = _order(db, b, c, name="EARLY",
                   date=datetime(2026, 9, 1, tzinfo=timezone.utc))
    late = _order(db, b, c, name="LATE",
                  date=datetime(2026, 9, 20, tzinfo=timezone.utc))
    _versioned_cost(db, b, "PACKAGING", "10.00", "30.00",
                    datetime(2026, 9, 15, tzinfo=timezone.utc))
    out = post_period_costs(db, b.id, START, END)
    db.commit()
    from app.models.financial_transaction import FinancialTransaction
    got = {row.order_id: str(row.amount) for row in db.query(
        FinancialTransaction).filter_by(transaction_type="PACKAGING_EXPENSE").all()}
    assert got == {early.id: "10.00", late.id: "30.00"}, got
    # The date each was priced at is reported, so two figures in one period are
    # legible rather than puzzling.
    priced = {r["order_id"]: r["priced_at"] for r in out["records"]
              if r["cost_type"] == "packaging"}
    assert priced[early.id] == "2026-09-01T00:00:00+00:00", priced
    assert priced[late.id] == "2026-09-20T00:00:00+00:00", priced
    assert out["rate_changes"] == [
        {"key": "PACKAGING", "effective_from": "2026-09-15T00:00:00+00:00"}], out
    assert "ADJUSTMENT" in out["repricing_note"], out["repricing_note"]


def test_a_rate_change_mid_period_does_not_reprice_an_already_posted_order():
    """The accepted consequence, made observable: every voucher is keyed per record,
    so a re-run after a rate change is a no-op for what is already on file. The new
    rate applies only to records that were not already posted."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import ensure_period_postings
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    o = _order(db, b, c, name="A", date=datetime(2026, 9, 5, tzinfo=timezone.utc))
    _versioned_cost(db, b, "PACKAGING", "10.00", "10.00",
                    datetime(2026, 1, 1, tzinfo=timezone.utc))
    first = ensure_period_postings(db, b.id, START, END)
    db.commit()
    assert first["costs"]["packaging"]["posted"] == 1, first
    # The business raises the packaging rate, effective from the start of the period,
    # so every order in September now "should" cost 30.00.
    _versioned_cost(db, b, "PACKAGING", "10.00", "30.00",
                    datetime(2026, 9, 1, tzinfo=timezone.utc))
    second = ensure_period_postings(db, b.id, START, END)
    db.commit()
    assert second["costs"]["packaging"]["posted"] == 0, second
    assert second["costs"]["packaging"]["skipped"] == 1, second
    packaging = db.query(FinancialTransaction).filter_by(
        transaction_type="PACKAGING_EXPENSE").all()
    assert len(packaging) == 1 and str(packaging[0].amount) == "10.00", packaging
    # The operator is told there was a change in the period and that it was not
    # applied retroactively.
    assert second["costs"]["rate_changes"] == [
        {"key": "PACKAGING", "effective_from": "2026-09-01T00:00:00+00:00"}], second
    assert "NOT" in second["costs"]["repricing_note"] and "ADJUSTMENT" in \
        second["costs"]["repricing_note"], second["costs"]["repricing_note"]


def test_freight_prices_at_the_shipments_own_date_not_the_order_date():
    """A parcel ordered on 2026-09-05 and dispatched on 2026-09-20 travelled at the
    rate in force on the day it travelled. Pricing it at the order date would charge
    the older rate, and at the period end the newest rate -- neither is what the
    courier charged."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import post_period_costs
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    held = _order(db, b, c, name="SE",
                  date=datetime(2026, 9, 5, tzinfo=timezone.utc))
    late = _order(db, b, c, name="SL",
                  date=datetime(2026, 9, 20, tzinfo=timezone.utc))
    # The first parcel sat for a fortnight: ordered before the change, sent after.
    se = _shipped(db, b, held, shipped_at=datetime(2026, 9, 20, tzinfo=timezone.utc))
    sl = _shipped(db, b, late, shipped_at=datetime(2026, 9, 20, tzinfo=timezone.utc))
    _versioned_cost(db, b, "SHIPPING", "40.00", "90.00",
                    datetime(2026, 9, 15, tzinfo=timezone.utc))
    out = post_period_costs(db, b.id, START, END)
    db.commit()
    got = {r.order_id: str(r.amount) for r in db.query(FinancialTransaction).filter_by(
        transaction_type="SHIPPING_EXPENSE").all()}
    assert got == {held.id: "90.00", late.id: "90.00"}, got
    priced = {r["shipment_id"]: r["priced_at"] for r in out["records"]
              if r["cost_type"] == "shipping"}
    assert priced[se.id] == "2026-09-20T00:00:00+00:00", priced
    assert priced[sl.id] == "2026-09-20T00:00:00+00:00", priced
    # The order's own costs still price at its own date, so a held order carries a
    # pre-change packaging rate and a post-change freight rate. That is the point:
    # each record is priced when it happened, not when the period ran.
    pack = {r["order_id"]: r["priced_at"] for r in out["records"]
            if r["cost_type"] == "packaging"}
    assert pack[held.id] == "2026-09-05T00:00:00+00:00", pack


def test_freight_falls_back_to_the_order_date_when_the_shipment_has_not_shipped():
    from app.services.finance_posting import post_period_costs
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    o = _order(db, b, c, name="A", date=datetime(2026, 9, 5, tzinfo=timezone.utc))
    _ship(db, b, o, status="IN_TRANSIT")  # shipped_at is None
    _versioned_cost(db, b, "SHIPPING", "40.00", "90.00",
                    datetime(2026, 9, 15, tzinfo=timezone.utc))
    out = post_period_costs(db, b.id, START, END)
    db.commit()
    freight = [r for r in out["records"] if r["cost_type"] == "shipping"]
    assert len(freight) == 1, freight
    assert freight[0]["priced_at"] == "2026-09-05T00:00:00+00:00", freight
    assert out["shipping"]["posted"] == 1, out


def test_per_record_pricing_does_not_query_per_record(monkeypatch):
    """Pricing per record must not become querying per record: the rule rows are
    loaded once and selected locally, so the statement count does not grow with the
    number of orders."""
    from app.services import finance_posting as fp
    from app.services.finance_posting import post_period_costs
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    for i in range(6):
        o = _order(db, b, c, name=f"P{i}",
                   date=datetime(2026, 9, 5 + i, tzinfo=timezone.utc))
        _ship(db, b, o, status="IN_TRANSIT", awb=f"AWB-P{i}")
    _cost_rules(db, b)

    seen = []
    real = fp._RateBook.at

    def counting_at(self, *a, **kw):
        seen.append(a)
        return real(self, *a, **kw)

    monkeypatch.setattr(fp._RateBook, "at", counting_at)
    queries = []
    from sqlalchemy import event
    event.listen(db.get_bind(), "before_cursor_execute",
                 lambda c, cur, st, p, ctx, em: queries.append(st))
    post_period_costs(db, b.id, START, END)
    assert len(seen) == 6 * 4, len(seen)  # per record, as the ruling requires
    # One read per rule table for the whole period -- and none of these orders carry
    # a product_id, so ProductCostHistory is not read at all.
    rule_queries = [q for q in queries if "cost_rules" in q or "product_cost_history" in q]
    assert len(rule_queries) == 1, rule_queries

    # And it does not grow with the number of orders.
    _eng2, mk2 = _db()
    db2 = mk2()
    b2, c2 = _biz(db2)
    for i in range(12):
        o = _order(db2, b2, c2, name=f"Q{i}",
                   date=datetime(2026, 9, 5 + (i % 20), tzinfo=timezone.utc))
        _ship(db2, b2, o, status="IN_TRANSIT", awb=f"AWB-Q{i}")
    _cost_rules(db2, b2)
    queries2 = []
    event.listen(db2.get_bind(), "before_cursor_execute",
                 lambda c, cur, st, p, ctx, em: queries2.append(st))
    post_period_costs(db2, b2.id, START, END)
    rule_queries2 = [q for q in queries2 if "cost_rules" in q or "product_cost_history" in q]
    assert len(rule_queries2) == len(rule_queries), (len(rule_queries), len(rule_queries2))


# --- Important 4 follow-up: records are capped, and say so --------------------

def test_records_are_capped_and_the_truncation_is_reported(monkeypatch):
    """A truncated list that does not say it was truncated is worse than a small
    complete one, so the total and the per-outcome breakdown are reported over
    every record whether or not the list was cut."""
    from app.services import finance_posting as fp
    from app.services.finance_posting import post_period_costs
    _eng, mk = _db()
    db = mk()
    b, c = _biz(db)
    for i in range(6):
        o = _order(db, b, c, name=f"R{i}",
                   date=datetime(2026, 9, 5 + i, tzinfo=timezone.utc))
        _ship(db, b, o, status="IN_TRANSIT", awb=f"AWB-R{i}")
    _cost_rules(db, b)
    monkeypatch.setattr(fp, "_MAX_RECORDS", 5)
    out = post_period_costs(db, b.id, START, END)
    db.commit()
    assert out["records_total"] == 24, out
    assert len(out["records"]) == 5, out
    assert out["records_truncated"] is True, out
    # The counts are complete even though the list is not.
    assert sum(out["outcome_counts"].values()) == 24, out
    assert out["outcome_counts"] == {"posted": 24}, out
    assert out["cogs"]["posted"] == 6 and out["shipping"]["posted"] == 6, out
    # Every listed entry is still a real record.
    assert {r["cost_type"] for r in out["records"]} <= {"cogs", "shipping", "packaging",
                                                       "gateway_fee"}, out


def test_a_short_period_is_not_marked_truncated(monkeypatch):
    from app.services import finance_posting as fp
    from app.services.finance_posting import post_period_costs
    db, b = _env()
    monkeypatch.setattr(fp, "_MAX_RECORDS", 200)
    out = post_period_costs(db, b.id, START, END)
    assert out["records_total"] == 4 and len(out["records"]) == 4, out
    assert out["records_truncated"] is False, out
    assert sum(out["outcome_counts"].values()) == 4, out


# --- Minors -------------------------------------------------------------------

def test_auto_posted_is_false_for_a_dry_run_that_wrote_nothing():
    """`auto_posted` means the period WAS auto-posted, so a dry run cannot say true."""
    from app.services.finance_posting import ensure_period_postings
    db, b = _env()
    live = ensure_period_postings(db, b.id, START, END)
    db.commit()
    assert live["auto_posted"] is True and live["dry_run"] is False, live
    assert live["switches"] == {"costs": True, "cod": True}, live
    db2, b2 = _env()
    dry = ensure_period_postings(db2, b2.id, START, END, dry_run=True)
    assert dry["auto_posted"] is False, dry
    assert dry["switches"] == {"costs": True, "cod": True}, dry
    assert dry["dry_run"] is True, dry


# --- The endpoint -------------------------------------------------------------

def test_post_period_costs_endpoint_posts_and_is_role_gated():
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.main import app
    from app.models.business import Business
    from app.models.customer import Customer
    from app.models.user import User
    from app.services.auth_service import hash_password
    _eng, mk = _db()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b); db.commit(); db.refresh(b)
    cust = Customer(business_id=b.id, first_name="C", last_name="T", email="c@t.in")
    db.add(cust); db.commit(); db.refresh(cust)
    o = _order(db, b, cust, name="EP")
    _ship(db, b, o, status="IN_TRANSIT")
    _cost_rules(db, b)
    for role in ("ACCOUNTANT", "VIEWER"):
        db.add(User(business_id=b.id, name=role, email=f"{role}@t.in",
                    password_hash=hash_password("x"), role=role))
    db.commit()
    app.dependency_overrides[get_db] = lambda: mk()
    try:
        client = TestClient(app)
        tok = client.post("/api/v1/auth/login",
                          json={"email": "ACCOUNTANT@t.in", "password": "x"}).json()["data"]["token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = client.post("/api/v1/ledger/post-period-costs?year=2026&month=9", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["costs"]["cogs"]["posted"] == 1, data
        assert data["period"] == {"from": "2026-09-01T00:00:00+00:00",
                                  "to": "2026-10-01T00:00:00+00:00"}, data
        assert sorted(_rows(db)) == ["COGS", "PACKAGING_EXPENSE", "PAYMENT_GATEWAY_FEE",
                                     "SHIPPING_EXPENSE"]
        # Repeat: idempotent through the API too.
        r2 = client.post("/api/v1/ledger/post-period-costs?year=2026&month=9", headers=h)
        assert r2.json()["data"]["costs"]["cogs"]["posted"] == 0, r2.json()
        assert len(_rows(db)) == 4, _rows(db)
        # A non-accountant role is refused.
        tok2 = client.post("/api/v1/auth/login",
                           json={"email": "VIEWER@t.in", "password": "x"}).json()["data"]["token"]
        r3 = client.post("/api/v1/ledger/post-period-costs?year=2026&month=9",
                         headers={"Authorization": f"Bearer {tok2}"})
        assert r3.status_code == 403, r3.text
        # dry_run reports; October has no order, and September is already posted.
        r4 = client.post("/api/v1/ledger/post-period-costs?year=2026&month=10&dry_run=true",
                         headers=h)
        assert r4.json()["data"]["costs"]["cogs"]["would_post"] == 0, r4.json()
        r5 = client.post("/api/v1/ledger/post-period-costs?year=2026&month=9&dry_run=true",
                         headers=h)
        assert r5.json()["data"]["costs"]["cogs"]["would_post"] == 0, r5.json()
    finally:
        app.dependency_overrides.clear()


def test_tally_export_only_posts_when_both_date_bounds_are_given():
    """A one-sided window is the real trap: read as 'from date_from until NOW' it is
    far wider than the export, so the export would post costs for months it is not
    exporting. With no window at all there is no period to post, so skip.

    Only TallyError is caught: it is the export's own refusal. Anything else -- a
    bug in the wiring above the guard -- has to fail this test rather than be
    swallowed, or the guard would look tested while never being reached. The guard
    is the first statement of generate_workbook_export, so merely entering the
    function proves it was evaluated.
    """
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order
    from app.services import tally_service as ts
    from app.services.ledger_service import record_sale_from_order
    for kwargs in ({}, {"date_from": "2026-09-01T00:00:00+00:00"},
                   {"date_to": "2026-10-01T00:00:00+00:00"}):
        db, b = _env()  # fresh per shape, so no export state leaks between them
        record_sale_from_order(db, b.id, db.query(Order).one())
        db.commit()
        try:
            ts.generate_workbook_export(db, b.id, "u1", **kwargs)
        except ts.TallyError:
            pass
        assert db.query(FinancialTransaction).filter_by(
            transaction_type="COGS").count() == 0, kwargs


def test_tally_export_posts_the_period_it_exports():
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order
    from app.services import tally_service as ts
    from app.services.ledger_service import record_sale_from_order
    db, b = _env()
    record_sale_from_order(db, b.id, db.query(Order).one())
    db.commit()
    # No try/except: the export must succeed, or the postings below are not proof
    # of anything the guard did.
    ts.generate_workbook_export(db, b.id, "u1",
                                "2026-09-01T00:00:00+00:00", "2026-10-01T00:00:00+00:00")
    assert db.query(FinancialTransaction).filter_by(transaction_type="COGS").count() == 1
    assert db.query(FinancialTransaction).filter_by(
        transaction_type="PAYMENT_GATEWAY_FEE").count() == 1
