# backend/tests/test_timeline.py
def test_timeline_ordered():
    from app.services.timeline_service import build_timeline
    import app.models.return_record  # noqa
    from test_returns import _mk
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    tl = build_timeline(db, b.id, o.id)
    kinds = [n["kind"] for n in tl]
    assert kinds[0] == "CREATED"
    assert "DISPATCHED" in kinds and "RETURN" in kinds
    assert kinds.index("DISPATCHED") < kinds.index("RETURN")
    assert any(n["kind"] == "AUDIT" for n in tl)


def test_timeline_cancelled_and_refund_nodes():
    from datetime import datetime, timezone
    from app.services.timeline_service import build_timeline
    from app.models.refund import Refund
    from test_returns import _mk
    db, b, u, o, i, p = _mk()
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="rx", amount=50.0, currency="INR", status="COMPLETED"))
    o.cancelled_at = datetime.now(timezone.utc); o.cancel_reason = "customer request"; db.commit()
    kinds = [n["kind"] for n in build_timeline(db, b.id, o.id)]
    assert "REFUND" in kinds and "CANCELLED" in kinds


def test_timeline_payment_pending_and_scoped_audit():
    from app.services.timeline_service import build_timeline
    from app.services.audit_service import log_audit
    from test_returns import _mk
    db, b, u, o, i, p = _mk()
    o.financial_status = "PENDING"; db.commit()
    log_audit(db, b.id, u.id, "order", "some-other-id", "NOTE", None, None); db.commit()
    tl = build_timeline(db, b.id, o.id)
    kinds = [n["kind"] for n in tl]
    assert "PAYMENT_PENDING" in kinds
    assert not any(n["kind"] == "AUDIT" and n["detail"] == "some-other-id" for n in tl)
