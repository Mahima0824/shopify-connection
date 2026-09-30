# backend/app/services/dashboard_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.scan_event import ScanEvent
from app.models.return_record import ReturnRecord
from app.models.refund import Refund
from app.models.reconciliation import Reconciliation


def get_dashboard_summary(db: Session, business_id: str,
                          start=None, end=None, **filters) -> dict:
    """Legacy overview (all-time) + ledger-wired KPIs per #28 when a period is given."""
    orders_q = db.query(Order).filter_by(business_id=business_id)
    orders_total = orders_q.count()
    paid_orders = orders_q.filter_by(financial_status="PAID").count()
    cancelled_orders = orders_q.filter(Order.cancelled_at.isnot(None)).count()

    parcels_q = db.query(Parcel).filter_by(business_id=business_id)
    packed_orders = parcels_q.filter_by(status="PACKED").count()

    dispatched_orders = db.query(ScanEvent).filter_by(business_id=business_id, event_type="DISPATCHED").count()
    returns_total = db.query(ReturnRecord).filter_by(business_id=business_id).count()
    rto_total = db.query(ReturnRecord).filter_by(business_id=business_id, return_type="RTO").count()

    open_exceptions = db.query(Reconciliation).filter_by(business_id=business_id, resolved=False).count()
    reconciled_rate = round(((orders_total - open_exceptions) / max(orders_total, 1)) * 100, 1)

    gross_sales = float(db.query(func.coalesce(func.sum(Order.total_amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_tax = float(db.query(func.coalesce(func.sum(Order.tax_amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_shipping = float(db.query(func.coalesce(func.sum(Order.shipping_amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_refunds = float(db.query(func.coalesce(func.sum(Refund.amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    net_revenue = round(gross_sales - total_refunds, 2)

    out = {
        "kpis": {
            "orders_total": orders_total,
            "paid_orders": paid_orders,
            "cancelled_orders": cancelled_orders,
            "packed_orders": packed_orders,
            "dispatched_orders": dispatched_orders,
            "returns_total": returns_total,
            "rto_total": rto_total,
            "open_exceptions": open_exceptions,
            "reconciled_rate": reconciled_rate
        },
        "financials": {
            "gross_sales": gross_sales,
            "total_tax": total_tax,
            "total_shipping": total_shipping,
            "total_refunds": total_refunds,
            "net_revenue": net_revenue
        }
    }
    if start is not None and end is not None:
        # Period KPIs per #28 come from the finance engines, not re-implemented here.
        from app.services import report_service as rs
        out["period"] = rs.dashboard_report(db, business_id, start, end, **filters)
    return out
