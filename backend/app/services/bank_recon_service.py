"""Bank reconciliation matching engine (#35): L1-L4 priority, Decimal money, UTC dates.

Levels:
  L1 exact bank reference (UTR)  -> MATCHED (or MISMATCH when the linked expected amount differs)
  L2 exact settlement ID         -> MATCHED (or MISMATCH on amount difference)
  L3 exact amount + date window  -> MATCHED only when exactly one candidate qualifies
  L4 amount + description similarity -> POTENTIAL_MATCH only, never auto-match
Ambiguous candidates are never auto-matched.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

DATE_WINDOW_DAYS = 3
DESC_SIM_THRESHOLD = 0.25

_Q = Decimal("0.01")


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(_Q, rounding=ROUND_HALF_UP)


def _utc(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _norm_ref(v) -> str:
    return re.sub(r"\s+", "", str(v or "").strip().upper())


def _tokens(text: str) -> set[str]:
    return set(t for t in re.split(r"[^A-Z0-9]+", str(text or "").upper()) if len(t) > 1)


def desc_similarity(a: str, b: str) -> float:
    """Jaccard similarity over alphanumeric tokens (pure, unit-testable)."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def row_actual(fields: dict) -> Decimal:
    """Bank credit for the row: explicit credit, else net of credit-debit, else net_amount."""
    credit = _d(fields.get("credit"))
    debit = _d(fields.get("debit"))
    if credit != 0 or debit != 0:
        return credit - debit
    return _d(fields.get("net_amount") or fields.get("gross_amount"))


def _candidates(db, business_id: str) -> list[dict]:
    """Expected settlements: shipment financials first, then ledger-derived per order."""
    from app.models.sla import ShipmentFinancial
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.financial_transaction import FinancialTransaction

    cands: list[dict] = []
    covered_orders: set[str] = set()
    try:
        orders = db.query(Order).filter_by(business_id=business_id).all()
    except Exception:
        orders = []
    order_names = {str(o.id): (getattr(o, "shopify_order_name", "") or "") for o in orders}
    for fin in db.query(ShipmentFinancial).filter_by(business_id=business_id).all():
        exp = _d(fin.net_settlement)
        if exp == 0:
            continue
        refs = {_norm_ref(fin.settlement_reference)} - {""}
        cands.append({
            "order_id": fin.order_id, "payment_id": None, "shipment_id": fin.shipment_id,
            "expected": exp, "refs": refs, "date": _utc(fin.settlement_date),
            "settlement_reference": fin.settlement_reference,
            "label": f"settlement {fin.settlement_reference or ''} "
                     f"order {order_names.get(str(fin.order_id), '')} bank credit",
        })
        covered_orders.add(str(fin.order_id))
    pay_by_order: dict[str, list] = {}
    for p in db.query(Payment).filter_by(business_id=business_id).all():
        pay_by_order.setdefault(str(p.order_id), []).append(p)
    fee_by_order: dict[str, Decimal] = {}
    for t in db.query(FinancialTransaction).filter_by(
            business_id=business_id, transaction_type="PAYMENT_GATEWAY_FEE").all():
        if t.order_id:
            fee_by_order[str(t.order_id)] = fee_by_order.get(str(t.order_id), Decimal("0")) + _d(t.amount)
    for o in orders:
        if str(o.id) in covered_orders:
            continue
        pays = pay_by_order.get(str(o.id), [])
        if not pays:
            continue
        exp = sum((_d(p.amount) for p in pays), Decimal("0")) - fee_by_order.get(str(o.id), Decimal("0"))
        if exp == 0:
            continue
        refs = {_norm_ref(p.transaction_id) for p in pays} - {""}
        cands.append({
            "order_id": o.id, "payment_id": pays[0].id if len(pays) == 1 else None,
            "shipment_id": None, "expected": exp, "refs": refs,
            "date": None, "settlement_reference": None,
            "label": f"order {getattr(o, 'shopify_order_name', '')} payment "
                     f"{' '.join(_norm_ref(p.transaction_id) for p in pays)}",
        })
    return cands


def _check_amount(actual: Decimal, expected: Decimal, base: dict) -> dict:
    out = dict(base)
    out["expected"] = expected
    out["actual"] = actual
    out["difference"] = actual - expected
    if actual == expected:
        out["status"] = "MATCHED"
    else:
        out["status"] = "MISMATCH"
    return out


def match_bank_row(db, business_id: str, fields: dict) -> dict:
    """Pure matching decision for one normalized bank row. Never auto-matches ambiguous rows."""
    actual = row_actual(fields)
    row_date = _utc(fields.get("transaction_date") or fields.get("value_date"))
    bank_ref = _norm_ref(fields.get("reference_number"))
    ext_ref = _norm_ref(fields.get("external_reference"))
    cands = _candidates(db, business_id)

    # L1: exact bank reference (UTR).
    if bank_ref:
        for c in cands:
            if bank_ref in c["refs"]:
                return _check_amount(actual, c["expected"], {
                    "level": "L1", "order_id": c["order_id"], "payment_id": c["payment_id"],
                    "shipment_id": c["shipment_id"],
                    "settlement_reference": c["settlement_reference"] or fields.get("reference_number"),
                })
    # L2: exact settlement ID.
    if ext_ref:
        for c in cands:
            if ext_ref in c["refs"]:
                return _check_amount(actual, c["expected"], {
                    "level": "L2", "order_id": c["order_id"], "payment_id": c["payment_id"],
                    "shipment_id": c["shipment_id"],
                    "settlement_reference": c["settlement_reference"] or fields.get("external_reference"),
                })
    dated = [c for c in cands if c["expected"] == actual]
    # L3: exact amount + date window, unambiguous only. The date window is mandatory:
    # without a row date there is no L3 decision (amount-alone must never hard-match).
    if row_date is not None:
        in_window = [c for c in dated
                     if c["date"] is not None and abs((c["date"] - row_date).days) <= DATE_WINDOW_DAYS]
        if len(in_window) == 1:
            c = in_window[0]
            return _check_amount(actual, c["expected"], {
                "level": "L3", "order_id": c["order_id"], "payment_id": c["payment_id"],
                "shipment_id": c["shipment_id"], "settlement_reference": c["settlement_reference"],
            })
        if len(in_window) > 1:
            return {"status": "POTENTIAL_MATCH", "level": "L3", "order_id": None,
                    "payment_id": None, "shipment_id": None, "settlement_reference": None,
                    "expected": None, "actual": actual, "difference": None}
    # No row date: fall through to L4/UNMATCHED — never MATCHED on amount alone.
    # L4: amount + description similarity -> POTENTIAL_MATCH only, never auto-match.
    desc = fields.get("description") or ""
    if desc and dated:
        scored = sorted(((desc_similarity(desc, c["label"]), c) for c in dated),
                        key=lambda t: t[0], reverse=True)
        if scored[0][0] >= DESC_SIM_THRESHOLD:
            return {"status": "POTENTIAL_MATCH", "level": "L4", "order_id": None,
                    "payment_id": None, "shipment_id": None, "settlement_reference": None,
                    "expected": None, "actual": actual, "difference": None}
    return {"status": "UNMATCHED", "level": None, "order_id": None, "payment_id": None,
            "shipment_id": None, "settlement_reference": None,
            "expected": None, "actual": actual, "difference": None}


def apply_bank_match(row, result: dict) -> dict:
    """Write an L1-L4 decision onto a StatementRow (Decimal money, signed difference)."""
    row.reconciliation_status = result["status"]
    row.match_level = result.get("level")
    row.matched_order_id = result.get("order_id")
    row.matched_payment_id = result.get("payment_id")
    row.matched_shipment_id = result.get("shipment_id")
    if result.get("expected") is not None:
        row.expected_amount = result["expected"]
    row.difference = result["difference"] if result.get("difference") is not None else Decimal("0.00")
    return {
        "status": result["status"], "level": result.get("level"),
        "expected": str(result["expected"]) if result.get("expected") is not None else None,
        "actual": str(result.get("actual")),
        "difference": str(result["difference"]) if result.get("difference") is not None else None,
    }


def summarize(rows: list) -> dict:
    """Dashboard aggregates per #36: expected, actual, difference, status counts."""
    expected = sum((_d(r.expected_amount) for r in rows
                    if r.reconciliation_status in ("MATCHED", "PARTIAL_MATCH", "MISMATCH")),
                   Decimal("0"))
    actual = sum((_d(r.credit) - _d(r.debit)
                  if (_d(r.credit) != 0 or _d(r.debit) != 0) else _d(r.net_amount) for r in rows),
                 Decimal("0"))
    counts = {"matched": 0, "pending": 0, "mismatch": 0, "unknown": 0, "ignored": 0}
    for r in rows:
        s = r.reconciliation_status
        if s == "MATCHED":
            counts["matched"] += 1
        elif s in ("PARTIAL_MATCH", "PARTIALLY_MATCHED", "POTENTIAL_MATCH"):
            counts["pending"] += 1
        elif s == "MISMATCH":
            counts["mismatch"] += 1
        elif s == "IGNORED":
            counts["ignored"] += 1
        elif s not in ("DUPLICATE", "PENDING"):
            counts["unknown"] += 1
    return {
        "expected_settlement": format(expected, ".2f"),
        "actual_bank_credit": format(actual, ".2f"),
        "difference": format(actual - expected, ".2f"),
        **counts,
        "total": len(rows),
    }
