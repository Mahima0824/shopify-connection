"""Task 1 TDD: canonical financial ledger. Written FIRST (RED phase)."""
from datetime import datetime, timezone


def _mkevent(**kw):
    from app.services import ledger_service as ls
    base = dict(transaction_type="SALE", amount="1000.00", tax_amount="0.00",
                currency="INR", debit_account="Customer / Receivable",
                credit_account="Sales Revenue")
    base.update(kw)
    return base


def test_gst_split_sale():
    from app.services.ledger_service import to_double_entry
    txn = _mkevent(transaction_type="SALE", amount="1180.00", tax_amount="180.00")
    entries = to_double_entry(txn)
    by_acct = {e["credit"]: e["amount"] for e in entries if "credit" in e}
    assert by_acct["Sales Revenue"] == "1000.00"
    assert by_acct["Output GST"] == "180.00"


def test_refund_reduces_revenue():
    from app.services.ledger_service import revenue_summary
    txns = [
        {"transaction_type": "SALE", "amount": "1180.00", "tax_amount": "180.00"},
        {"transaction_type": "REFUND", "amount": "590.00", "tax_amount": "90.00"},
    ]
    r = revenue_summary(txns)
    assert r["gross_inclusive"] == "1180.00"
    assert r["refunds_inclusive"] == "590.00"
    assert r["net_inclusive"] == "590.00"
    assert r["net_exclusive"] == "500.00"


def test_profit_example_plan_84():
    from app.services.ledger_service import profit_summary
    p = profit_summary(net_sales_exclusive="1000.00", cogs="500.00", shipping="70.00",
                       packaging="15.00", gateway_fees="20.00", other="0.00",
                       costs_complete=True)
    assert p["gross_profit"] == "500.00"
    assert p["operating_profit"] == "395.00"
    assert p["label"] == "OPERATING PROFIT"


def test_profit_estimated_when_incomplete():
    from app.services.ledger_service import profit_summary
    p = profit_summary(net_sales_exclusive="1000.00", cogs="500.00", shipping="70.00",
                       packaging="15.00", gateway_fees="20.00", other="0.00",
                       costs_complete=False, missing_cogs_count=18)
    assert p["label"] == "ESTIMATED OPERATING PROFIT"
    assert "18" in p["warning"]


def test_cogs_qty_times_cost():
    from app.services.ledger_service import cogs_for_item
    assert cogs_for_item(3, "200.00") == "600.00"


def test_fy_bounds_india():
    from app.services.ledger_service import fy_bounds
    s, e = fy_bounds(datetime(2026, 9, 30, tzinfo=timezone.utc))
    assert (s.month, s.day) == (4, 1) and s.year == 2026
    assert (e.month, e.day) == (4, 1) and e.year == 2027  # exclusive end bound


def test_double_entry_payment_and_fee():
    from app.services.ledger_service import to_double_entry
    pay = to_double_entry(_mkevent(transaction_type="PAYMENT", amount="1000.00",
                                   debit_account="Payment Gateway",
                                   credit_account="Customer / Receivable"))
    assert pay[0]["debit"] == "Payment Gateway"
    fee = to_double_entry(_mkevent(transaction_type="PAYMENT_GATEWAY_FEE", amount="20.00",
                                   debit_account="Payment Gateway Fee",
                                   credit_account="Payment Gateway"))
    assert fee[0]["debit"] == "Payment Gateway Fee"

def test_immutable_no_update_delete_api():
    # Ledger must expose no update/delete routes: corrections via reversal only.
    from app.main import app
    routes = [r for r in app.routes if getattr(r, "path", "").startswith("/api/v1/ledger")]
    assert routes, "ledger routes must be wired in main.py"
    for r in routes:
        assert "PUT" not in r.methods and "DELETE" not in r.methods and "PATCH" not in r.methods, (r.path, r.methods)


def _api_env():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401 - register all models
    from app.main import app
    from app.database import get_db
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ACCOUNTANT")
    db.add(u)
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}


def _post(c, h, typ, amt, tax="0.00", dt="2026-09-10T10:00:00+00:00", **kw):
    body = {"transaction_type": typ, "amount": amt, "tax_amount": tax,
            "transaction_date": dt, "debit_account": "D", "credit_account": "C"}
    body.update(kw)
    r = c.post("/api/v1/ledger", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_ledger_crud_summary_and_date_range():
    c, h = _api_env()
    _post(c, h, "SALE", "1180.00", "180.00", "2026-09-10T10:00:00+00:00")
    _post(c, h, "REFUND", "590.00", "90.00", "2026-09-12T10:00:00+00:00")
    _post(c, h, "SALE", "500.00", "0.00", "2026-08-05T10:00:00+00:00")
    sept = c.get("/api/v1/ledger", params={"from_": "2026-09-01T00:00:00+00:00", "to": "2026-10-01T00:00:00+00:00"}, headers=h).json()["data"]
    assert sept["total"] == 2
    s = c.get("/api/v1/ledger/summary", params={"from_": "2026-09-01T00:00:00+00:00", "to": "2026-10-01T00:00:00+00:00"}, headers=h).json()["data"]
    assert s["revenue"]["net_inclusive"] == "590.00"
    assert s["revenue"]["net_exclusive"] == "500.00"
    assert s["display_timezone"] == "Asia/Kolkata"


def test_ledger_fy_endpoint():
    c, h = _api_env()
    _post(c, h, "SALE", "1180.00", "180.00", "2026-09-10T10:00:00+00:00")
    d = c.get("/api/v1/ledger/fy", params={"date": "2026-09-30T00:00:00+00:00"}, headers=h).json()["data"]
    assert d["fy"]["start"].startswith("2026-04-01")
    assert d["revenue"]["gross_inclusive"] == "1180.00"


def test_ledger_reverse_and_idempotency():
    c, h = _api_env()
    txn = _post(c, h, "SALE", "1000.00", "0.00", idempotency_key="K1")
    dup = _post(c, h, "SALE", "1000.00", "0.00", idempotency_key="K1")
    assert dup["transaction_id"] == txn["transaction_id"]
    rev = c.post("/api/v1/ledger/reverse",
                 json={"transaction_id": txn["transaction_id"], "reason": "correction"}, headers=h).json()["data"]
    assert rev["transaction_type"] == "ADJUSTMENT"
    items = c.get("/api/v1/ledger", headers=h).json()["data"]["items"]
    assert any(i["transaction_id"] == txn["transaction_id"] and i["amount"] == "1000.00" for i in items)
