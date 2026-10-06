"""Orders routes (thin): envelope responses only."""

from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.schemas.india_post import OrderCreateManual
from app.services.india_post_export import build_workbook
from app.services.order_service import create_manual_order, list_orders

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

    So: no tracking number, or no provider id, means ShipSagar does not have it
    yet and the shipment is awaiting. SS-STUB-* is a local placeholder written
    when credentials are absent - it is not a provider reference, even though it
    does start with "SS-".

    "awaiting" means "no tracking number yet" and nothing more. It does NOT mean
    the shipment can be pushed: carrier_code="MANUAL" also lands here, because
    that shipment has a tracking number but was never sent anywhere, and
    register_tracking refuses MANUAL as a courier (NON_COURIER_CODES), so pushing
    it would always 400. The frontend must gate the Add Shipment action on
    carrier_code, not on push_state. A fifth value such as "manual" was
    considered and rejected: it would push a carrier-code detail into the state
    machine, and carrier_code is already on the payload for exactly this decision.

    An awaiting shipment carries a placeholder AWB rather than an empty one -
    shipments is UNIQUE(business_id, carrier_code, awb_number), so an empty AWB
    capped a tenant at one awaiting shipment. is_awaiting_awb covers the
    placeholder and the empty string, so this test is unchanged in meaning.
    """
    from app.services import shipment_service
    awb = (getattr(s, "awb_number", "") or "").strip()
    if not awb or shipment_service.is_awaiting_awb(awb):
        return "awaiting"
    tracking_id = (getattr(s, "shipsagar_tracking_id", "") or "").strip()
    if not tracking_id or tracking_id.startswith("SS-STUB-"):
        return "awaiting"
    if s.id in refused:
        return "rejected"
    return "pushed"


def _shipment_dict(s, refused) -> dict:
    from app.services import shipment_service

    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    awb = (getattr(s, "awb_number", "") or "").strip()
    return {
        "id": s.id,
        # None, not "": the field is nullable downstream and an empty string
        # would read as a tracking number that happens to be blank. The awaiting
        # placeholder is not a tracking number either, so it is masked the same
        # way - the Orders page shows Add Shipment instead of a link.
        "awb_number": None if shipment_service.is_awaiting_awb(awb) else awb,
        "carrier_code": getattr(s, "carrier_code", None),
        "tracking_status": getattr(s, "tracking_status", None),
        "current_location": getattr(s, "current_location", None),
        "last_checkpoint_at": iso(getattr(s, "last_checkpoint_at", None)),
        "shipped_at": iso(getattr(s, "shipped_at", None)),
        "push_state": _push_state(s, refused),
    }


def _shipment_map(db, business_id, order_ids) -> dict:
    """order_id -> serialized shipment, for one page of orders.

    At most four queries regardless of page size, all scoped to business_id,
    because _to_dict has no session and a per-row probe inside it would be an
    N+1 that is invisible in the response body: one for the page's shipments,
    and up to three for the refusal trace (the rejected audit rows, plus the two
    resolution arms). The trace queries are skipped entirely when no shipment on
    the page reached ShipSagar, so the common page costs two. The counts are
    pinned by test_orders_list_shipment_query_count_is_flat.
    """
    from app.models.shipment import Shipment
    ids = [oid for oid in order_ids if oid]
    if not ids:
        return {}
    rows = (db.query(Shipment)
            .filter(Shipment.business_id == business_id,
                    Shipment.order_id.in_(ids))
            # POST /shipments/push refuses a second shipment for an order, but
            # create_shipment and book do not, so an order can genuinely carry
            # several. Newest wins: it is the one in play. id breaks ties,
            # because created_at is a second-resolution server default and rows
            # created in the same request would otherwise be ordered by whatever
            # the database happened to return.
            .order_by(Shipment.created_at.desc(), Shipment.id.desc())
            .all())
    by_order: dict = {}
    for s in rows:
        # First writer wins, which is the newest shipment now that the query is
        # ordered; a plain setdefault here is only deterministic because of it.
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
        "receiver_name": o.receiver_name,
        "receiver_city": o.receiver_city,
        "receiver_pincode": o.receiver_pincode,
        "receiver_mobile": o.receiver_mobile,
        "cod_mode": o.cod_mode,
        "cod_value": num(o.cod_value),
        "weight_grams": num(o.weight_grams),
        "barcode_no": o.barcode_no,
        "shipment": shipment,
    }


@router.post("")
def post_order(
    payload: dict,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    try:
        data = OrderCreateManual(**payload)
    except ValidationError as e:
        raise HTTPException(422, str(e))
    o = create_manual_order(db, _user.get("business_id"), data)
    return {"success": True, "data": _to_dict(o)}


@router.get("")
def get_orders(
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    business_id: str | None = None,
    cod_mode: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    city: str | None = None,
    pincode: str | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    items, total = list_orders(
        db,
        _user.get("business_id"),
        search,
        status,
        page,
        page_size,
        cod_mode=cod_mode,
        date_from=date_from,
        date_to=date_to,
        city=city,
        pincode=pincode,
    )
    bid = _user.get("business_id")
    # Built here, in one pass, rather than inside _to_dict: the serializer has
    # no session and a per-order lookup inside it would be an N+1 across a page
    # of up to 100 rows.
    #
    # The token's business_id, never the `business_id` query parameter this
    # route also declares — so this lookup fails closed regardless of what the
    # caller sends. Worth knowing: that query parameter is not a pre-existing bug
    # I left in place. At HEAD, list_orders below is handed the query parameter
    # directly, so a caller can pass another tenant's id and read that tenant's
    # orders; this shipment lookup is scoped correctly and would simply attach no
    # shipment to the foreign rows. Fixing the list_orders call is out of scope
    # here (it belongs to the India Post new-order work that also edits this
    # route), so it is flagged rather than changed.
    shipments = _shipment_map(db, bid, [o.id for o in items])
    return {
        "success": True,
        "data": {
            "items": [_to_dict(o, shipments.get(o.id)) for o in items],
            "total": total,
            "page": max(int(page or 1), 1),
        },
    }


@router.get("/export/india-post.xlsx")
def export_india_post_bulk(
    search: str | None = None,
    status: str | None = None,
    cod_mode: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    city: str | None = None,
    pincode: str | None = None,
    business_id: str | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    import io

    all_items: list = []
    page = 1
    page_size = 100
    while True:
        items, total = list_orders(
            db,
            _user.get("business_id"),
            search,
            status,
            page,
            page_size,
            cod_mode=cod_mode,
            date_from=date_from,
            date_to=date_to,
            city=city,
            pincode=pincode,
        )
        all_items.extend(items)
        if len(items) < page_size or len(all_items) >= total:
            break
        page += 1
    wb = build_workbook(all_items)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    now_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"india-post_{now_str}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/{order_id}/export/india-post.xlsx")
def export_india_post_single(
    order_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    import io
    from app.models.order import Order

    o = db.query(Order).filter_by(id=order_id, business_id=_user.get("business_id")).first()
    if o is None:
        raise HTTPException(404, "Order not found")
    wb = build_workbook([o])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    now_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    order_name = (o.shopify_order_name or o.internal_order_number or order_id).replace(" ", "_").replace("#", "")
    filename = f"india-post_{order_name}_{now_str}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


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
