"""Task 3: cancellation is a marker; refunds reverse revenue AND post GST legs."""
from datetime import datetime, timezone
from decimal import Decimal as _D

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
             (None, "0.00", "27.00", "27.00", "34.00", 1, 18.0)]
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
    from app.models.financial_transaction import FinancialTransaction
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
    # GST must net to zero too. The credit note's CGST/SGST legs carry the tax in
    # tax_amount, so revenue_summary subtracts it; posting it as amount alone left
    # gst at a full 180.00 and net_exclusive at -180.00 on a fully refunded order.
    assert rev["gst"] == "0.00"
    assert rev["net_exclusive"] == "0.00"


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


def test_refund_credit_note_legs_sum_to_the_refund_exactly():
    """The taxable leg is derived from the tax legs, and post_voucher rounds each
    leg on its own. An unrounded split therefore left the credit note a paisa
    short of the refund on any amount that is not a clean fraction of the order.
    """
    from decimal import Decimal
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    for amount in ("1180.00", "590.00", "100.00", "333.33", "1.00", "777.77"):
        db, b, o = _env()
        r = _refund(db, b, o, amount)
        ls.record_refund_from_refund(db, b.id, r, order=o)
        db.commit()
        legs = db.query(FinancialTransaction).filter_by(
            refund_id=r.id, transaction_type="REFUND").all()
        total = sum((l.amount for l in legs), Decimal("0"))
        assert total == r.amount, f"{amount}: legs {[str(l.amount) for l in legs]} sum {total}"


def test_refund_legs_do_not_collide_on_one_voucher_number():
    """One refund writes several vouchers, so they must not share a
    reference_number: tally_service derives voucher_number from it, and a repeat
    blocks the whole export with VOUCHER_NOT_UNIQUE."""
    from app.services import tally_service as ts
    from app.services import ledger_service as ls
    db, b, o = _env()
    ls.record_sale_from_order(db, b.id, o)
    r = _refund(db, b, o, "1180.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    nums = [row["voucher_number"] for row in ts.collect_export_rows(db, b.id)]
    assert len(nums) == len(set(nums)), nums
    assert ts.validate_export(db, b.id)["can_export"] is True


def test_refund_replay_is_idempotent():
    """Webhook redelivery re-posts the same refund; it must not duplicate a leg
    or drop one."""
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env()
    r = _refund(db, b, o, "1180.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    first = {(t.transaction_type, t.debit_account): t.amount
             for t in db.query(FinancialTransaction).all()}
    for _ in range(3):
        ls.record_refund_from_refund(db, b.id, r, order=o)
        db.commit()
    rows = db.query(FinancialTransaction).all()
    assert len(rows) == len(first), f"{len(first)} -> {len(rows)} rows"
    after = {(t.transaction_type, t.debit_account): t.amount for t in rows}
    assert after == first


def test_refund_falls_back_to_half_split_without_order_items():
    """No OrderItem rows carrying split tax: the tax still has to reach the credit
    note, so it is halved from the order total rather than dropped to zero."""
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env(items=((None, "1000.00", "0.00", "0.00", "0.00", 1, 18.0),))
    r = _refund(db, b, o, "1180.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    legs = db.query(FinancialTransaction).filter_by(
        refund_id=r.id, transaction_type="REFUND").all()
    by = {l.debit_account: l.amount for l in legs}
    assert by["Output CGST"] == _D("90.00")
    assert by["Output SGST"] == _D("90.00")
    assert by["Sales Revenue"] == _D("1000.00")


def test_refund_posts_a_negative_taxable_leg_rather_than_dropping_it():
    """Order tax above its total makes the taxable leg negative. Dropping it left
    the receivable funded with no matching revenue reversal."""
    from app.services import ledger_service as ls
    from app.models.financial_transaction import FinancialTransaction
    db, b, o = _env(items=((None, "1000.00", "600.00", "600.00", "0.00", 1, 120.0),),
                    total="1000.00", tax="1200.00")
    r = _refund(db, b, o, "1000.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    legs = db.query(FinancialTransaction).filter_by(
        refund_id=r.id, transaction_type="REFUND").all()
    taxable = [l for l in legs if l.debit_account == "Sales Revenue"]
    assert len(taxable) == 1, "the taxable leg must be posted, even when negative"
    assert taxable[0].amount == _D("-200.00")  # 1000.00 refund - 1200.00 tax


def test_backfill_refund_counts_do_not_inflate_on_rerun():
    """One refund now writes several vouchers keyed 'REFUND:{id}:taxable' etc., so
    an exact-match guard never fired: every run re-entered the writer, wrote
    nothing (post_voucher is idempotent) and still counted as created."""
    from app.services import ledger_service as ls
    from app.services import report_service as rs
    db, b, o = _env()
    r = _refund(db, b, o, "1180.00")
    ls.record_refund_from_refund(db, b.id, r, order=o)
    db.commit()
    first = rs.backfill_ledger(db, b.id)
    assert first["refunds"] == {"created": 0, "skipped": 1}, first
    second = rs.backfill_ledger(db, b.id)
    assert second["refunds"] == {"created": 0, "skipped": 1}, second


def test_backfill_still_skips_a_legacy_single_key_refund_row():
    """A pre-0020 row keyed exactly 'REFUND:{id}' must still match the guard."""
    from app.models.financial_transaction import FinancialTransaction
    from app.services import report_service as rs
    db, b, o = _env()
    r = _refund(db, b, o, "1180.00")
    legacy = FinancialTransaction(
        business_id=b.id, transaction_id="TXN-LEGACY", order_id=o.id,
        refund_id=r.id, transaction_type="REFUND", transaction_date=DT,
        amount="1180.00", tax_amount="180.00", net_amount="1000.00", currency="INR",
        debit_account="Sales Revenue", credit_account="Payment Gateway",
        idempotency_key=f"REFUND:{r.id}", pnl_class="REVERSAL", leg_index=0,
    )
    db.add(legacy)
    db.commit()
    before = db.query(FinancialTransaction).filter_by(refund_id=r.id).count()
    out = rs.backfill_ledger(db, b.id)
    after = db.query(FinancialTransaction).filter_by(refund_id=r.id).count()
    assert out["refunds"]["skipped"] == 1, out
    assert after == before, f"legacy row was rewritten: {before} -> {after}"
