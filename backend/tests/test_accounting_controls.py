"""Task 5: accounting controls — month close, FY helper, closed-period guard, audit, RBAC."""
from datetime import datetime, timezone


def _env():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
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
    users = {}
    for role, email in (("ADMIN", "admin@t.in"), ("ACCOUNTANT", "acct@t.in"),
                        ("WAREHOUSE", "wh@t.in"), ("VIEWER", "view@t.in")):
        users[role] = User(business_id=b.id, name=role, email=email,
                           password_hash=hash_password("x"), role=role)
    db.add_all(users.values())
    db.commit()
    for u in users.values():
        db.refresh(u)
    bid = b.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)

    def tok(email):
        return {"Authorization": "Bearer " + c.post(
            "/api/v1/auth/login", json={"email": email, "password": "x"}).json()["data"]["token"]}

    return c, mk, bid, {r: tok(e) for r, e in
                        (("ADMIN", "admin@t.in"), ("ACCOUNTANT", "acct@t.in"),
                         ("WAREHOUSE", "wh@t.in"), ("VIEWER", "view@t.in"))}


def _seed_sept_issue(mk, bid):
    """September 2026 with an order (missing COGS) + PENDING payment + unexported SALE."""
    from app.models.order import Order
    from app.models.payment import Payment
    from app.services import ledger_service as ls
    db = mk()
    o = Order(business_id=bid, internal_order_number="T5-1", shopify_order_id="T5-1",
              shopify_order_name="#T5-1",
              order_date=datetime(2026, 9, 10, tzinfo=timezone.utc),
              total_amount=1180, tax_amount=180)
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Payment(business_id=bid, order_id=o.id, amount=1180, payment_status="PENDING",
                method="ONLINE", transaction_id="T5PAY1")
    db.add(p)
    db.commit()
    ls.record_event(db, bid, "SALE", "1180.00", "180.00",
                    transaction_date=datetime(2026, 9, 10, tzinfo=timezone.utc),
                    order_id=o.id, debit_account="D", credit_account="C",
                    idempotency_key="T5-SALE-1")
    db.commit()
    db.close()


def _bid(mk):
    from app.models.business import Business
    db = mk()
    bid = db.query(Business).first().id
    db.close()
    return bid


def test_close_refuses_with_issue_count():
    c, mk, _, h = _env()
    _seed_sept_issue(mk, _bid(mk))
    r = c.post("/api/v1/accounting/periods/2026/9/close", headers=h["ADMIN"])
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["success"] is False
    assert body["error"]["code"] == "CLOSE_BLOCKED"
    assert body["error"]["issues"]["total"] > 0
    assert "issues remain" in body["error"]["message"]


def test_close_reopen_and_guard():
    c, mk, bid, h = _env()
    # Clean August closes.
    r = c.post("/api/v1/accounting/periods/2026/8/close", headers=h["ACCOUNTANT"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "CLOSED"
    # Closed-period guard: back-dated SALE blocked, ADJUSTMENT allowed.
    bad = c.post("/api/v1/ledger", json={
        "transaction_type": "SALE", "amount": "100.00",
        "transaction_date": "2026-08-10T10:00:00+00:00",
        "debit_account": "D", "credit_account": "C"}, headers=h["ACCOUNTANT"])
    assert bad.status_code == 400, bad.text
    assert bad.json()["error"]["code"] == "BAD_REQUEST"
    ok = c.post("/api/v1/ledger", json={
        "transaction_type": "ADJUSTMENT", "amount": "10.00",
        "transaction_date": "2026-08-10T10:00:00+00:00",
        "debit_account": "D", "credit_account": "C"}, headers=h["ACCOUNTANT"])
    assert ok.status_code == 200, ok.text
    # Reopen is audited; then SALE works again.
    r2 = c.post("/api/v1/accounting/periods/2026/8/reopen", headers=h["ADMIN"])
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["status"] == "OPEN"
    ok2 = c.post("/api/v1/ledger", json={
        "transaction_type": "SALE", "amount": "100.00",
        "transaction_date": "2026-08-10T10:00:00+00:00",
        "debit_account": "D", "credit_account": "C"}, headers=h["ACCOUNTANT"])
    assert ok2.status_code == 200, ok2.text
    # Audit trail for close + reopen.
    a = c.get("/api/v1/audit", params={"entity_type": "accounting_period"},
              headers=h["ADMIN"]).json()["data"]["items"]
    assert {x["action"] for x in a} >= {"MONTH_CLOSED", "MONTH_REOPENED"}


def test_fy_default_and_configurable():
    c, mk, bid, h = _env()
    d = c.get("/api/v1/accounting/fy", params={"date": "2026-09-30T00:00:00+00:00"},
              headers=h["ADMIN"]).json()["data"]
    assert d["fy"] == "FY 2026-27"
    assert d["start"].startswith("2026-04-01")
    assert d["fy_start_month"] == 4
    r = c.put("/api/v1/accounting/fy", json={"fy_start_month": 1}, headers=h["ADMIN"])
    assert r.status_code == 200, r.text
    d2 = c.get("/api/v1/accounting/fy", params={"date": "2026-02-01T00:00:00+00:00"},
               headers=h["ADMIN"]).json()["data"]
    assert d2["fy_start_month"] == 1
    assert d2["start"].startswith("2026-01-01")
    assert d2["fy"] == "FY 2026-27"
    # Non-admin cannot change FY config.
    assert c.put("/api/v1/accounting/fy", json={"fy_start_month": 4},
                 headers=h["ACCOUNTANT"]).status_code == 403


def test_from_alias_and_envelope():
    c, mk, bid, h = _env()
    r = c.get("/api/v1/accounting/month", params={"from": "2026-09"}, headers=h["ADMIN"])
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    bad = c.get("/api/v1/accounting/month", params={"from": "nope"}, headers=h["ADMIN"])
    assert bad.status_code == 400
    assert bad.json()["success"] is False
    assert bad.json()["error"]["code"] == "BAD_REQUEST"


def test_rbac_matrix_warehouse_blocked_viewer_readonly():
    c, mk, bid, h = _env()
    body = {"transaction_type": "SALE", "amount": "10.00",
            "debit_account": "D", "credit_account": "C"}
    assert c.post("/api/v1/ledger", json=body, headers=h["WAREHOUSE"]).status_code == 403
    assert c.post("/api/v1/ledger", json=body, headers=h["VIEWER"]).status_code == 403
    assert c.post("/api/v1/tally/export-workbook",
                  params={"from": "2026-01-01T00:00:00+00:00",
                          "to": "2026-02-01T00:00:00+00:00"},
                  headers=h["WAREHOUSE"]).status_code == 403
    assert c.post("/api/v1/accounting/periods/2026/7/close",
                  headers=h["WAREHOUSE"]).status_code == 403
    assert c.post("/api/v1/accounting/periods/2026/7/close",
                  headers=h["VIEWER"]).status_code == 403
    # Viewer can still read reports.
    r = c.get("/api/v1/reports/monthly", params={"month": "2026-09"}, headers=h["VIEWER"])
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True


def test_audit_coverage_mapping_statement_tally():
    c, mk, bid, h = _env()
    # Mapping change audited.
    m = c.put("/api/v1/tally/mapping", json={
        "ledger_sales": "Online Sales", "ledger_cgst": "CGST 9%",
        "ledger_sgst": "SGST 9%", "ledger_igst": "IGST 18%",
        "ledger_razorpay": "Razorpay Clearing"}, headers=h["ACCOUNTANT"])
    assert m.status_code == 200, m.text
    # Statement upload audited.
    csv_body = b"awb,amount,date\nAWB1,100,2026-09-01\n"
    u = c.post("/api/v1/statements/upload?type=COURIER_SETTLEMENT",
               files={"file": ("s.csv", csv_body, "text/csv")}, headers=h["ACCOUNTANT"])
    assert u.status_code == 200, u.text
    # Tally export + mark-imported audited (needs customer-linked SALE in open month).
    # Use a past month relative to now: tally validation rejects future dates,
    # and this test's DB has no closed periods.
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    base = (now - timedelta(days=60)).replace(day=5, hour=10, minute=0, second=0, microsecond=0)
    mstart = base.replace(day=1)
    mend = datetime(mstart.year + (1 if mstart.month == 12 else 0),
                    1 if mstart.month == 12 else mstart.month + 1, 1, tzinfo=timezone.utc)
    from app.models.customer import Customer
    from app.models.order import Order
    from app.services import ledger_service as ls
    db = mk()
    cust = Customer(business_id=bid, first_name="T5", last_name="C", email="t5@c.in")
    db.add(cust)
    db.commit()
    db.refresh(cust)
    o = Order(business_id=bid, internal_order_number="T5X", shopify_order_id="T5X",
              shopify_order_name="INV-T5X", customer_id=cust.id,
              order_date=base, total_amount=1180, tax_amount=180)
    db.add(o)
    db.commit()
    db.refresh(o)
    ls.record_event(db, bid, "SALE", "1180.00", "180.00",
                    transaction_date=base,
                    order_id=o.id, debit_account="Customer / Receivable",
                    credit_account="Sales Revenue",
                    reference_number="INV-T5X", tally_voucher_type="Sales",
                    tally_voucher_number="INV-T5X", idempotency_key="T5-SALE-X")
    db.commit()
    db.close()
    x = c.post("/api/v1/tally/export-workbook",
               params={"from": mstart.isoformat(), "to": mend.isoformat()},
               headers=h["ACCOUNTANT"])
    assert x.status_code == 200, x.text[:500]
    batches = c.get("/api/v1/tally/batches", headers=h["ACCOUNTANT"]).json()["data"]
    assert batches, "export batch must exist"
    bid_batch = batches[0]["id"]
    mi = c.post(f"/api/v1/tally/exports/{bid_batch}/mark-imported", json={},
                headers=h["ACCOUNTANT"])
    assert mi.status_code == 200, mi.text
    items = c.get("/api/v1/audit", headers=h["ADMIN"]).json()["data"]["items"]
    actions = {i["action"] for i in items}
    assert {"MAPPING_CHANGED", "STATEMENT_UPLOADED", "TALLY_GENERATED",
            "MARKED_IMPORTED"} <= actions
