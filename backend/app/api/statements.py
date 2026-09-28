from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/statements", tags=["statements"])


def _udict(u) -> dict:
    return {"id": u.id, "statement_type": u.statement_type, "provider": u.provider,
            "status": u.status, "row_count": u.row_count,
            "original_filename": u.original_filename}


def _rdict(r) -> dict:
    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {"id": r.id, "row_number": r.row_number, "external_reference": r.external_reference,
            "awb_number": r.awb_number, "order_reference": r.order_reference,
            "transaction_date": iso(r.transaction_date), "gross_amount": float(r.gross_amount or 0),
            "fee_amount": float(r.fee_amount or 0), "net_amount": float(r.net_amount or 0),
            "transaction_type": r.transaction_type, "status": r.status,
            "reconciliation_status": r.reconciliation_status,
            "matched_order_id": r.matched_order_id, "matched_shipment_id": r.matched_shipment_id}


@router.post("/upload")
def upload(statement_type: str = "COURIER_SETTLEMENT", provider: str = "",
           period_start: str | None = None, period_end: str | None = None,
           file: UploadFile = File(...),
           db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.models.statement import StatementUpload, StatementRow
    from app.services.statement_service import file_sha, parse_statement, map_columns, row_to_fields, TYPES
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    stype = (statement_type or "").upper()
    if stype not in TYPES:
        raise HTTPException(400, "INVALID_STATEMENT: unknown statement type.")
    content = file.file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (10MB max).")
    digest = file_sha(content)
    dup = db.query(StatementUpload).filter_by(business_id=u.get("business_id"), file_hash=digest).first()
    if dup is not None:
        raise HTTPException(400, "STATEMENT_ALREADY_IMPORTED: this file was already uploaded.")
    try:
        headers, raw_rows = parse_statement(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        mapping = map_columns(headers, stype)
    except ValueError as e:
        raise HTTPException(400, str(e))

    def dt(v):
        if not v:
            return None
        try:
            return datetime.fromisoformat(v)
        except ValueError:
            return None

    up = StatementUpload(business_id=u.get("business_id"), statement_type=stype, provider=provider,
                         period_start=dt(period_start), period_end=dt(period_end),
                         original_filename=file.filename or "", file_hash=digest,
                         row_count=len(raw_rows), status="READY", uploaded_by=u.get("user_id"))
    db.add(up)
    db.flush()
    seen = set()
    for ix, raw in enumerate(raw_rows, start=2):
        f = row_to_fields(raw, mapping)
        key = (f["awb_number"], f["external_reference"], f["net_amount"], str(f["transaction_date"]))
        if key in seen:
            status = "DUPLICATE"
        else:
            status = "PENDING"
            seen.add(key)
        db.add(StatementRow(statement_upload_id=up.id, row_number=ix, raw_data=dict(raw),
                            reconciliation_status=status, **{k: v for k, v in f.items()}))
    db.commit()
    db.refresh(up)
    return {"success": True, "data": _udict(up)}


@router.get("")
def list_uploads(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.statement import StatementUpload
    rows = db.query(StatementUpload).filter_by(business_id=u.get("business_id")).order_by(
        StatementUpload.created_at.desc()).all()
    return {"success": True, "data": {"items": [_udict(r) for r in rows]}}


@router.get("/{uid}")
def get_upload(uid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.statement import StatementUpload, StatementRow
    up = db.query(StatementUpload).filter_by(id=uid, business_id=u.get("business_id")).first()
    if up is None:
        raise HTTPException(404, "Statement not found")
    n = db.query(StatementRow).filter_by(statement_upload_id=up.id).count()
    d = dict(_udict(up))
    d["persisted_rows"] = n
    return {"success": True, "data": d}


@router.post("/{uid}/dry-run")
def dry_run(uid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.statement import StatementUpload, StatementRow
    up = db.query(StatementUpload).filter_by(id=uid, business_id=u.get("business_id")).first()
    if up is None:
        raise HTTPException(404, "Statement not found")
    rows = db.query(StatementRow).filter_by(statement_upload_id=up.id).all()
    valid = sum(1 for r in rows if r.reconciliation_status == "PENDING")
    dups = sum(1 for r in rows if r.reconciliation_status == "DUPLICATE")
    no_ref = sum(1 for r in rows if not r.awb_number and not r.external_reference and not r.order_reference)
    return {"success": True, "data": {"rows": len(rows), "valid": valid, "duplicates": dups,
                                      "warnings": [{"reason": "Row has no reference"}] * 0,
                                      "errors": no_ref, "error_sample": "rows without any reference cannot match"}}


@router.post("/{uid}/process")
def process(uid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.statement import StatementUpload, StatementRow
    from app.models.shipment import Shipment
    from app.models.sla import ShipmentFinancial
    from app.services.statement_service import match_row
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    up = db.query(StatementUpload).filter_by(id=uid, business_id=u.get("business_id")).first()
    if up is None:
        raise HTTPException(404, "Statement not found")
    counts = {"matched": 0, "partially": 0, "unmatched": 0, "duplicate": 0}
    for r in db.query(StatementRow).filter_by(statement_upload_id=up.id).all():
        if r.reconciliation_status == "DUPLICATE":
            counts["duplicate"] += 1
            continue
        if r.reconciliation_status in ("MATCHED", "PARTIALLY_MATCHED"):
            counts["matched" if r.reconciliation_status == "MATCHED" else "partially"] += 1
            continue
        result, oid, sid = match_row(db, u.get("business_id"), r)
        r.reconciliation_status = result
        r.matched_order_id = oid
        r.matched_shipment_id = sid
        if result in ("MATCHED", "PARTIALLY_MATCHED") and sid:
            fin = db.query(ShipmentFinancial).filter_by(shipment_id=sid).first()
            if fin is None:
                order_of = db.query(Shipment).filter_by(id=sid).first()
                fin = ShipmentFinancial(business_id=u.get("business_id"), shipment_id=sid,
                                        order_id=oid or (order_of.order_id if order_of else ""))
                db.add(fin)
            fin.collected_amount = r.gross_amount or 0
            fin.settled_amount = r.net_amount or 0
            fin.fee_amount = r.fee_amount or 0
            fin.net_settlement = float(r.net_amount or 0)
            fin.settlement_reference = r.external_reference
            fin.settlement_date = r.transaction_date
            fin.status = "SETTLED" if result == "MATCHED" else "PARTIALLY_SETTLED"
        counts[{"MATCHED": "matched", "PARTIALLY_MATCHED": "partially"}.get(result, "unmatched")] += 1
    up.status = "COMPLETED"
    up.processed_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "data": {"counts": counts}}


@router.get("/{uid}/results")
def results(uid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.statement import StatementUpload, StatementRow
    up = db.query(StatementUpload).filter_by(id=uid, business_id=u.get("business_id")).first()
    if up is None:
        raise HTTPException(404, "Statement not found")
    rows = db.query(StatementRow).filter_by(statement_upload_id=up.id).order_by(StatementRow.row_number).all()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.reconciliation_status] = counts.get(r.reconciliation_status, 0) + 1
    out = dict(counts)
    out.setdefault("matched", sum(v for k, v in counts.items() if k in ("MATCHED", "PARTIALLY_MATCHED")))
    return {"success": True, "data": {"counts": out, "rows": [_rdict(r) for r in rows]}}


class MatchIn(BaseModel):
    shipment_id: str
    reason: str | None = None


@router.post("/rows/{rid}/match")
def manual_match(rid: str, body: MatchIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.statement import StatementRow, StatementUpload
    from app.models.shipment import Shipment
    from app.services.audit_service import log_audit
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    r = db.query(StatementRow).join(
        StatementUpload,
        StatementUpload.id == StatementRow.statement_upload_id,
    ).filter(StatementRow.id == rid).first()
    if r is None:
        raise HTTPException(404, "Row not found")
    up = db.query(StatementUpload).filter_by(id=r.statement_upload_id).first()
    if up is None or up.business_id != u.get("business_id"):
        raise HTTPException(404, "Row not found")
    s = db.query(Shipment).filter_by(id=body.shipment_id, business_id=u.get("business_id")).first()
    if s is None:
        raise HTTPException(404, "Shipment not found")
    r.reconciliation_status = "MATCHED"
    r.matched_order_id = s.order_id
    r.matched_shipment_id = s.id
    log_audit(db, u.get("business_id"), u.get("user_id"), "statement_row", r.id, "MANUAL_MATCH",
              {"status": "UNMATCHED"}, {"status": "MATCHED", "shipment_id": s.id, "reason": body.reason})
    db.commit()
    return {"success": True, "data": {"id": r.id, "reconciliation_status": "MATCHED"}}
