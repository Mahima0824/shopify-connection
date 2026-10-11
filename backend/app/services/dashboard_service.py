# backend/app/services/dashboard_service.py
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.return_record import ReturnRecord
from app.models.refund import Refund


def get_dashboard_summary(
    db: Session,
    business_id: str | None,
    start: datetime | None = None,
    end: datetime | None = None,
    cod_mode: str | None = None,
    **filters
) -> dict:
    """Dashboard KPIs and metrics filtered by business, date period, and payment mode."""
    orders_q = db.query(Order)
    if business_id:
        orders_q = orders_q.filter(Order.business_id == business_id)

    # Date period filtering
    if start is not None:
        orders_q = orders_q.filter(Order.order_date >= start)
    if end is not None:
        orders_q = orders_q.filter(Order.order_date <= end)

    # Payment mode filtering (PREPAID vs COD)
    if cod_mode and cod_mode.strip().upper() not in ("ALL", ""):
        orders_q = orders_q.filter(Order.cod_mode == cod_mode.strip().upper())

    orders_total = orders_q.count()
    paid_orders = orders_q.filter(Order.financial_status == "PAID").count()
    cancelled_orders = orders_q.filter(Order.cancelled_at.isnot(None)).count()

    # Pending orders: orders awaiting processing / fulfillment
    pending_orders = orders_q.filter(
        Order.operational_status.in_(["NEW", "PENDING"])
    ).count()

    # In RTO orders: orders marked as RTO / return in transit
    in_rto = orders_q.filter(Order.operational_status == "RTO").count()

    gross_sales = round(
        float(orders_q.with_entities(func.coalesce(func.sum(Order.total_amount), 0.0)).scalar() or 0.0),
        2
    )
    total_tax = round(
        float(orders_q.with_entities(func.coalesce(func.sum(Order.tax_amount), 0.0)).scalar() or 0.0),
        2
    )

    # Total shipping charges:
    # Uses recorded shipping_amount if > 0, otherwise accounts for the ₹50 COD courier handling charge
    shipping_expr = case(
        (Order.shipping_amount > 0, Order.shipping_amount),
        (Order.cod_mode == "COD", 50.0),
        else_=0.0,
    )
    total_shipping = round(
        float(orders_q.with_entities(func.coalesce(func.sum(shipping_expr), 0.0)).scalar() or 0.0),
        2
    )

    # Total refunds
    refunds_q = db.query(Refund)
    if business_id:
        refunds_q = refunds_q.filter(Refund.business_id == business_id)
    if start is not None:
        refunds_q = refunds_q.filter(Refund.created_at >= start)
    if end is not None:
        refunds_q = refunds_q.filter(Refund.created_at <= end)
    total_refunds = round(
        float(refunds_q.with_entities(func.coalesce(func.sum(Refund.amount), 0.0)).scalar() or 0.0),
        2
    )
    net_revenue = round(gross_sales - total_refunds, 2)

    try:
        from app.models.reconciliation import Reconciliation
        rec_q = db.query(Reconciliation)
        if business_id:
            rec_q = rec_q.filter(Reconciliation.business_id == business_id)
        open_exceptions = rec_q.filter(Reconciliation.resolved == False).count()
        reconciled_rate = max(0.0, min(100.0, round(((orders_total - open_exceptions) / max(orders_total, 1)) * 100, 1)))
    except Exception:
        reconciled_rate = 100.0

    return {
        "kpis": {
            "orders_total": orders_total,
            "paid_orders": paid_orders,
            "pending_orders": pending_orders,
            "in_rto": in_rto,
            "cancelled_orders": cancelled_orders,
            "total_shipping": total_shipping,
            "reconciled_rate": reconciled_rate,
        },
        "financials": {
            "gross_sales": gross_sales,
            "total_tax": total_tax,
            "total_shipping": total_shipping,
            "total_refunds": total_refunds,
            "net_revenue": net_revenue,
        },
    }
