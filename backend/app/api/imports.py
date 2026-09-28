from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])


@router.post("/shopify-csv")
def import_csv(file: UploadFile = File(...), dry_run: bool = False,
               db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.csv_import_service import parse_shopify_csv, FileTooLarge
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(415, "Only .csv files are accepted.")
    try:
        payloads, issues = parse_shopify_csv(file.file.read())
    except FileTooLarge as e:
        raise HTTPException(400, str(e))
    bid = u.get("business_id")
    if dry_run:
        return {"success": True, "data": {"parsed": len(payloads), "created": 0, "updated": 0,
                                          "skipped": 0, "errors": issues, "order_ids": []}}
    from app.services.shopify_service import upsert_order
    from app.services.barcode_service import ensure_parcel_for_order
    created = updated = skipped = 0
    errors = list(issues)
    order_ids: list[str] = []
    for p in payloads:
        try:
            before = _count_orders(db, bid)
            oid = upsert_order(db, bid, p)
            after = _count_orders(db, bid)
            is_new = after > before
            try:
                ensure_parcel_for_order(db, oid)
            except Exception:
                db.rollback()
            _upsert_csv_refund(db, bid, oid, p)
            try:
                from app.services.reconciliation_service import reconcile_order
                reconcile_order(db, oid)
            except Exception:
                pass
            if is_new:
                created += 1
            else:
                updated += 1
            order_ids.append(oid)
        except Exception as e:
            db.rollback()
            skipped += 1
            errors.append({"row": None, "name": p.get("name"), "reason": f"{type(e).__name__}: {e}"[:200]})
    return {"success": True, "data": {"parsed": len(payloads), "created": created, "updated": updated,
                                      "skipped": skipped, "errors": errors, "order_ids": order_ids}}


def _count_orders(db, bid) -> int:
    from app.models.order import Order
    return db.query(Order).filter_by(business_id=bid).count()


def _upsert_csv_refund(db, bid, oid, p) -> None:
    from app.models.refund import Refund
    try:
        amt = float(str(p.get("refunded_amount") or 0).replace(",", ""))
    except ValueError:
        amt = 0.0
    if amt <= 0:
        return
    rid = f"csv:{p.get('id')}:refund"
    r = db.query(Refund).filter_by(business_id=bid, shopify_refund_id=rid).first()
    if r is None:
        db.add(Refund(business_id=bid, order_id=oid, shopify_refund_id=rid, amount=amt,
                      currency=p.get("currency", "INR"), status="COMPLETED"))
        db.commit()
    else:
        r.amount = amt
        db.commit()
