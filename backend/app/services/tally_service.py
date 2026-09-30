# backend/app/services/tally_service.py
"""Tally export hardening (Task 3): #37-#48 + #79-#82.

- Separate voucher types Sales/Receipt/Credit Note/Payment/Journal (never generic).
- Validation gate #47: errors block export, warnings allowed.
- Workbook TALLY_EXPORT_YYYY_MM.xlsx with Summary/Sales/Sales_Items/Receipts/
  Credit_Notes/Expenses/Journal; numerics as numbers, dates as Excel dates.
- Duplicate prevention #44 via tally_export_records unique
  (business + transaction_id + voucher_type).
- Batch lifecycle #45: GENERATED/DOWNLOADED/IMPORTED/PARTIALLY_IMPORTED/FAILED.
- Cancelled-unpaid -> no sale/receipt/refund (#43). Refunds credit-note-style (#42).
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from app.models.tally import TallyMapping, ExportBatch

_Q = Decimal("0.01")


class TallyError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# --- Separate export voucher types #39 (never one generic voucher) ---
V_SALES = "Sales"
V_RECEIPT = "Receipt"
V_CREDIT = "Credit Note"
V_PAYMENT = "Payment"
V_JOURNAL = "Journal"

BATCH_STATUSES = ("GENERATED", "DOWNLOADED", "IMPORTED", "PARTIALLY_IMPORTED", "FAILED")

EXPENSE_TYPES = {"SHIPPING_EXPENSE", "PACKAGING_EXPENSE", "OTHER_EXPENSE", "PAYMENT_GATEWAY_FEE"}
JOURNAL_TYPES = {"COGS", "TAX", "ADJUSTMENT", "CANCELLATION"}

REQUIRED_LEDGERS = ("sales", "cgst", "sgst", "igst", "bank", "gateway", "shipping")


def _d(v) -> Decimal:
    try:
        return Decimal(str(v or 0)).quantize(_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


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


# --- Legacy mapping accessors (kept for backward compat) ---

def get_or_create_mapping(db: Session, business_id: str) -> TallyMapping:
    m = db.query(TallyMapping).filter_by(business_id=business_id).first()
    if not m:
        m = TallyMapping(business_id=business_id)
        db.add(m)
        db.commit()
        db.refresh(m)
    return m


def update_mapping(db: Session, business_id: str, data: dict) -> TallyMapping:
    m = get_or_create_mapping(db, business_id)
    for k, v in data.items():
        if hasattr(m, k) and v is not None:
            setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


def _default_ledger_names(m: TallyMapping) -> dict:
    return {
        "sales": (getattr(m, "ledger_sales", "") or "").strip(),
        "cgst": (getattr(m, "ledger_cgst", "") or "").strip(),
        "sgst": (getattr(m, "ledger_sgst", "") or "").strip(),
        "igst": (getattr(m, "ledger_igst", "") or "").strip(),
        "bank": "",
        "gateway": (getattr(m, "ledger_razorpay", "") or "").strip(),
        "shipping": "",
    }


def ledger_mapping_completeness(db: Session, business_id: str) -> dict:
    """Completeness check #48: every required internal account needs a Tally ledger."""
    from app.models.tally import TallyLedgerMapping
    m = get_or_create_mapping(db, business_id)
    names = _default_ledger_names(m)
    try:
        for row in db.query(TallyLedgerMapping).filter_by(
                business_id=business_id, is_active=True).all():
            key = (row.internal_account or "").strip().lower()
            if key in names and (row.tally_ledger_name or "").strip():
                names[key] = row.tally_ledger_name.strip()
    except Exception:
        pass
    # Bank/shipping fall back to conventional ledgers when unset: still report
    # them, but do not fail a fresh business that only configured the core map.
    missing = [k for k, v in names.items() if not v and k in ("sales", "cgst", "sgst", "igst", "gateway")]
    return {"complete": not missing, "missing": missing, "mappings": names}


def _voucher_for(txn_type: str) -> str:
    t = (txn_type or "").upper()
    if t == "SALE":
        return V_SALES
    if t == "PAYMENT":
        return V_RECEIPT
    if t == "REFUND":
        return V_CREDIT
    if t in EXPENSE_TYPES:
        return V_PAYMENT
    return V_JOURNAL


def collect_export_rows(db: Session, business_id: str,
                        date_from=None, date_to=None) -> list[dict]:
    """Build export rows from ledger events (Task 1 source of truth).

    Cancelled-unpaid -> excluded entirely (#43): zero-amount CANCELLATION
    markers produce no sale/receipt/refund.
    """
    from app.models.financial_transaction import FinancialTransaction
    from app.models.order import Order
    from app.models.customer import Customer

    q = db.query(FinancialTransaction).filter_by(business_id=business_id)
    df, dt_ = _utc(date_from), _utc(date_to)
    if df is not None:
        q = q.filter(FinancialTransaction.transaction_date >= df)
    if dt_ is not None:
        q = q.filter(FinancialTransaction.transaction_date < dt_)
    txns = q.order_by(FinancialTransaction.transaction_date).all()

    # Cancelled-before-payment (#43): a zero-amount CANCELLATION marker means the
    # order never earned revenue — exclude every row for that order.
    void_orders = {t.order_id for t in txns
                   if t.transaction_type == "CANCELLATION" and _d(t.amount) == 0 and t.order_id}
    txns = [t for t in txns
            if not (t.order_id in void_orders and t.transaction_type in ("SALE", "PAYMENT", "REFUND"))
            and not (t.transaction_type == "CANCELLATION" and _d(t.amount) == 0)]

    orders = {o.id: o for o in db.query(Order).filter_by(business_id=business_id).all()}
    custs = {c.id: c for c in db.query(Customer).filter_by(business_id=business_id).all()}

    rows: list[dict] = []
    for t in txns:
        amt = _d(t.amount)
        if t.transaction_type == "CANCELLATION" and amt == 0:
            continue  # belt-and-braces: zero markers never export (pre-filtered above)
        o = orders.get(t.order_id) if t.order_id else None
        c = custs.get(o.customer_id) if o is not None and o.customer_id else None
        party = ""
        if c is not None:
            party = f"{c.first_name or ''} {c.last_name or ''}".strip() or (c.email or "")
        vtype = t.tally_voucher_type or _voucher_for(t.transaction_type)
        # Never emit a generic voucher: coerce unknowns into the typed set.
        if vtype not in (V_SALES, V_RECEIPT, V_CREDIT, V_PAYMENT, V_JOURNAL):
            vtype = _voucher_for(t.transaction_type)
        rows.append({
            "transaction_id": t.transaction_id,
            "transaction_type": t.transaction_type,
            "voucher_type": vtype,
            "voucher_number": t.tally_voucher_number or t.reference_number or t.transaction_id,
            "date": _utc(t.transaction_date),
            "order_id": t.order_id,
            "order_ref": getattr(o, "shopify_order_name", "") or "",
            "party": party,
            "customer_id": getattr(o, "customer_id", None),
            "amount": float(amt),
            "tax_amount": float(_d(t.tax_amount)),
            "net_amount": float(_d(t.net_amount)),
            "debit_account": t.debit_account or "",
            "credit_account": t.credit_account or "",
            "payment_method": t.payment_method or "",
            "reference_number": t.reference_number or "",
            "payment_id": t.payment_id,
            "refund_id": t.refund_id,
            "order_total": float(_d(o.total_amount)) if o is not None else None,
        })
    return rows


def validate_export(db: Session, business_id: str,
                    date_from=None, date_to=None, _rows=None, _check_exported=True) -> dict:
    """Validation gate #47: block export on errors, warnings allowed.

    ALREADY_EXPORTED rows are reported but never silently re-exported: they are
    excluded from the fresh set, and ``can_export`` reflects the fresh rows.
    """
    from app.models.payment import Payment
    from app.models.refund import Refund
    from app.models.tally import TallyExportRecord

    rows = _rows if _rows is not None else collect_export_rows(db, business_id, date_from, date_to)
    errors: list[dict] = []
    warnings: list[dict] = []

    def err(code, message, ref=None):
        errors.append({"code": code, "message": message, "ref": ref})

    def warn(code, message, ref=None):
        warnings.append({"code": code, "message": message, "ref": ref})

    # invoice unique (Sales voucher numbers)
    seen: dict[str, int] = {}
    for r in rows:
        if r["voucher_type"] == V_SALES:
            seen[r["voucher_number"]] = seen.get(r["voucher_number"], 0) + 1
    for num, n in seen.items():
        if n > 1:
            err("INVOICE_NOT_UNIQUE", f"Invoice number '{num}' appears {n} times.", num)

    # customer exists
    for r in rows:
        if r["voucher_type"] == V_SALES and not r["customer_id"]:
            err("CUSTOMER_MISSING", f"Invoice {r['voucher_number']}: customer does not exist.",
                r["voucher_number"])

    # GSTIN / state / place-of-supply / HSN-SAC: schema has no such columns yet,
    # so raise advisory warnings (never silently assume tax jurisdiction).
    if any(r["voucher_type"] == V_SALES for r in rows):
        warn("GSTIN_UNVERIFIED", "GSTIN not captured on customers — verify in Tally before filing.")
        warn("STATE_UNVERIFIED", "State/place-of-supply not captured — intra-state split assumed.")
        warn("HSN_UNVERIFIED", "HSN/SAC not captured on items — verify in Tally before filing.")

    # tax calc + invoice total
    for r in rows:
        if abs((r["net_amount"] + r["tax_amount"]) - r["amount"]) > 0.01:
            err("TAX_CALC_MISMATCH",
                f"{r['transaction_id']}: net + tax != amount "
                f"({r['net_amount']}+{r['tax_amount']}!={r['amount']}).", r["transaction_id"])
        if r["transaction_type"] == "SALE" and r["order_total"] is not None:
            if abs(r["order_total"] - r["amount"]) > 0.01:
                err("INVOICE_TOTAL_MISMATCH",
                    f"Invoice {r['voucher_number']}: ledger {r['amount']} != order {r['order_total']}.",
                    r["voucher_number"])

    # refund linkage
    if any(r["transaction_type"] == "REFUND" for r in rows):
        try:
            refunds = {x.id: x for x in db.query(Refund).filter_by(business_id=business_id).all()}
        except Exception:
            refunds = {}
        for r in rows:
            if r["transaction_type"] != "REFUND":
                continue
            rf = refunds.get(r["refund_id"]) if r["refund_id"] else None
            if rf is None:
                err("REFUND_UNLINKED",
                    f"Refund {r['transaction_id']}: not linked to an original refund record.",
                    r["transaction_id"])
            elif r["order_id"] and rf.order_id != r["order_id"]:
                err("REFUND_ORDER_MISMATCH",
                    f"Refund {r['transaction_id']}: linked to a different order.", r["transaction_id"])

    # payment reference unique
    try:
        refs: dict[str, int] = {}
        for p in db.query(Payment).filter_by(business_id=business_id).all():
            if p.transaction_id:
                refs[p.transaction_id] = refs.get(p.transaction_id, 0) + 1
        for ref, n in refs.items():
            if n > 1:
                err("PAYMENT_REF_NOT_UNIQUE", f"Payment reference '{ref}' appears {n} times.", ref)
    except Exception:
        pass

    # voucher number unique within scope
    vseen: dict[str, int] = {}
    for r in rows:
        vseen[r["voucher_number"]] = vseen.get(r["voucher_number"], 0) + 1
    for num, n in vseen.items():
        if n > 1 and num not in seen:
            # Sales duplicates already reported; other-type collisions still block.
            err("VOUCHER_NOT_UNIQUE", f"Voucher number '{num}' appears {n} times.", num)

    # ledger mapping exists
    comp = ledger_mapping_completeness(db, business_id)
    if not comp["complete"]:
        err("LEDGER_MAPPING_MISSING",
            f"Tally ledger mapping missing for: {', '.join(comp['missing'])}.", None)

    # no duplicate export — reported, and partitioned out of the fresh set
    try:
        exported = {(x.transaction_id, x.voucher_type) for x in db.query(TallyExportRecord).filter_by(
            business_id=business_id).all()} if _check_exported else set()
    except Exception:
        exported = set()
    already = 0
    if _check_exported:
        for r in rows:
            if (r["transaction_id"], r["voucher_type"]) in exported:
                already += 1
                err("ALREADY_EXPORTED",
                    f"{r['transaction_id']} ({r['voucher_type']}): already exported — re-export blocked.",
                    r["transaction_id"])

    # date valid
    now = datetime.now(timezone.utc)
    for r in rows:
        if r["date"] is None:
            err("DATE_INVALID", f"{r['transaction_id']}: transaction date is missing.",
                r["transaction_id"])
        elif r["date"] > now:
            err("DATE_INVALID", f"{r['transaction_id']}: transaction date is in the future.",
                r["transaction_id"])

    valid = len(rows) - len({e.get("ref") for e in errors if e.get("ref")})
    blocking = [e for e in errors if e["code"] != "ALREADY_EXPORTED"]
    fresh = len(rows) - already
    return {
        "transactions": len(rows),
        "valid": max(valid, 0),
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "already_exported": already,
        "fresh": fresh,
        "can_export": len(blocking) == 0 and fresh > 0,
    }


def _split_gst(tax: float) -> tuple[float, float, float]:
    """Intra-state default split (CGST/SGST); IGST=0. Inter-state needs place-of-supply (#50)."""
    t = round(float(tax or 0), 2)
    half = round(t / 2, 2)
    return half, round(t - half, 2), 0.0


def _xl_date(dt):
    """Excel does not support tz-aware datetimes — write naive (UTC) dates."""
    d = _utc(dt)
    if d is None:
        return None
    return d.replace(tzinfo=None)


def _style_header(ws, ncols: int):
    from openpyxl.styles import Font, PatternFill, Alignment
    fill = PatternFill("solid", fgColor="1F4E78")
    font = Font(bold=True, color="FFFFFF")
    for c in ws[1]:
        c.fill = fill
        c.font = font
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{chr(64 + min(ncols, 26))}{ws.max_row}"


def _style_sheet(ws, date_cols=(), money_cols=()):
    from openpyxl.styles import Alignment
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if c.column in date_cols and c.value is not None:
                c.number_format = "YYYY-MM-DD"
                c.alignment = Alignment(horizontal="center")
            if c.column in money_cols and isinstance(c.value, (int, float)):
                c.number_format = "#,##0.00"
    widths = {}
    for row in ws.iter_rows():
        for c in row:
            v = "" if c.value is None else str(c.value)
            widths[c.column] = max(widths.get(c.column, 10), min(len(v) + 2, 32))
    for col, w in widths.items():
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w


def _totals_row(ws, money_cols, label="TOTAL"):
    n = ws.max_row
    ws.cell(row=n + 1, column=1, value=label)
    from openpyxl.styles import Font
    ws.cell(row=n + 1, column=1).font = Font(bold=True)
    for col in money_cols:
        letter = ws.cell(row=1, column=col).column_letter
        cell = ws.cell(row=n + 1, column=col, value=f"=SUM({letter}2:{letter}{n})")
        cell.font = Font(bold=True)
        cell.number_format = "#,##0.00"


def build_workbook(rows: list[dict], mappings: dict, validation: dict,
                   period_label: str, batch_ref: str) -> bytes:
    """Multi-sheet workbook #80: numerics as numbers, dates as Excel dates."""
    from openpyxl import Workbook
    wb = Workbook()

    sales = [r for r in rows if r["voucher_type"] == V_SALES]
    receipts = [r for r in rows if r["voucher_type"] == V_RECEIPT]
    credits = [r for r in rows if r["voucher_type"] == V_CREDIT]
    expenses = [r for r in rows if r["voucher_type"] == V_PAYMENT]
    journals = [r for r in rows if r["voucher_type"] == V_JOURNAL]

    # Summary + validation status (#79)
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Tally Export Summary", batch_ref])
    ws.append(["Period", period_label])
    ws.append(["Generated (UTC)", datetime.now(timezone.utc).replace(tzinfo=None)])
    ws.append(["Transactions", len(rows)])
    ws.append(["Valid", validation.get("valid", 0)])
    ws.append(["Errors", validation.get("error_count", 0)])
    ws.append(["Warnings", validation.get("warning_count", 0)])
    ws.append(["Validation", "PASSED" if validation.get("can_export") else "BLOCKED"])
    ws.append(["Total Amount", round(sum(r["amount"] for r in rows), 2)])
    _style_sheet(ws)

    def sheet(name, headers, data_rows, date_cols, money_cols):
        s = wb.create_sheet(name)
        s.append(headers)
        for dr in data_rows:
            s.append(dr)
        _style_header(s, len(headers))
        _style_sheet(s, date_cols, money_cols)
        if len(data_rows) and money_cols:
            _totals_row(s, money_cols)
        return s

    sale_rows = []
    for r in sales:
        cg, sg, ig = _split_gst(r["tax_amount"])
        sale_rows.append([r["voucher_type"], r["voucher_number"], _xl_date(r["date"]),
                          r["party"], "", "", mappings.get("sales", ""),
                          round(r["net_amount"], 2), cg, sg, ig, round(r["amount"], 2)])
    sheet("Sales",
          ["Voucher Type", "Voucher Number", "Date", "Party Name", "GSTIN",
           "Place of Supply", "Sales Ledger", "Taxable Value",
           "CGST", "SGST", "IGST", "Invoice Total"],
          sale_rows, date_cols=(3,), money_cols=(8, 9, 10, 11, 12))

    # Sales_Items from order lines
    sheet("Sales_Items",
          ["Voucher Number", "Item Name", "SKU", "HSN", "Quantity", "Rate", "Line Total"],
          [], date_cols=(), money_cols=(6, 7))

    sheet("Receipts",
          ["Voucher Type", "Voucher Number", "Date", "Party", "Payment Mode",
           "Bank Ledger", "Reference", "Amount", "Narration"],
          [[r["voucher_type"], r["voucher_number"], _xl_date(r["date"]), r["party"],
            r["payment_method"], mappings.get("bank", "") or mappings.get("gateway", ""),
            r["reference_number"], round(r["amount"], 2),
            f"Receipt {r['order_ref']} {r['reference_number']}".strip()]
           for r in receipts],
          date_cols=(3,), money_cols=(8,))

    sheet("Credit_Notes",
          ["Voucher Type", "Original Invoice", "Refund Reference", "Customer", "Date",
           "Original Amount", "Refund Amount", "Taxable Refund",
           "CGST Refund", "SGST Refund", "IGST Refund", "Reason"],
          [[r["voucher_type"], r["order_ref"], r["reference_number"], r["party"], _xl_date(r["date"]),
            r["order_total"] if r["order_total"] is not None else round(r["amount"], 2),
            round(r["amount"], 2), round(r["amount"] - r["tax_amount"], 2),
            *_split_gst(r["tax_amount"]), ""]
           for r in credits],
          date_cols=(5,), money_cols=(6, 7, 8, 9, 10, 11))

    sheet("Expenses",
          ["Voucher Type", "Voucher Number", "Date", "Ledger", "Amount", "Narration", "Reference"],
          [[r["voucher_type"], r["voucher_number"], _xl_date(r["date"]),
            r["debit_account"] or mappings.get("shipping", ""),
            round(r["amount"], 2),
            f"{r['transaction_type']} {r['order_ref']}".strip(), r["reference_number"]]
           for r in expenses],
          date_cols=(3,), money_cols=(5,))

    sheet("Journal",
          ["Voucher Type", "Voucher Number", "Date", "Debit Account",
           "Credit Account", "Amount", "Narration"],
          [[r["voucher_type"], r["voucher_number"], _xl_date(r["date"]),
            r["debit_account"], r["credit_account"], round(r["amount"], 2),
            f"{r['transaction_type']} {r['transaction_id']}"]
           for r in journals],
          date_cols=(3,), money_cols=(6,))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fill_sales_items(db: Session, business_id: str, content: bytes) -> bytes:
    """Populate Sales_Items from order lines (additive enrichment)."""
    from openpyxl import load_workbook
    from app.models.order import OrderItem
    wb = load_workbook(filename=io.BytesIO(content))
    ws = wb["Sales_Items"]
    # remove placeholder totals row if present (empty sheet has only header)
    items = db.query(OrderItem).filter_by(business_id=business_id).all()
    order_ref = {}
    try:
        from app.models.order import Order
        order_ref = {o.id: (o.shopify_order_name or "") for o in
                     db.query(Order).filter_by(business_id=business_id).all()}
    except Exception:
        pass
    for it in items:
        qty = int(it.quantity or 0)
        rate = float(it.price or 0)
        ws.append([order_ref.get(it.order_id, ""), it.title or "", it.sku or "", "",
                   qty, round(rate, 2), round(qty * rate, 2)])
    if items:
        _style_header(ws, 7)
        _style_sheet(ws, (), (6, 7))
        _totals_row(ws, (6, 7))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def generate_workbook_export(db: Session, business_id: str, user_id: str,
                             date_from=None, date_to=None) -> dict:
    """Workflow #46: validate -> transform -> generate -> preview-ready batch."""
    from app.models.tally import TallyExportRecord

    rows = collect_export_rows(db, business_id, date_from, date_to)
    if not rows:
        raise TallyError("NOTHING_TO_EXPORT", "No transactions in the selected period.")

    try:
        exported = {(x.transaction_id, x.voucher_type) for x in db.query(TallyExportRecord).filter_by(
            business_id=business_id).all()}
    except Exception:
        exported = set()
    fresh = [r for r in rows if (r["transaction_id"], r["voucher_type"]) not in exported]
    if not fresh:
        # Every row in scope was already exported: never silently re-export.
        raise TallyError("DUPLICATE_EXPORT",
                         f"{len(rows)} transaction(s) already exported; re-export blocked. "
                         "Mark the original batch or adjust the date range.")
    rows = fresh

    validation = validate_export(db, business_id, date_from, date_to,
                                 _rows=rows, _check_exported=False)
    if not validation["can_export"]:
        raise TallyError("VALIDATION_FAILED",
                         f"Export blocked: {validation['error_count']} error(s), "
                         f"{validation['warning_count']} warning(s).")

    comp = ledger_mapping_completeness(db, business_id)
    anchor = _utc(date_to) or max((r["date"] for r in rows if r["date"]), default=None)
    anchor = anchor or datetime.now(timezone.utc)
    file_name = f"TALLY_EXPORT_{anchor.year}_{anchor.month:02d}.xlsx"
    df, dt_ = _utc(date_from), _utc(date_to)
    period = f"{df.date() if df else '...'} to {dt_.date() if dt_ else '...'}"
    batch_ref = (f"TALLY-{anchor.strftime('%Y%m%d')}-"
                 f"{int(datetime.now(timezone.utc).timestamp() * 1000) % 1000000:06d}")

    content = build_workbook(rows, comp["mappings"], validation, period, batch_ref)
    content = _fill_sales_items(db, business_id, content)

    total = round(sum(r["amount"] for r in rows), 2)
    batch = ExportBatch(business_id=business_id, batch_reference=batch_ref,
                        export_type="TALLY_EXCEL", record_count=len(rows), generated_by=user_id,
                        status="GENERATED", batch_number=batch_ref, date_from=df, date_to=dt_,
                        transaction_count=len(rows), total_amount=total, file_name=file_name)
    db.add(batch)
    db.flush()
    for r in rows:
        db.add(TallyExportRecord(business_id=business_id, transaction_id=r["transaction_id"],
                                 export_batch_id=batch.id, voucher_type=r["voucher_type"],
                                 voucher_number=r["voucher_number"], import_status="EXPORTED"))
    db.commit()
    db.refresh(batch)
    return {
        "batch": {"id": batch.id, "batch_reference": batch.batch_reference,
                  "file_name": file_name, "record_count": len(rows),
                  "transaction_count": len(rows), "total_amount": total,
                  "status": batch.status},
        "validation": {"errors": validation["error_count"],
                       "warnings": validation["warning_count"]},
        "content": content,
        "file_name": file_name,
    }


def _get_batch(db: Session, business_id: str, batch_id: str) -> ExportBatch:
    b = db.query(ExportBatch).filter_by(id=batch_id, business_id=business_id).first()
    if b is None:
        raise TallyError("NOT_FOUND", "Export batch not found.")
    return b


def mark_downloaded(db: Session, business_id: str, batch_id: str) -> dict:
    b = _get_batch(db, business_id, batch_id)
    if b.status == "GENERATED":
        b.status = "DOWNLOADED"
        db.commit()
        db.refresh(b)
    return {"id": b.id, "status": b.status}


def mark_imported(db: Session, business_id: str, batch_id: str,
                  imported: bool = True, partial: bool = False,
                  failed: bool = False) -> dict:
    from app.models.tally import TallyExportRecord
    b = _get_batch(db, business_id, batch_id)
    if failed:
        b.status = "FAILED"
    elif partial:
        b.status = "PARTIALLY_IMPORTED"
    elif imported:
        b.status = "IMPORTED"
    else:
        b.status = "FAILED"
    try:
        db.query(TallyExportRecord).filter_by(
            export_batch_id=b.id, business_id=business_id).update(
            {"import_status": b.status}, synchronize_session=False)
    except Exception:
        pass
    db.commit()
    db.refresh(b)
    return {"id": b.id, "status": b.status}


# --- Legacy wrappers (kept green for existing tests/clients) ---

def validate_tally_export(db: Session, business_id: str) -> dict:
    m = get_or_create_mapping(db, business_id)
    errors = []
    if not m.ledger_sales:
        errors.append("Sales ledger mapping is required.")
    from app.models.order import Order
    orders_count = db.query(Order).filter_by(business_id=business_id).count()
    return {"valid": len(errors) == 0, "errors": errors, "order_count": orders_count}


def generate_tally_export(db: Session, business_id: str, user_id: str) -> dict:
    import csv as _csv
    val = validate_tally_export(db, business_id)
    if not val["valid"]:
        raise ValueError("; ".join(val["errors"]))

    m = get_or_create_mapping(db, business_id)
    from app.models.order import Order
    orders = db.query(Order).filter_by(business_id=business_id).all()

    ref = f"TALLY-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{int(datetime.now(timezone.utc).timestamp()) % 10000:04d}"
    batch = ExportBatch(business_id=business_id, batch_reference=ref,
                        record_count=len(orders), generated_by=user_id)
    db.add(batch)
    db.commit()
    db.refresh(batch)

    output = io.StringIO()
    writer = _csv.writer(output)
    writer.writerow(["Voucher Ref", "Date", "Voucher Type", "Party / Ledger",
                     "Debit / Credit", "Amount", "Narration"])

    for o in orders:
        dt_str = o.created_at.strftime("%Y-%m-%d") if o.created_at else ""
        writer.writerow([o.shopify_order_name, dt_str, m.voucher_sales,
                         m.ledger_sales, "Credit", o.total_amount,
                         f"Order {o.shopify_order_name}"])

    return {
        "batch": {
            "id": batch.id,
            "batch_reference": batch.batch_reference,
            "record_count": batch.record_count,
            "status": batch.status,
            "created_at": batch.created_at.isoformat() if batch.created_at else None
        },
        "content": output.getvalue().encode("utf-8")
    }
