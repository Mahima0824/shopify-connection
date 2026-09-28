from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


class CostItem(BaseModel):
    key: str
    amount: float
    source: str = "MANUAL"
    effective_from: str
    note: str | None = None


class CostsIn(BaseModel):
    items: list[CostItem]


@router.get("/monthly")
def monthly(month: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.report_service import monthly_report, month_window
    try:
        month_window(month)
    except (ValueError, AttributeError):
        raise HTTPException(400, "month must be YYYY-MM")
    return {"success": True, "data": monthly_report(db, u.get("business_id"), month)}


@router.get("/costs")
def get_costs(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    from app.models.cost import CostRule
    from app.services.cost_service import KEYS
    now = datetime.now(timezone.utc)
    out = []
    for key in KEYS:
        r = db.query(CostRule).filter_by(business_id=u.get("business_id"), key=key).filter(
            CostRule.effective_to.is_(None)).first()
        out.append({"key": key, "amount": float(r.amount or 0) if r else 0.0,
                    "source": r.source if r else "DEFAULT"})
    return {"success": True, "data": {"items": out}}


@router.put("/costs")
def put_costs(body: CostsIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from datetime import datetime
    from app.services.cost_service import set_cost, KEYS
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    for item in body.items:
        if item.key not in KEYS:
            raise HTTPException(400, f"Unknown cost key '{item.key}'.")
        try:
            ef = datetime.fromisoformat(item.effective_from)
        except ValueError:
            raise HTTPException(400, f"Invalid effective_from for {item.key}.")
        set_cost(db, u.get("business_id"), item.key, item.amount, item.source, ef, item.note)
    db.commit()
    return {"success": True, "data": {"updated": len(body.items)}}


@router.get("/monthly/export")
def monthly_export(month: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.services.report_service import monthly_report, month_window
    try:
        month_window(month)
    except (ValueError, AttributeError):
        raise HTTPException(400, "month must be YYYY-MM")
    data = monthly_report(db, u.get("business_id"), month)
    content = _workbook(data)
    headers = {"Content-Disposition": f'attachment; filename="monthly_report_{month}.xlsx"'}
    return Response(content=content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers=headers)


def _workbook(data: dict) -> bytes:
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="1F4E5F")
    money_fmt = "#,##0.00"

    def sheet(name, headers, rows):
        ws = wb.create_sheet(name) if name != "Summary" else wb.active
        if name == "Summary":
            ws.title = "Summary"
        ws.freeze_panes = "A2"
        ws.append(headers)
        for c in ws[1]:
            c.font = hdr_font
            c.fill = hdr_fill
        ws.auto_filter.ref = ws.dimensions
        for r in rows:
            ws.append(r)
        for col in ws.columns:
            w = max((len(str(c.value or "")) for c in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(w + 2, 40)
        return ws

    p = data["profitability"]
    sheet("Summary", ["Metric", "Value"], [
        ["Month", data["month"]], ["Generated", data["generated_at"]],
        ["Orders", data["orders"]["total"]], ["Gross", data["money"]["gross"]],
        ["Net revenue", p["net_revenue"]], ["Costs", p["cost_total"]],
        [p["label"], p["profit"]]])
    sheet("Orders", ["Name", "Financial", "Operational", "Total"],
          [[r["name"], r["financial"], r["operational"], r["total"]] for r in data.get("order_rows", [])])
    sheet("Shipments", ["AWB", "Carrier", "Status", "Location"],
          [[r["awb"], r["carrier"], r["status"], r["location"]] for r in data.get("shipment_rows", [])])
    m = data["money"]
    sheet("Money", ["Metric", "Value"],
          [["Gross", m["gross"]], ["Discounts", m["discounts"]], ["Refunds", m["refunds"]],
           ["Expected", m["expected"]], ["Collected", m["collected"]], ["Settled", m["settled"]],
           ["Pending", m["pending"]], ["Fees", m["fees"]], ["Net", m["net"]]])
    sheet("Exceptions", ["Metric", "Value"],
          [["Open", data["exceptions"]["open"]]] +
          [[f"Severity {k}", v] for k, v in data["exceptions"]["by_severity"].items()])
    sheet("Profitability", ["Line", "Total", "Source"],
          [["Gross", p["gross"], ""], ["Discounts", p["discounts"], ""], ["Refunds", p["refunds"], ""],
           ["Net revenue", p["net_revenue"], ""]] +
          [[c["key"], c["total"], c["source"]] for c in data["costs"]["lines"]] +
          [[p["label"], p["profit"], ""]])
    return _finalize(wb, money_fmt)


def _finalize(wb, money_fmt: str) -> bytes:
    import io
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=2):
            for c in row:
                if isinstance(c.value, float):
                    c.number_format = money_fmt
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
