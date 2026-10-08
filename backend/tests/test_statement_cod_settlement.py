"""Task 4 fix: a processed courier statement must feed the COD remittance.

The statement processor stored the carrier's NET remittance as
ShipmentFinancial.settled_amount, so `net + fee + deductions` exceeded the settled
amount by exactly the fee and every real settlement was refused with
CodSettlementMismatch. End to end here: CSV -> process -> ledger.
"""
from datetime import datetime, timezone

import pytest

# gross 1499, carrier fee 90, net payout 1409.
CSV = b"AWB No,COD Amount,Settlement Date,Fee,Net Remittance\nD500,1499,2026-09-01,90,1409\n"


@pytest.fixture
def env():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base, get_db
    import app.models.business
    import app.models.user
    import app.models.order
    import app.models.parcel
    import app.models.shipment
    import app.models.statement
    from app.main import app
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services.auth_service import hash_password

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in",
             password_hash=hash_password("x"), role="ACCOUNTANT")
    db.add(u)
    db.commit()
    db.refresh(u)
    now = datetime.now(timezone.utc)
    o = Order(business_id=b.id, internal_order_number="ORD-S1", shopify_order_id="gid://s1",
              shopify_order_name="#S1", currency="INR", total_amount=1499.0,
              cod_mode="COD", cod_value=1499.0, operational_status="DELIVERED",
              order_date=now)
    db.add(o)
    db.commit()
    db.refresh(o)
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="P00000001",
               barcode_value="P00000001", status="DISPATCHED")
    db.add(p)
    db.commit()
    db.refresh(p)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number="D500", tracking_status="DELIVERED", delivered_at=now)
    db.add(s)
    db.commit()
    db.refresh(s)
    bid = b.id
    from app.services.finance_posting import record_cod_collection_from_shipment
    record_cod_collection_from_shipment(db, bid, s)  # the courier holds 1499.00
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login",
                 json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    h = {"Authorization": f"Bearer {tok}"}
    yield c, h, mk, bid
    app.dependency_overrides.pop(get_db, None)


def _process(env):
    c, h, _mk, _bid = env
    uid = c.post("/api/v1/statements/upload?type=COURIER_SETTLEMENT&provider=DTDC"
                 "&period_start=2026-09-01&period_end=2026-09-30",
                 files={"file": ("stmt.csv", CSV, "text/csv")}, headers=h)
    assert uid.status_code == 200, uid.text
    row_id = uid.json()["data"]["id"]
    assert c.post(f"/api/v1/statements/{row_id}/process", headers=h).status_code == 200
    return row_id


def test_processed_statement_stores_the_gross_as_the_settled_amount(env):
    """settled_amount is what the carrier settled, so fees can be subtracted from it
    to reach the payout. Storing the net made report_service subtract the fee twice."""
    from app.models.sla import ShipmentFinancial
    _c, _h, mk, bid = env
    _process(env)
    db = mk()
    fin = db.query(ShipmentFinancial).filter_by(business_id=bid).first()
    assert fin is not None
    assert str(fin.settled_amount) == "1499.00"
    assert str(fin.net_settlement) == "1409.00"
    assert str(fin.fee_amount) == "90.00"
    assert str(fin.collected_amount) == "1499.00"
    assert str(fin.other_deduction) == "0.00"  # StatementRow has no such column


def test_a_real_statement_settlement_posts_to_the_ledger(env):
    """The whole point of storing the gross: net 1409 + fee 90 = the settled 1499, so
    the remittance reconciles and the carrier's money reaches Cash / Bank."""
    from app.models.financial_transaction import FinancialTransaction
    from app.models.sla import ShipmentFinancial
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    _c, _h, mk, bid = env
    _process(env)
    db = mk()
    fin = db.query(ShipmentFinancial).filter_by(business_id=bid).first()
    rows = record_cod_remittance_from_shipment_financial(db, bid, fin)
    db.commit()
    by = {r.debit_account or r.credit_account: (str(r.amount), r.pnl_class) for r in rows}
    assert by == {"Cash / Bank": ("1409.00", "NONE"),
                  "Carrier Freight / Fees": ("90.00", "EXPENSE"),
                  "COD Receivable": ("1499.00", "NONE")}, by
    # 1499.00 collected and 1499.00 settled: the carrier owes us nothing.
    cod = db.query(FinancialTransaction).filter(
        FinancialTransaction.debit_account == "COD Receivable").all()
    assert len(cod) == 1 and str(cod[0].amount) == "1499.00"
