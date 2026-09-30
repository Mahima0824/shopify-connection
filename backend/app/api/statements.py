from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/statements", tags=["statements"])


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "error": {"code": code, "message": message}})


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

    def num(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    return {"id": r.id, "row_number": r.row_number, "external_reference": r.external_reference,
            "awb_number": r.awb_number, "order_reference": r.order_reference,
            "transaction_date": iso(r.transaction_date), "gross_amount": num(r.gross_amount),
            "fee_amount": num(r.fee_amount), "net_amount": num(r.net_amount),
            "transaction_type": r.transaction_type, "status": r.status,
            "reconciliation_status": r.reconciliation_status,
            "matched_order_id": r.matched_order_id, "matched_shipment_id": r.matched_shipment_id,
            "bank_account_id": getattr(r, "bank_account_id", None),
            "description": getattr(r, "description", None),
            "reference_number": getattr(r, "reference_number", None),
            "debit": num(getattr(r, "debit", 0)), "credit": num(getattr(r, "credit", 0)),
            "balance": num(getattr(r, "balance", 0)),
            "value_date": iso(getattr(r, "value_date", None)),
            "match_level": getattr(r, "match_level", None),
            "matched_payment_id": getattr(r, "matched_payment_id", None),
            "expected_amount": num(getattr(r, "expected_amount", 0)),
            "difference": num(getattr(r, "difference", 0))}


class BankAccountIn(BaseModel):
    name: str
    bank_name: str = ""
    account_number_masked: str = ""
    ifsc: str | None = None
    currency: str = "INR"


def _bank_dict(a) -> dict:
    return {"id": a.id, "name": a.name, "bank_name": a.bank_name,
            "account_number_masked": a.account_number_masked, "ifsc": a.ifsc,
            "currency": a.currency, "is_active": a.is_active}


@router.post("/bank-accounts")
def create_bank_account(body: BankAccountIn, db: Session = Depends(get_db),
                        u: dict = Depends(get_current_user)):
    from app.models.bank_account import BankAccount
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        return _err(403, "FORBIDDEN", "Accountant role required")
    if not (body.name or "").strip():
        return _err(400, "BAD_REQUEST", "Account name is required")
    a = BankAccount(business_id=u.get("business_id"), name=body.name.strip(),
                    bank_name=(body.bank_name or "").strip(),
                    account_number_masked=(body.account_number_masked or "").strip(),
                    ifsc=(body.ifsc or "").strip() or None,
                    currency=(body.currency or "INR").strip() or "INR")
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"success": True, "data": _bank_dict(a)}


@router.get("/bank-accounts")
def list_bank_accounts(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.bank_account import BankAccount
    rows = db.query(BankAccount).filter_by(business_id=u.get("business_id")).order_by(
        BankAccount.created_at.desc()).all()
    return {"success": True, "data": {"items": [_bank_dict(r) for r in rows]}}


@router.post("/upload")
def upload(statement_type: str = "COURIER_SETTLEMENT", provider: str = "",
           period_start: str | None = None, period_end: str | None = None,
           type: str | None = None, bank_account_id: str | None = None,
           column_map: str | None = None,
           file: UploadFile = File(...),
           db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.models.statement import StatementUpload, StatementRow
    from app.models.bank_account import BankAccount
    from app.services.statement_service import (file_sha, parse_statement, map_columns,
                                                row_to_fields, import_identity, TYPES,
                                                BANK_COLUMNS)
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    stype = ((type or statement_type) or "").upper()
    if stype not in TYPES:
        raise HTTPException(400, "INVALID_STATEMENT: unknown statement type.")
    bank = None
    if stype == "BANK_STATEMENT" and bank_account_id:
        bank = db.query(BankAccount).filter_by(id=bank_account_id,
                                               business_id=u.get("business_id")).first()
        if bank is None:
            raise HTTPException(400, "INVALID_BANK_ACCOUNT: unknown bank account.")
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
    if column_map:  # explicit Date/Description/Reference/Debit/Credit/Balance mapping (#34)
        import json as _json
        try:
            override = _json.loads(column_map)
        except ValueError:
            raise HTTPException(400, "INVALID_COLUMN_MAP: must be a JSON object.")
        normed = {" ".join((h or "").strip().lower().split()): h for h in headers}
        for field, header in (override or {}).items():
            if field not in BANK_COLUMNS and field not in (
                    "external_reference", "order_reference", "awb_number",
                    "transaction_date", "value_date"):
                raise HTTPException(400, f"INVALID_COLUMN_MAP: unknown field '{field}'.")
            key = " ".join(str(header or "").strip().lower().split())
            if key not in normed:
                raise HTTPException(400, f"INVALID_COLUMN_MAP: header '{header}' not in file.")
            mapping[field] = normed[key]

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
    seen: set[str] = set()
    persisted = duplicates = 0
    for ix, raw in enumerate(raw_rows, start=2):
        f = row_to_fields(raw, mapping)
        identity = import_identity(u.get("business_id"), stype,
                                   bank_account_id if stype == "BANK_STATEMENT" else None, f)
        if identity in seen or db.query(StatementRow).filter_by(import_identity=identity).first():
            duplicates += 1  # idempotent skip per #71: never persist the same event twice
            continue
        seen.add(identity)
        db.add(StatementRow(statement_upload_id=up.id, row_number=ix, raw_data=dict(raw),
                            reconciliation_status="PENDING", bank_account_id=bank.id if bank else None,
                            import_batch_id=up.id, import_identity=identity,
                            **{k: v for k, v in f.items()}))
        persisted += 1
    db.commit()
    db.refresh(up)
    out = dict(_udict(up))
    out["persisted_rows"] = persisted
    out["duplicates"] = duplicates
    return {"success": True, "data": out}


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
    no_ref = [r for r in rows
              if not r.awb_number and not r.external_reference
              and not r.order_reference and not r.reference_number]
    no_amount = [r for r in rows
                 if not float(r.credit or 0) and not float(r.debit or 0)
                 and not float(r.net_amount or 0) and not float(r.gross_amount or 0)]
    no_date = [r for r in rows if r.transaction_date is None and r.value_date is None]
    warnings = []
    if no_ref:
        warnings.append({"reason": "rows without any reference can only match via L3/L4",
                         "count": len(no_ref),
                         "sample_rows": [r.row_number for r in no_ref[:5]]})
    return {"success": True, "data": {"rows": len(rows), "valid": valid, "duplicates": 0,
                                      "warnings": warnings,
                                      "errors": len(no_amount) + len(no_date),
                                      "error_sample": "rows without amount and date cannot match",
                                      "no_amount_rows": [r.row_number for r in no_amount[:5]],
                                      "no_date_rows": [r.row_number for r in no_date[:5]]}}


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
    counts = {"matched": 0, "partially": 0, "unmatched": 0, "duplicate": 0,
              "mismatch": 0, "potential_match": 0, "ignored": 0}
    use_bank_engine = up.statement_type == "BANK_STATEMENT"
    for r in db.query(StatementRow).filter_by(statement_upload_id=up.id).all():
        if r.reconciliation_status == "DUPLICATE":
            counts["duplicate"] += 1
            continue
        if r.reconciliation_status in ("MATCHED", "PARTIALLY_MATCHED", "PARTIAL_MATCH",
                                       "MISMATCH", "POTENTIAL_MATCH", "IGNORED"):
            counts[{"MATCHED": "matched", "PARTIALLY_MATCHED": "partially",
                    "PARTIAL_MATCH": "partially", "MISMATCH": "mismatch",
                    "POTENTIAL_MATCH": "potential_match", "IGNORED": "ignored"}[
                        r.reconciliation_status]] += 1
            continue  # idempotent re-process: settled rows are never re-matched
        if use_bank_engine:
            from app.services.bank_recon_service import match_bank_row, apply_bank_match
            fields = {"reference_number": r.reference_number,
                      "external_reference": r.external_reference,
                      "description": r.description, "transaction_date": r.transaction_date,
                      "value_date": r.value_date, "credit": r.credit, "debit": r.debit,
                      "net_amount": r.net_amount, "gross_amount": r.gross_amount}
            apply_bank_match(r, match_bank_row(db, u.get("business_id"), fields))
            counts[{"MATCHED": "matched", "PARTIAL_MATCH": "partially",
                    "MISMATCH": "mismatch", "POTENTIAL_MATCH": "potential_match",
                    "IGNORED": "ignored"}.get(r.reconciliation_status, "unmatched")] += 1
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
    out.setdefault("matched", sum(v for k, v in counts.items()
                                  if k in ("MATCHED", "PARTIALLY_MATCHED", "PARTIAL_MATCH")))
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
    r.match_level = "MANUAL"
    r.matched_order_id = s.order_id
    r.matched_shipment_id = s.id
    log_audit(db, u.get("business_id"), u.get("user_id"), "statement_row", r.id, "MANUAL_MATCH",
              {"status": "UNMATCHED"}, {"status": "MATCHED", "shipment_id": s.id, "reason": body.reason})
    db.commit()
    return {"success": True, "data": {"id": r.id, "reconciliation_status": "MATCHED"}}
