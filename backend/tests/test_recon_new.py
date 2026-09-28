# backend/tests/test_recon_new.py
from test_returns import _mk


def _mk_ship(db, b, u, o, p, **kw):
    from app.models.shipment import Shipment
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id, carrier_code="DTDC",
                 awb_number=kw.get("awb", "D700"), tracking_status=kw.get("status", "IN_TRANSIT"))
    for k in ("last_checkpoint_at", "rto_at", "shipped_at", "delivered_at"):
        if k in kw:
            setattr(s, k, kw[k])
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def test_r009_dispatched_without_shipment():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    codes = {x["code"]: x["severity"] for x in reconcile_order(db, o.id)["issues"]}
    assert codes.get("DISPATCHED_WITHOUT_SHIPMENT") == "HIGH"


def test_r014_cod_not_settled():
    from datetime import datetime, timezone
    from app.models.payment import Payment
    from app.models.shipment import Shipment
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    db.add(Payment(business_id=b.id, order_id=o.id, amount=300.0, payment_status="PAID", method="COD"))
    db.commit()
    s = _mk_ship(db, b, u, o, p, status="DELIVERED")
    s.delivered_at = datetime.now(timezone.utc)
    db.commit()
    codes = {x["code"]: x["severity"] for x in reconcile_order(db, o.id)["issues"]}
    assert codes.get("DELIVERED_COD_NOT_SETTLED") == "HIGH"


def test_r021_returned_no_scan():
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    _mk_ship(db, b, u, o, p, status="RETURNED")
    codes = {x["code"]: x["severity"] for x in reconcile_order(db, o.id)["issues"]}
    assert codes.get("COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED") == "HIGH"


def test_r022_sla_breach():
    from datetime import datetime, timedelta, timezone
    from app.services.reconciliation_service import reconcile_order
    db, b, u, o, i, p = _mk()
    _mk_ship(db, b, u, o, p, status="RTO_IN_TRANSIT",
             rto_at=datetime.now(timezone.utc) - timedelta(days=50))
    codes = {x["code"]: x["severity"] for x in reconcile_order(db, o.id)["issues"]}
    assert codes.get("SLA_BREACHED") == "CRITICAL"
