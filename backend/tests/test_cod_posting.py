"""Task 4: COD collection and carrier remittance writers."""
from datetime import datetime, timezone
from decimal import Decimal

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
    p = Parcel(business_id=b.id, order_id=o.id, parcel_code="PC1", barcode_value="BC1")
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


def test_cod_collection_skipped_before_delivery():
    """Nothing is collected from the customer until the courier hands it over, so an
    in-transit shipment must not raise a receivable that COD_REMIT could not offset."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_collection_from_shipment
    db, b, o, s = _env()
    s.tracking_status = "IN_TRANSIT"
    db.commit()
    assert record_cod_collection_from_shipment(db, b.id, s) is None
    assert db.query(FinancialTransaction).count() == 0


def test_cod_collection_skipped_when_the_order_carries_no_amount():
    """A manual COD order can be created with no cod_value and total_amount 0. Posting
    0.00 would balance and would CONSUME the voucher key, so the real figure arriving
    later would be dropped as a replay -- the guard must leave the key unspent."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_collection_from_shipment
    db, b, o, s = _env()
    o.cod_value = None
    o.total_amount = 0
    db.commit()
    assert record_cod_collection_from_shipment(db, b.id, s) is None
    assert db.query(FinancialTransaction).count() == 0
    o.cod_value = 1180.0
    o.total_amount = 1180.0
    db.commit()
    rows = record_cod_collection_from_shipment(db, b.id, s)
    db.commit()
    assert len(rows) == 1 and str(rows[0].amount) == "1180.00"


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
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)  # the remit needs this raised first
    f = _sf(db, b, s, collected_amount=1180.0, expected_cod_amount=1180.0,
            settled_amount=1180.0, fee_amount=40.0, other_deduction=10.0,
            net_settlement=1130.0)
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    by = {(r.debit_account, r.credit_account): (str(r.amount), r.pnl_class) for r in rows}
    assert by[("Cash / Bank", "")] == ("1130.00", "NONE")
    assert by[("Carrier Freight / Fees", "")] == ("40.00", "EXPENSE")
    assert by[("COD Deductions / Write-off", "")] == ("10.00", "EXPENSE")
    assert by[("", "COD Receivable")] == ("1180.00", "NONE")


def test_cod_remit_then_collection_nets_receivable_to_zero():
    """A fully settled COD shipment must leave the COD Receivable account at zero, so
    the figure the collection raised has to equal what the carrier settled -- and both
    vouchers have to name that account, not just one of them."""
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)  # raises 1180.00 (order cod_value)
    # 1130.00 net + 40.00 fee + 10.00 deduction = 1180.00, the amount collected.
    f = _sf(db, b, s, collected_amount=1180.0, expected_cod_amount=1180.0,
            settled_amount=1180.0, fee_amount=40.0, other_deduction=10.0,
            net_settlement=1130.0)
    record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    self_netted = db.query(FinancialTransaction).filter(
        FinancialTransaction.debit_account == "COD Receivable",
        FinancialTransaction.credit_account == "COD Receivable").all()
    assert self_netted == [], "a leg must not debit and credit the same account"
    on_account = db.query(FinancialTransaction).filter(
        FinancialTransaction.debit_account == "COD Receivable").all()
    to_account = db.query(FinancialTransaction).filter(
        FinancialTransaction.credit_account == "COD Receivable").all()
    dr = sum((r.amount for r in on_account), Decimal("0"))
    cr = sum((r.amount for r in to_account), Decimal("0"))
    # Both sides are asserted by figure, not only against each other: a collection
    # that raised nothing would net to zero against an equal remit of nothing.
    assert str(dr) == "1180.00", [(r.transaction_type, str(r.amount)) for r in on_account]
    assert str(cr) == "1180.00", [(r.transaction_type, str(r.amount)) for r in to_account]
    assert dr == cr


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


def test_cod_remit_refusal_names_the_settlement_and_its_three_parts():
    """An operator has to be able to see *which* settlement was refused and why."""
    from app.services.finance_posting import (
        CodSettlementMismatch, record_cod_remittance_from_shipment_financial)
    db, b, o, s = _env()
    f = _sf(db, b, s, settled_amount=999.0, settlement_reference="DTDC-UTR-77")
    try:
        record_cod_remittance_from_shipment_financial(db, b.id, f)
        raise AssertionError("expected CodSettlementMismatch")
    except CodSettlementMismatch as e:
        msg = str(e)
        for part in ("DTDC-UTR-77", "900.00", "40.00", "10.00", "950.00", "999.00"):
            assert part in msg, f"{part} missing from {msg!r}"


def test_cod_remit_accepts_a_rupee_of_carrier_rounding():
    """Carriers settle to the rupee, so a gap of up to 1.00 is a real settlement,
    not a data error; refusing it would leave the receivable open forever."""
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)
    f = _sf(db, b, s, settled_amount=951.0)  # 900 + 40 + 10 = 950, one rupee short
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    credited = [r for r in rows if r.credit_account == "COD Receivable"]
    assert len(rows) == 4
    assert len(credited) == 1 and str(credited[0].amount) == "950.00"


def test_cod_remit_skips_zero_fee_and_deduction_legs():
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)
    f = _sf(db, b, s, settled_amount=1000.0, fee_amount=0.0, other_deduction=0.0,
            net_settlement=1000.0)
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    assert len(rows) == 2


def test_cod_remit_posts_on_a_partially_settled_shipment():
    """The statement processor writes PARTIALLY_SETTLED (statements.py), and the money
    really moved: refusing to post it would leave the carrier's payment unbanked and
    the receivable open forever."""
    from app.services.finance_posting import (
        record_cod_collection_from_shipment, record_cod_remittance_from_shipment_financial)
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    record_cod_collection_from_shipment(db, b.id, s)
    f = _sf(db, b, s, status="PARTIALLY_SETTLED")
    rows = record_cod_remittance_from_shipment_financial(db, b.id, f)
    db.commit()
    assert len(rows) == 4
    assert db.query(FinancialTransaction).filter_by(transaction_type="COD_REMIT").count() == 4


def test_cod_remit_skipped_for_a_prepaid_order():
    """The statement processor creates a ShipmentFinancial for any matched shipment,
    COD or not. A prepaid one already paid online: posting would credit a COD
    Receivable that was never raised and bank a remittance that never happened."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    db, b, o, s = _env()
    o.cod_mode = "PREPAID"
    db.commit()
    f = _sf(db, b, s)
    assert record_cod_remittance_from_shipment_financial(db, b.id, f) is None
    assert db.query(FinancialTransaction).count() == 0


def test_cod_remit_refuses_when_no_collection_was_raised():
    """Without the collection there is no receivable to clear, so the remit would be
    two wrong entries rather than one visible gap."""
    from app.services.finance_posting import (
        CodCollectionMissing, record_cod_remittance_from_shipment_financial)
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    f = _sf(db, b, s)
    try:
        record_cod_remittance_from_shipment_financial(db, b.id, f)
        raise AssertionError("expected CodCollectionMissing")
    except CodCollectionMissing as e:
        assert "ST1" in str(e) and s.id in str(e)
    assert db.query(FinancialTransaction).count() == 0


def test_cod_remit_rejects_a_negative_component_by_name():
    """A negative net is a carrier clawback. Dropping it from the debit side while
    still netting it into `cleared` could only fail as UnbalancedVoucher, which never
    names the figure that is wrong."""
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    from app.services.finance_posting import record_cod_collection_from_shipment
    record_cod_collection_from_shipment(db, b.id, s)
    f = _sf(db, b, s, net_settlement=-50.0, settled_amount=0.0)
    try:
        record_cod_remittance_from_shipment_financial(db, b.id, f)
        raise AssertionError("expected a ValueError naming the negative figure")
    except ValueError as e:
        assert "-50.00" in str(e), str(e)
    assert db.query(FinancialTransaction).filter_by(transaction_type="COD_REMIT").count() == 0


def test_cod_remit_skipped_until_the_shipment_is_settled():
    """The writer decides for itself whether the carrier has paid: an EXPECTED row
    has nothing to remit, so it must not post a voucher against settled_amount 0."""
    from app.services.finance_posting import record_cod_remittance_from_shipment_financial
    from app.models.financial_transaction import FinancialTransaction
    db, b, o, s = _env()
    f = _sf(db, b, s, status="EXPECTED")
    assert record_cod_remittance_from_shipment_financial(db, b.id, f) is None
    assert db.query(FinancialTransaction).count() == 0
