"""Orders routes (thin): envelope responses only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.services.order_service import list_orders

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def _unresolved_refusals(db, business_id, shipment_ids) -> frozenset:
    """Shipment ids ShipSagar refused and that no later success has resolved.

    Mirrors the rejected_pushes counter in /api/v1/shipsagar/health rather than
    inventing a second definition of "rejected": a SHIPSAGAR_PUSH_REJECTED
    audit row, minus those resolved by a later SHIPSAGAR_PUSH_ACCEPTED row or by
    a DONE retry job. The audit trail is append-only, so without the resolution
    arm a shipment that was refused once and accepted on the retry would read as
    rejected forever.

    No schema change is needed: register_tracking already writes the audit row
    precisely because it persists the tracking id on a refusal too, and nothing
    else distinguishes the two cases.
    """
    from app.models.audit_log import AuditLog
    from app.models.shipment_event import ShipsagarRetryJob
    ids = list(shipment_ids)
    rejected = {row[0] for row in db.query(AuditLog.entity_id).filter(
        AuditLog.business_id == business_id,
        AuditLog.entity_type == "shipment",
        AuditLog.action == "SHIPSAGAR_PUSH_REJECTED",
        AuditLog.entity_id.in_(ids)).distinct()}
    if not rejected:
        return frozenset()
    resolved = {row[0] for row in db.query(AuditLog.entity_id).filter(
        AuditLog.business_id == business_id,
        AuditLog.entity_type == "shipment",
        AuditLog.action == "SHIPSAGAR_PUSH_ACCEPTED",
        AuditLog.entity_id.in_(rejected)).distinct()}
    resolved |= {row[0] for row in db.query(ShipsagarRetryJob.shipment_id).filter(
        ShipsagarRetryJob.business_id == business_id,
        ShipsagarRetryJob.status == "DONE",
        ShipsagarRetryJob.shipment_id.in_(rejected)).distinct()}
    return frozenset(rejected - resolved)


def _push_state(s, refused) -> str:
    """Where one shipment stands with ShipSagar.

    "rejected" is NOT "has an AWB but no SS- id". Both push paths
    (register_tracking and POST /shipments/push) persist shipsagar_tracking_id
    as SS-{awb} BEFORE reading the provider's verdict, so an accepted push and a
    refusal leave byte-identical columns; only the SHIPSAGAR_PUSH_REJECTED audit
    row separates them. Inverting the test the other way round would report every
    manually created shipment (create_shipment / book, which never contacts
    ShipSagar and leaves the column NULL) as refused.

    So: no tracking number, or no provider id, means ShipSagar has not got it
    yet and the shipment is awaiting. SS-STUB-* is a local placeholder written
    when credentials are absent - it is not a provider reference, even though it
    does start with "SS-".
    """
    awb = (getattr(s, "awb_number", "") or "").strip()
    if not awb:
        return "awaiting"
    tracking_id = (getattr(s, "shipsagar_tracking_id", "") or "").strip()
    if not tracking_id or tracking_id.startswith("SS-STUB-"):
        return "awaiting"
    if s.id in refused:
        return "rejected"
    return "pushed"


def _shipment_dict(s, refused) -> dict:
    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    awb = (getattr(s, "awb_number", "") or "").strip()
    return {
        "id": s.id,
        # None, not "": the field is nullable downstream and an empty string
        # would read as a tracking number that happens to be blank.
        "awb_number": awb or None,
        "carrier_code": getattr(s, "carrier_code", None),
        "tracking_status": getattr(s, "tracking_status", None),
        "current_location": getattr(s, "current_location", None),
        "last_checkpoint_at": iso(getattr(s, "last_checkpoint_at", None)),
        "shipped_at": iso(getattr(s, "shipped_at", None)),
        "push_state": _push_state(s, refused),
    }


def _shipment_map(db, business_id, order_ids) -> dict:
    """order_id -> serialized shipment, for one page of orders.

    Three queries regardless of page size, all scoped to business_id, because
    _to_dict has no session and a per-row probe inside it would be an N+1 that
    is invisible in the response body. The refusal trace is only fetched for
    shipments that actually reached ShipSagar.
    """
    from app.models.shipment import Shipment
    ids = [oid for oid in order_ids if oid]
    if not ids:
        return {}
    rows = (db.query(Shipment)
            .filter(Shipment.business_id == business_id,
                    Shipment.order_id.in_(ids))
            .all())
    by_order: dict = {}
    for s in rows:
        # POST /shipments/push refuses a second shipment for an order, but
        # create_shipment and book do not, so keep the first deterministically
        # rather than letting row order pick the winner.
        by_order.setdefault(s.order_id, s)
    reached = [s for s in by_order.values()
               if _push_state(s, ()) in ("pushed", "rejected")]
    refused = _unresolved_refusals(db, business_id, [s.id for s in reached]) \
        if reached else frozenset()
    return {oid: _shipment_dict(s, refused) for oid, s in by_order.items()}


def _to_dict(o, shipment=None) -> dict:
    def num(v):
        try:
            return float(v) if v is not None else 0.0
        except Exception:
            return 0.0

    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {
        "id": o.id,
        "business_id": o.business_id,
        "internal_order_number": o.internal_order_number,
        "shopify_order_id": o.shopify_order_id,
        "shopify_order_name": o.shopify_order_name,
        "customer_id": o.customer_id,
        "order_date": iso(o.order_date),
        "currency": o.currency,
        "subtotal_amount": num(o.subtotal_amount),
        "discount_amount": num(o.discount_amount),
        "shipping_amount": num(o.shipping_amount),
        "tax_amount": num(o.tax_amount),
        "total_amount": num(o.total_amount),
        "payment_status": o.payment_status,
        "financial_status": o.financial_status,
        "fulfillment_status": o.fulfillment_status,
        "operational_status": o.operational_status,
        "shopify_created_at": iso(o.shopify_created_at),
        "shopify_updated_at": iso(o.shopify_updated_at),
        "shipment": shipment,
    }


@router.get("")
def get_orders(
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    business_id: str | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    items, total = list_orders(db, business_id, search, status, page, page_size)
    bid = _user.get("business_id")
    # Built here, in one pass, rather than inside _to_dict: the serializer has
    # no session and a per-order lookup inside it would be an N+1 across a page
    # of up to 100 rows.
    shipments = _shipment_map(db, bid, [o.id for o in items])
    return {
        "success": True,
        "data": {
            "items": [_to_dict(o, shipments.get(o.id)) for o in items],
            "total": total,
            "page": max(int(page or 1), 1),
        },
    }


@router.get("/{order_id}/timeline")
def get_timeline(order_id: str, db: Session = Depends(get_db), _u: dict = Depends(get_current_user)):
    from app.services.timeline_service import build_timeline
    return {"success": True, "data": {"items": build_timeline(db, _u.get("business_id"), order_id)}}


@router.get("/{order_id}")
def get_order(
    order_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    from app.models.order import Order

    o = db.query(Order).filter_by(id=order_id).first()
    if o is None:
        raise HTTPException(404, "Order not found")
    # The shipment is resolved here too, not left at the serializer's null
    # default: this route gained a `shipment` key, and reporting null for an
    # order that does have a shipment would be a false field. One extra query on
    # a single-row fetch, so there is no N+1 to avoid.
    shipment = _shipment_map(db, _user.get("business_id"), [o.id]).get(o.id)
    return {"success": True, "data": _to_dict(o, shipment)}
