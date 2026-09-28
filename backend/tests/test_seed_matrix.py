# backend/tests/test_seed_matrix.py
"""Task 5: Seed matrix proving R001-R008 (codes-present style).

_mk is PAID with no payments so R004 fires in background - never assert
exact-issue-list equality, only codes-present.
"""
from test_returns import _mk


def _codes(db, oid):
    from app.services.reconciliation_service import reconcile_order
    return {x["code"]: x["severity"] for x in reconcile_order(db, oid)["issues"]}


def test_r001_cancelled_dispatched():
    from datetime import datetime, timezone
    db, b, u, o, i, p = _mk()
    o.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    assert _codes(db, o.id).get("CANCELLED_BUT_DISPATCHED") == "CRITICAL"


def test_r001_pack_only_high():
    from datetime import datetime, timezone
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.query(ScanEvent).filter_by(parcel_id=p.id).delete()
    p.status = "PACKED"
    db.commit()
    o.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    assert _codes(db, o.id).get("CANCELLED_AFTER_PACK") == "HIGH"


def test_r002_return_without_refund():
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    assert _codes(db, o.id).get("RETURN_WITHOUT_REFUND") == "HIGH"


def test_r003_refund_without_return():
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="rx",
                  amount=300.0, currency="INR", status="COMPLETED"))
    db.commit()
    assert _codes(db, o.id).get("REFUND_WITHOUT_RETURN") == "MEDIUM"


def test_r004_paid_no_payment():
    db, b, u, o, i, p = _mk()
    assert o.financial_status == "PAID"
    assert _codes(db, o.id).get("PAYMENT_DATA_MISSING") == "HIGH"


def test_r005_duplicate_dispatch():
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.add(ScanEvent(business_id=b.id, parcel_id=p.id, order_id=o.id,
                     event_type="DISPATCHED", performed_by=u.id))
    db.commit()
    assert _codes(db, o.id).get("DUPLICATE_DISPATCH_SCAN") == "HIGH"


def test_r006_return_without_dispatch():
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    db.query(ScanEvent).filter_by(parcel_id=p.id).delete()
    db.add(ScanEvent(business_id=b.id, parcel_id=p.id, order_id=o.id,
                     event_type="RETURN_RECEIVED", performed_by=u.id))
    db.commit()
    assert _codes(db, o.id).get("RETURN_WITHOUT_DISPATCH") == "HIGH"


def test_r007_over_qty():
    from app.models.return_record import ReturnRecord, ReturnItem
    db, b, u, o, i, p = _mk()
    r = ReturnRecord(business_id=b.id, order_id=o.id, parcel_id=p.id,
                     return_type="CUSTOMER_RETURN", status="RECEIVED",
                     created_by=u.id)
    db.add(r)
    db.flush()
    db.add(ReturnItem(return_id=r.id, order_item_id=i.id,
                      quantity=i.quantity + 5))
    db.commit()
    assert _codes(db, o.id).get("RETURN_QUANTITY_MISMATCH") == "HIGH"


def test_r008_stale_sync():
    from datetime import datetime, timedelta, timezone
    db, b, u, o, i, p = _mk()
    o.shopify_updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()
    assert _codes(db, o.id).get("SYNC_DELAY") == "MEDIUM"
