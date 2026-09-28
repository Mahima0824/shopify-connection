from datetime import datetime, timezone
from calendar import monthrange


def month_window(month: str) -> tuple[datetime, datetime]:
    y, m = [int(x) for x in month.split("-")]
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    if m == 12:
        end = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(y, m + 1, 1, tzinfo=timezone.utc)
    return start, end


def monthly_report(db, business_id: str, month: str) -> dict:
    from sqlalchemy import func
    from app.models.order import Order, OrderItem
    from app.models.shipment import Shipment
    from app.models.return_record import ReturnRecord
    from app.models.refund import Refund
    from app.models.reconciliation import Reconciliation
    from app.models.sla import ShipmentFinancial
    from app.services.cost_service import get_cost
    start, end = month_window(month)
    from datetime import timedelta
    month_end = end - timedelta(microseconds=1)
    orders = db.query(Order).filter_by(business_id=business_id).filter(
        Order.order_date >= start, Order.order_date < end).all()
    oids = [o.id for o in orders]

    def cnt(pred):
        return sum(1 for o in orders if pred(o))

    ops = [(o.operational_status or "") for o in orders]
    order_sec = {"total": len(orders),
                 "paid": cnt(lambda o: (o.financial_status or "") == "PAID"),
                 "unpaid": cnt(lambda o: (o.financial_status or "") not in ("PAID", "REFUNDED")),
                 "cancelled": cnt(lambda o: o.cancelled_at is not None),
                 "dispatched": sum(ops.count(s) for s in ("DISPATCHED",)),
                 "delivered": 0, "returned": 0, "rto": 0}
    ships = db.query(Shipment).filter_by(business_id=business_id).all()
    in_month = [s for s in ships if s.order_id in set(oids)]
    courier_sec: dict[str, dict] = {}
    for s in in_month:
        c = courier_sec.setdefault(s.carrier_code, {"shipments": 0, "delivered": 0, "in_transit": 0,
                                                    "rto": 0, "returned": 0, "breached": 0})
        c["shipments"] += 1
        st = s.tracking_status or ""
        if st == "DELIVERED":
            c["delivered"] += 1
            order_sec["delivered"] += 1
        elif st in ("IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY"):
            c["in_transit"] += 1
        if "RTO" in st:
            c["rto"] += 1
            order_sec["rto"] += 1
        if st in ("RETURNED", "RETURN_AT_HUB"):
            c["returned"] += 1
            order_sec["returned"] += 1
    from app.services.sla_service import sla_status, shipment_clock
    now = datetime.now(timezone.utc)
    for s in in_month:
        if sla_status(shipment_clock(db, s), now)["status"] == "BREACHED":
            courier_sec[s.carrier_code]["breached"] += 1

    rets = db.query(ReturnRecord).filter_by(business_id=business_id).filter(
        ReturnRecord.order_id.in_(oids)).all() if oids else []
    return_sec = {"total": len(rets),
                  "customer": sum(1 for r in rets if r.return_type == "CUSTOMER_RETURN"),
                  "rto": sum(1 for r in rets if r.return_type == "RTO"),
                  "partial": sum(1 for r in rets if r.return_type == "PARTIAL_RETURN"),
                  "refunded": 0, "pending_refund": 0}
    refunded_oids = {r.order_id for r in db.query(Refund).filter_by(business_id=business_id).all()}
    for r in rets:
        if r.order_id in refunded_oids:
            return_sec["refunded"] += 1
        else:
            return_sec["pending_refund"] += 1

    gross = round(sum(float(o.total_amount or 0) for o in orders), 2)
    discounts = round(sum(float(o.discount_amount or 0) for o in orders), 2)
    refunds = round(sum(float(r.amount or 0) for r in db.query(Refund).filter_by(business_id=business_id).all()
                        if r.order_id in set(oids)), 2)
    fin_rows = db.query(ShipmentFinancial).filter_by(business_id=business_id).all()
    fin_rows = [f for f in fin_rows if f.order_id in set(oids)]
    expected = round(sum(float(f.expected_cod_amount or 0) for f in fin_rows), 2)
    collected = round(sum(float(f.collected_amount or 0) for f in fin_rows), 2)
    settled = round(sum(float(f.settled_amount or 0) for f in fin_rows), 2)
    fees = round(sum(float(f.fee_amount or 0) for f in fin_rows), 2)
    money_sec = {"gross": gross, "discounts": discounts, "refunds": refunds,
                 "expected": expected, "collected": collected, "settled": settled,
                 "pending": round(expected - settled, 2), "fees": fees,
                 "net": round(settled - fees, 2)}

    exc = db.query(Reconciliation).filter_by(business_id=business_id, resolved=False).all()
    exc = [r for r in exc if r.order_id in set(oids)]
    by_sev: dict[str, int] = {}
    for r in exc:
        by_sev[r.severity] = by_sev.get(r.severity, 0) + 1
    exc_sec = {"open": len(exc), "by_severity": by_sev}

    cost_lines = []
    cost_total = 0.0
    order_count = max(len(orders), 1)
    item_qty = sum(i.quantity for i in db.query(OrderItem).filter(OrderItem.order_id.in_(oids)).all()) if oids else 0
    multipliers = {"COGS_DEFAULT": item_qty, "SHIPPING": len(orders), "GATEWAY_FEE": len(orders),
                   "PACKAGING": len(orders), "RETURN_COST": return_sec["total"],
                   "RTO_COST": return_sec["rto"], "OTHER": 1}
    sources = set()
    for key in ("COGS_DEFAULT", "SHIPPING", "GATEWAY_FEE", "PACKAGING", "RETURN_COST", "RTO_COST", "OTHER"):
        amt, src = get_cost(db, business_id, key, month_end)
        line = round(amt * multipliers[key], 2)
        cost_total += line
        sources.add(src)
        cost_lines.append({"key": key, "per_unit": amt, "units": multipliers[key], "total": line, "source": src})
    net_revenue = round(gross - discounts - refunds, 2)
    profit = round(net_revenue - cost_total, 2)
    label = "OPERATING PROFIT" if sources == {"ACTUAL_STATEMENT"} else "ESTIMATED OPERATING PROFIT"
    pnl = {"gross": gross, "discounts": discounts, "refunds": refunds, "net_revenue": net_revenue,
           "costs": cost_lines, "cost_total": round(cost_total, 2), "profit": profit, "label": label}

    return {"month": month, "generated_at": now.isoformat(), "orders": order_sec, "courier": courier_sec,
            "returns": return_sec, "money": money_sec, "exceptions": exc_sec,
            "costs": {"lines": cost_lines, "total": round(cost_total, 2)}, "profitability": pnl,
            "order_rows": [{"name": o.shopify_order_name, "financial": o.financial_status,
                            "operational": o.operational_status, "total": float(o.total_amount or 0)} for o in orders],
            "shipment_rows": [{"awb": s.awb_number, "carrier": s.carrier_code, "status": s.tracking_status,
                               "location": s.current_location or ""} for s in ships]}
