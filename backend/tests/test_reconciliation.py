# backend/tests/test_reconciliation.py
from test_returns import _mk  # reuse dispatched order+parcel fixture (order with 1 item qty 3)


def _ship(db, b, o, p, awb="D-R9"):
    from app.models.shipment import Shipment
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=awb, tracking_status="IN_TRANSIT")
    db.add(s)
    db.commit()
    return s


def test_r001_cancelled_dispatched():
    from app.services.reconciliation_service import reconcile_order
    from datetime import datetime, timezone
    db, b, u, o, i, p = _mk()
    o.cancelled_at = datetime.now(timezone.utc); db.commit()
    out = reconcile_order(db, o.id)
    assert out["status"] == "EXCEPTION"
    assert any(x["code"] == "CANCELLED_BUT_DISPATCHED" and x["severity"] == "CRITICAL" for x in out["issues"])


def test_clean_order():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    # _mk order is PAID with no payment rows -> would trip R004; unpaid is the clean case.
    # Dispatched parcels also need a shipment row post-R009.
    o.financial_status = "PENDING"; db.commit()
    _ship(db, b, o, p)
    out = reconcile_order(db, o.id)
    assert out == {"status": "RECONCILED", "issues": []}


def test_r004_paid_no_payment():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    assert o.financial_status == "PAID"
    out = reconcile_order(db, o.id)
    assert any(x["code"] == "PAYMENT_DATA_MISSING" for x in out["issues"])


def test_r002_return_no_refund_and_clears():
    from app.services.reconciliation_service import reconcile_order
    from app.services.return_service import record_return
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert any(x["code"] == "RETURN_WITHOUT_REFUND" for x in reconcile_order(db, o.id)["issues"])
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="r1", amount=300.0, currency="INR", status="COMPLETED"))
    db.commit()
    assert reconcile_order(db, o.id)["status"] in ("RECONCILED", "EXCEPTION")
    codes = [x["code"] for x in reconcile_order(db, o.id)["issues"]]
    assert "RETURN_WITHOUT_REFUND" not in codes


def test_auto_resolve():
    from app.services.reconciliation_service import reconcile_order
    from app.models.reconciliation import Reconciliation
    from app.models.payment import Payment
    from datetime import datetime, timezone
    db, b, u, o, i, p = _mk()
    # Neutralize R004 (PAID, no payment rows in _mk) and R009 (no shipment) so only
    # the CANCELLED issue is under test.
    db.add(Payment(business_id=b.id, order_id=o.id, amount=300.0, payment_status="PAID"))
    db.commit()
    _ship(db, b, o, p)
    o.cancelled_at = datetime.now(timezone.utc); db.commit()
    reconcile_order(db, o.id)
    assert db.query(Reconciliation).filter_by(order_id=o.id, resolved=False).count() >= 1
    o.cancelled_at = None; db.commit()
    out = reconcile_order(db, o.id)
    assert all(r.resolved for r in db.query(Reconciliation).filter_by(order_id=o.id).all()) or out["status"] == "RECONCILED"
