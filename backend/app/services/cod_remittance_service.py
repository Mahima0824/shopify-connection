import io
import re
import csv
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

from app.models.order import Order, OrderItem
from app.models.shipment import Shipment
from app.models.payment import Payment
from app.models.sla import ShipmentFinancial
from app.models.statement import StatementUpload, StatementRow
from app.services.statement_service import parse_statement, map_columns, row_to_fields
from app.services.audit_service import log_audit
from app.services import finance_posting as fp

_Q = Decimal("0.01")


def _d(v) -> Decimal:
    try:
        return Decimal(str(v or 0)).quantize(_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def get_cod_remittance_summary(db: Session, business_id: str) -> Dict[str, Any]:
    """Calculate aggregate COD remittance performance KPIs, pending COD, and discrepancies."""
    cod_orders = db.query(Order).filter(
        Order.business_id == business_id,
        or_(Order.cod_mode == "COD", Order.payment_status == "PENDING")
    ).all()

    total_expected_cod = Decimal("0.00")
    total_remitted_cod = Decimal("0.00")
    total_pending_cod = Decimal("0.00")
    total_discrepancy_amount = Decimal("0.00")

    matched_count = 0
    short_remittance_count = 0
    pending_count = 0
    rto_zero_count = 0

    order_ids = [o.id for o in cod_orders]
    financials = {
        f.order_id: f
        for f in db.query(ShipmentFinancial).filter(
            ShipmentFinancial.business_id == business_id,
            ShipmentFinancial.order_id.in_(order_ids)
        ).all()
    } if order_ids else {}

    for o in cod_orders:
        expected = _d(o.cod_value or o.total_amount or 0)
        total_expected_cod += expected

        fin = financials.get(o.id)
        if fin and (fin.status in ["SETTLED", "PARTIALLY_SETTLED"] or fin.net_settlement > 0):
            remitted = _d(fin.net_settlement or fin.collected_amount or 0)
            total_remitted_cod += remitted
            diff = expected - remitted
            
            if abs(diff) <= Decimal("1.00"):
                matched_count += 1
            elif diff > Decimal("1.00"):
                short_remittance_count += 1
                total_discrepancy_amount += diff
            else:
                matched_count += 1
        elif o.operational_status in ["RTO", "RTO_DELIVERED"]:
            rto_zero_count += 1
        elif o.payment_status in ["PAID", "COD_REMITTED"]:
            remitted = expected
            total_remitted_cod += remitted
            matched_count += 1
        else:
            pending_count += 1
            total_pending_cod += expected

    rto_rate = round((rto_zero_count / len(cod_orders) * 100), 1) if cod_orders else 0.0

    return {
        "total_cod_orders": len(cod_orders),
        "total_expected_cod": float(total_expected_cod),
        "total_remitted_cod": float(total_remitted_cod),
        "total_pending_cod": float(total_pending_cod),
        "total_discrepancy_amount": float(total_discrepancy_amount),
        "matched_orders_count": matched_count,
        "short_remittance_count": short_remittance_count,
        "pending_count": pending_count,
        "rto_zero_count": rto_zero_count,
        "rto_rate": rto_rate
    }


def list_cod_remittance_orders(
    db: Session,
    business_id: str,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    carrier_filter: Optional[str] = None,
    page: int = 1,
    page_size: int = 20
) -> Dict[str, Any]:
    """Retrieve filterable COD orders with remittance matching status, fee deductions & difference."""
    qy = db.query(Order).filter(
        Order.business_id == business_id,
        or_(Order.cod_mode == "COD", Order.payment_status == "PENDING", Order.financial_status == "PAID")
    )

    if q and isinstance(q, str) and q.strip():
        search_pattern = f"%{q.strip()}%"
        qy = qy.filter(
            or_(
                Order.shopify_order_name.ilike(search_pattern),
                Order.internal_order_number.ilike(search_pattern),
                Order.receiver_name.ilike(search_pattern),
                Order.receiver_mobile.ilike(search_pattern)
            )
        )

    total = qy.count()
    orders = qy.order_by(Order.order_date.desc()).offset((page - 1) * page_size).limit(page_size).all()

    order_ids = [o.id for o in orders]

    shipments = {
        s.order_id: s
        for s in db.query(Shipment).filter(Shipment.business_id == business_id, Shipment.order_id.in_(order_ids)).all()
    } if order_ids else {}

    financials = {
        f.order_id: f
        for f in db.query(ShipmentFinancial).filter(ShipmentFinancial.business_id == business_id, ShipmentFinancial.order_id.in_(order_ids)).all()
    } if order_ids else {}

    items_out = []
    for o in orders:
        expected = float(o.cod_value or o.total_amount or 0)
        s = shipments.get(o.id)
        fin = financials.get(o.id)

        remitted_amount = 0.0
        fee_amount = 0.0
        utr_number = None
        settlement_date = None
        remittance_status = "PENDING_REMITTANCE"
        difference = expected

        if fin and (fin.net_settlement > 0 or fin.collected_amount > 0 or fin.status == "SETTLED"):
            remitted_amount = float(fin.net_settlement or fin.collected_amount or 0)
            fee_amount = float(fin.fee_amount or 0)
            utr_number = fin.settlement_reference
            settlement_date = fin.settlement_date.isoformat() if fin.settlement_date else None
            difference = round(expected - remitted_amount, 2)

            if abs(difference) <= 1.0:
                remittance_status = "MATCHED"
            elif difference > 1.0:
                remittance_status = "SHORT_REMITTANCE"
            else:
                remittance_status = "OVER_REMITTANCE"
        elif o.operational_status in ["RTO", "RTO_DELIVERED"]:
            remittance_status = "RTO_ZERO_REMITTANCE"
            remitted_amount = 0.0
            difference = expected
        elif o.payment_status in ["PAID", "COD_REMITTED"]:
            remittance_status = "MATCHED"
            remitted_amount = expected
            difference = 0.0

        if status_filter and status_filter.strip() and remittance_status != status_filter.strip():
            continue

        if carrier_filter and carrier_filter.strip() and s and s.carrier_code != carrier_filter.strip():
            continue

        items_out.append({
            "order_id": o.id,
            "order_name": o.shopify_order_name or o.internal_order_number,
            "internal_order_number": o.internal_order_number,
            "customer_name": o.receiver_name or "N/A",
            "customer_mobile": o.receiver_mobile or "N/A",
            "city": o.receiver_city or "N/A",
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "carrier_code": s.carrier_code if s else "DELHIVERY",
            "awb_number": s.awb_number if s else "N/A",
            "expected_cod": expected,
            "remitted_amount": remitted_amount,
            "fee_amount": fee_amount,
            "difference": difference,
            "utr_number": utr_number or "N/A",
            "settlement_date": settlement_date,
            "remittance_status": remittance_status,
            "operational_status": o.operational_status
        })

    return {
        "items": items_out,
        "total": total,
        "page": page,
        "page_size": page_size
    }


def process_cod_remittance_file(
    db: Session,
    business_id: str,
    user_id: str,
    content: bytes,
    filename: str
) -> Dict[str, Any]:
    """Parse courier COD remittance file (CSV/XLSX), perform 4-Level matching & auto-post accounting entries."""
    headers, raw_rows = parse_statement(content, filename)
    mapping = map_columns(headers, "COURIER_SETTLEMENT")

    matched_count = 0
    short_count = 0
    unmatched_count = 0
    total_net_remitted = Decimal("0.00")

    row_details = []

    for idx, raw in enumerate(raw_rows, start=2):
        fields = row_to_fields(raw, mapping)
        awb = (fields.get("awb_number") or "").strip()
        order_ref = (fields.get("order_reference") or "").strip()
        utr_ref = (fields.get("reference_number") or fields.get("external_reference") or "").strip()
        gross = _d(fields.get("gross_amount"))
        fee = _d(fields.get("fee_amount"))
        net = _d(fields.get("net_amount"))
        if net == 0 and gross != 0:
            net = gross - fee

        # Find matching order/shipment
        shipment = None
        order = None

        if awb:
            shipment = db.query(Shipment).filter(
                Shipment.business_id == business_id,
                Shipment.awb_number == awb
            ).first()

        if not shipment and order_ref:
            order = db.query(Order).filter(
                Order.business_id == business_id,
                or_(Order.shopify_order_name == order_ref, Order.internal_order_number == order_ref)
            ).first()
            if order:
                shipment = db.query(Shipment).filter(Shipment.order_id == order.id).first()

        if shipment and not order:
            order = db.query(Order).filter(Order.id == shipment.order_id).first()

        if not order:
            unmatched_count += 1
            row_details.append({
                "row_number": idx,
                "awb_number": awb,
                "order_reference": order_ref,
                "status": "UNMATCHED",
                "gross": float(gross),
                "fee": float(fee),
                "net": float(net),
                "message": "Order / AWB not found in database"
            })
            continue

        expected = _d(order.cod_value or order.total_amount or 0)
        diff = expected - net
        status = "MATCHED"

        if abs(expected - gross) <= Decimal("1.00") or abs(diff) <= Decimal("1.00"):
            status = "MATCHED"
            matched_count += 1
        elif expected > gross:
            status = "SHORT_REMITTANCE"
            short_count += 1
        else:
            status = "MATCHED"
            matched_count += 1

        # Update ShipmentFinancial
        fin = db.query(ShipmentFinancial).filter(ShipmentFinancial.order_id == order.id).first()
        if not fin:
            fin = ShipmentFinancial(
                business_id=business_id,
                order_id=order.id,
                shipment_id=shipment.id if shipment else order.id
            )
            db.add(fin)

        fin.collected_amount = float(gross)
        fin.settled_amount = float(gross)
        fin.fee_amount = float(fee)
        fin.net_settlement = float(net)
        fin.settlement_reference = utr_ref or f"COD-{idx}"
        fin.settlement_date = fields.get("transaction_date") or datetime.now(timezone.utc)
        fin.status = "SETTLED" if status == "MATCHED" else "PARTIALLY_SETTLED"

        # Update Order Payment status
        order.financial_status = "PAID"
        order.payment_status = "COD_REMITTED"

        total_net_remitted += net

        # Auto-post ledger for COD Remittance
        try:
            fp.record_cod_remittance_from_shipment_financial(db, business_id, fin, order=order)
        except Exception as l_err:
            pass

        row_details.append({
            "row_number": idx,
            "order_id": order.id,
            "order_name": order.shopify_order_name or order.internal_order_number,
            "awb_number": awb,
            "status": status,
            "expected": float(expected),
            "gross": float(gross),
            "fee": float(fee),
            "net": float(net),
            "utr": utr_ref
        })

    log_audit(
        db,
        business_id,
        user_id,
        "statement",
        filename,
        "COD_REMITTANCE_PROCESSED",
        {},
        {"matched": matched_count, "short": short_count, "unmatched": unmatched_count, "total_net": float(total_net_remitted)}
    )

    db.commit()

    return {
        "success": True,
        "filename": filename,
        "total_rows": len(raw_rows),
        "matched_count": matched_count,
        "short_count": short_count,
        "unmatched_count": unmatched_count,
        "total_net_remitted": float(total_net_remitted),
        "row_details": row_details
    }


def resolve_cod_discrepancy(
    db: Session,
    business_id: str,
    user_id: str,
    order_id: str,
    action: str,  # 'ACCEPT_SHORT', 'DISPUTE_COURIER', 'FORCE_MATCH'
    write_off_amount: float = 0.0,
    notes: Optional[str] = None
) -> Dict[str, Any]:
    """Resolve COD remittance shortfalls via write-off or courier dispute."""
    order = db.query(Order).filter(Order.id == order_id, Order.business_id == business_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    fin = db.query(ShipmentFinancial).filter(ShipmentFinancial.order_id == order.id).first()
    if not fin:
        fin = ShipmentFinancial(business_id=business_id, order_id=order.id, shipment_id=order.id)
        db.add(fin)

    if action == "ACCEPT_SHORT":
        order.financial_status = "PAID"
        order.payment_status = "COD_SHORT_SETTLED"
        fin.status = "SETTLED"
        msg = f"Short remittance of ₹{write_off_amount:.2f} accepted & written off."
    elif action == "DISPUTE_COURIER":
        order.payment_status = "DISPUTED_WITH_COURIER"
        fin.status = "DISPUTED"
        msg = f"Order flagged for courier claim/dispute."
    else:  # FORCE_MATCH
        order.financial_status = "PAID"
        order.payment_status = "COD_REMITTED"
        fin.status = "SETTLED"
        fin.net_settlement = float(order.total_amount or 0)
        msg = "Order COD remittance force-matched as settled."

    log_audit(
        db,
        business_id,
        user_id,
        "order",
        order.id,
        "COD_DISCREPANCY_RESOLVED",
        {},
        {"action": action, "write_off_amount": write_off_amount, "notes": notes}
    )

    db.commit()

    return {
        "success": True,
        "message": msg,
        "data": {
            "order_id": order.id,
            "action": action,
            "status": order.payment_status
        }
    }
