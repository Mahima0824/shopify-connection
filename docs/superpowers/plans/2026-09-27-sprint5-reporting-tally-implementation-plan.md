# Sprint 5 Dashboard, Reports, Excel Export & Tally Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the executive dashboard, operational Excel export engine, configurable Tally ledger mapping, accounting validation, and idempotent Tally export batch generator.

**Architecture:**
- `dashboard_service` aggregates order, parcel, scan, return, refund, and reconciliation metrics via SQL functions exposed by `GET /api/v1/dashboard/summary`.
- `export_service` compiles structured multi-tab operational CSV/Excel workbooks downloadable via `GET /api/v1/export/excel`.
- `tally_service` manages business-specific ledger mappings in `tally_mappings`, validates data readiness, and produces idempotent voucher batches logged in `export_batches` downloadable via `POST /api/v1/tally/export`.
- Next.js UI includes an executive Dashboard (`/`) and a Tally Settings/Export workspace (`/settings/tally`).

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, pytest 8, Next.js 14 TS, vitest.

## Global Constraints

- Every business-owned row carries `business_id` UUID, resolved via JWT auth token (`get_current_user`).
- Envelope pattern (`{"success": true, "data": ...}`) for all standard API responses; direct CSV file stream (`Content-Disposition: attachment`) for file exports.
- `tally_mappings` carries `(business_id)` unique constraint.
- `export_batches` carries unique `batch_reference` (format `TALLY-YYYY-MM-DD-XXXX`).
- Role gating: Tally mapping edits and export generation require `ADMIN` or `ACCOUNTANT` role.
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React from "react"`.
- Never commit `.env`; no new required env keys.

---

### Task 1: Dashboard API & Summary Aggregation Service

**Files:**
- Create: `backend/app/services/dashboard_service.py`, `backend/app/api/dashboard.py`, `backend/tests/test_dashboard.py`
- Modify: `backend/app/main.py` (mount router)

**Interfaces:**
- Consumes: `Order`, `Parcel`, `ScanEvent`, `ReturnRecord`, `Refund`, `Reconciliation`, `get_current_user`, `get_db`
- Produces: `get_dashboard_summary(db, business_id) -> dict`; `GET /api/v1/dashboard/summary`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dashboard.py
import pytest
from test_returns import _mk  # reuse fixture order setup

def test_dashboard_summary():
    from app.services.dashboard_service import get_dashboard_summary
    from app.models.refund import Refund
    db, b, u, o, i, p = _mk()
    
    # Add a refund
    db.add(Refund(business_id=b.id, order_id=o.id, shopify_refund_id="r100", amount=50.0, currency="INR", status="COMPLETED"))
    db.commit()
    
    res = get_dashboard_summary(db, b.id)
    assert res["kpis"]["orders_total"] >= 1
    assert res["financials"]["gross_sales"] > 0
    assert res["financials"]["total_refunds"] == 50.0
    assert "reconciled_rate" in res["kpis"]

def test_dashboard_api_endpoint(auth_client_admin):
    r = auth_client_admin.get("/api/v1/dashboard/summary")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "kpis" in data
    assert "financials" in data
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_dashboard.py -v`
Expected: FAIL `No module named app.services.dashboard_service`

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/dashboard_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.scan_event import ScanEvent
from app.models.return_record import ReturnRecord
from app.models.refund import Refund
from app.models.reconciliation import Reconciliation

def get_dashboard_summary(db: Session, business_id: str) -> dict:
    orders_q = db.query(Order).filter_by(business_id=business_id)
    orders_total = orders_q.count()
    paid_orders = orders_q.filter_by(financial_status="PAID").count()
    cancelled_orders = orders_q.filter(Order.cancelled_at.isnot(None)).count()
    
    parcels_q = db.query(Parcel).filter_by(business_id=business_id)
    packed_orders = parcels_q.filter_by(status="PACKED").count()
    
    dispatched_orders = db.query(ScanEvent).filter_by(business_id=business_id, event_type="DISPATCHED").count()
    returns_total = db.query(ReturnRecord).filter_by(business_id=business_id).count()
    rto_total = db.query(ReturnRecord).filter_by(business_id=business_id, return_type="RTO").count()
    
    open_exceptions = db.query(Reconciliation).filter_by(business_id=business_id, resolved=False).count()
    reconciled_rate = round(((orders_total - open_exceptions) / max(orders_total, 1)) * 100, 1)
    
    gross_sales = float(db.query(func.coalesce(func.sum(Order.total_amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_tax = float(db.query(func.coalesce(func.sum(Order.total_tax), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_shipping = float(db.query(func.coalesce(func.sum(Order.total_shipping), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    total_refunds = float(db.query(func.coalesce(func.sum(Refund.amount), 0.0)).filter_by(business_id=business_id).scalar() or 0.0)
    net_revenue = gross_sales - total_refunds

    return {
        "kpis": {
            "orders_total": orders_total,
            "paid_orders": paid_orders,
            "cancelled_orders": cancelled_orders,
            "packed_orders": packed_orders,
            "dispatched_orders": dispatched_orders,
            "returns_total": returns_total,
            "rto_total": rto_total,
            "open_exceptions": open_exceptions,
            "reconciled_rate": reconciled_rate
        },
        "financials": {
            "gross_sales": gross_sales,
            "total_tax": total_tax,
            "total_shipping": total_shipping,
            "total_refunds": total_refunds,
            "net_revenue": net_revenue
        }
    }
```

```python
# backend/app/api/dashboard.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.dashboard_service import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    data = get_dashboard_summary(db, u.get("business_id"))
    return {"success": True, "data": data}
```

Mount `dashboard.py` router in `backend/app/main.py`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_dashboard.py -v`
Expected: PASS

---

### Task 2: Multi-tab / Comprehensive Operational Excel Export Engine

**Files:**
- Create: `backend/app/services/export_service.py`, `backend/app/api/export.py`, `backend/tests/test_export.py`
- Modify: `backend/app/main.py` (mount router)

**Interfaces:**
- Consumes: `Order`, `Parcel`, `ScanEvent`, `ReturnRecord`, `Reconciliation`, `Payment`, `Refund`, `get_current_user`
- Produces: `generate_excel_workbook(db, business_id) -> bytes`; `GET /api/v1/export/excel`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_export.py
from test_returns import _mk

def test_export_excel_csv():
    from app.services.export_service import generate_excel_workbook
    db, b, u, o, i, p = _mk()
    content = generate_excel_workbook(db, b.id)
    assert isinstance(content, (bytes, str))
    text = content.decode() if isinstance(content, bytes) else content
    assert "SECTION: ORDERS" in text
    assert o.shopify_order_name in text

def test_export_endpoint(auth_client_admin):
    r = auth_client_admin.get("/api/v1/export/excel")
    assert r.status_code == 200
    assert "attachment; filename=" in r.headers.get("content-disposition", "")
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_export.py -v`
Expected: FAIL `No module named app.services.export_service`

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/export_service.py
import io
import csv
from sqlalchemy.orm import Session
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.scan_event import ScanEvent
from app.models.return_record import ReturnRecord
from app.models.reconciliation import Reconciliation

def generate_excel_workbook(db: Session, business_id: str) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    
    # 1. SUMMARY
    writer.writerow(["=== SECTION: SUMMARY ==="])
    writer.writerow(["Generated At", "Business ID"])
    writer.writerow(["Now", business_id])
    writer.writerow([])
    
    # 2. ORDERS
    writer.writerow(["=== SECTION: ORDERS ==="])
    writer.writerow(["Order Name", "Financial Status", "Operational Status", "Total Amount", "Currency", "Created At"])
    orders = db.query(Order).filter_by(business_id=business_id).all()
    for o in orders:
        writer.writerow([o.shopify_order_name, o.financial_status, o.operational_status, o.total_amount, o.currency, str(o.created_at)])
    writer.writerow([])
    
    # 3. PARCELS & SCANS
    writer.writerow(["=== SECTION: SCANS ==="])
    writer.writerow(["Barcode", "Order ID", "Event Type", "Created At"])
    scans = db.query(ScanEvent).filter_by(business_id=business_id).all()
    for s in scans:
        writer.writerow([s.parcel_id, s.order_id, s.event_type, str(s.created_at)])
    writer.writerow([])
    
    # 4. RECONCILIATIONS
    writer.writerow(["=== SECTION: RECONCILIATIONS ==="])
    writer.writerow(["Order ID", "Issue Code", "Severity", "Resolved", "Issue Message"])
    recons = db.query(Reconciliation).filter_by(business_id=business_id).all()
    for r in recons:
        writer.writerow([r.order_id, r.issue_code, r.severity, r.resolved, r.issue_message])
        
    return output.getvalue().encode("utf-8")
```

```python
# backend/app/api/export.py
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.export_service import generate_excel_workbook

router = APIRouter(prefix="/api/v1/export", tags=["export"])

@router.get("/excel")
def export_excel(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    content = generate_excel_workbook(db, u.get("business_id"))
    headers = {"Content-Disposition": 'attachment; filename="recon_export.csv"'}
    return Response(content=content, media_type="text/csv", headers=headers)
```

Mount `export.py` router in `backend/app/main.py`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_export.py -v`
Expected: PASS

---

### Task 3: Tally Models, Migration, Service & Validation API

**Files:**
- Create: `backend/app/models/tally.py`, `backend/alembic/versions/0005_sprint5.py`, `backend/app/services/tally_service.py`, `backend/app/api/tally.py`, `backend/tests/test_tally.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py` (mount router)

**Interfaces:**
- Consumes: `TallyMapping`, `ExportBatch`, `Order`, `Payment`, `Refund`, `get_current_user`
- Produces: `get_or_create_mapping`, `update_mapping`, `validate_tally_export`, `generate_tally_export`; `GET/PUT /api/v1/tally/mapping`, `POST /api/v1/tally/validate`, `POST /api/v1/tally/export`, `GET /api/v1/tally/batches`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tally.py
from test_returns import _mk

def test_tally_mapping_crud():
    from app.services.tally_service import get_or_create_mapping, update_mapping
    db, b, u, o, i, p = _mk()
    m = get_or_create_mapping(db, b.id)
    assert m.voucher_sales == "Sales"
    
    m2 = update_mapping(db, b.id, {"voucher_sales": "Custom Sales"})
    assert m2.voucher_sales == "Custom Sales"

def test_tally_validation_and_export():
    from app.services.tally_service import validate_tally_export, generate_tally_export
    db, b, u, o, i, p = _mk()
    val = validate_tally_export(db, b.id)
    assert val["valid"] is True
    
    out = generate_tally_export(db, b.id, u.id)
    assert "batch" in out
    assert out["batch"]["batch_reference"].startswith("TALLY-")
    assert "Voucher Type" in out["content"].decode()
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_tally.py -v`
Expected: FAIL `No module named app.models.tally`

- [ ] **Step 3: Minimal implementation**

Create `backend/app/models/tally.py`:
```python
from sqlalchemy import ForeignKey, String, Integer, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class TallyMapping(Base):
    __tablename__ = "tally_mappings"
    __table_args__ = (UniqueConstraint("business_id", name="uq_tally_mapping_biz"),)
    
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    voucher_sales: Mapped[str] = mapped_column(String(64), default="Sales")
    voucher_sales_return: Mapped[str] = mapped_column(String(64), default="Sales Return")
    voucher_credit_note: Mapped[str] = mapped_column(String(64), default="Credit Note")
    ledger_razorpay: Mapped[str] = mapped_column(String(128), default="Razorpay Settlement")
    ledger_cod: Mapped[str] = mapped_column(String(128), default="COD Receivable")
    ledger_sales: Mapped[str] = mapped_column(String(128), default="Sales Account")
    ledger_cgst: Mapped[str] = mapped_column(String(128), default="Output CGST")
    ledger_sgst: Mapped[str] = mapped_column(String(128), default="Output SGST")
    ledger_igst: Mapped[str] = mapped_column(String(128), default="Output IGST")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ExportBatch(Base):
    __tablename__ = "export_batches"
    
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    batch_reference: Mapped[str] = mapped_column(String(64), unique=True)
    export_type: Mapped[str] = mapped_column(String(32), default="TALLY_EXCEL")
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

Create migration `backend/alembic/versions/0005_sprint5.py`.

Create `backend/app/services/tally_service.py`:
```python
import io
import csv
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.tally import TallyMapping, ExportBatch
from app.models.order import Order

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

def validate_tally_export(db: Session, business_id: str) -> dict:
    m = get_or_create_mapping(db, business_id)
    errors = []
    if not m.ledger_sales:
        errors.append("Sales ledger mapping is required.")
    
    orders_count = db.query(Order).filter_by(business_id=business_id).count()
    return {"valid": len(errors) == 0, "errors": errors, "order_count": orders_count}

def generate_tally_export(db: Session, business_id: str, user_id: str) -> dict:
    val = validate_tally_export(db, business_id)
    if not val["valid"]:
        raise ValueError("; ".join(val["errors"]))
        
    m = get_or_create_mapping(db, business_id)
    orders = db.query(Order).filter_by(business_id=business_id).all()
    
    ref = f"TALLY-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{int(datetime.now(timezone.utc).timestamp()) % 10000:04d}"
    batch = ExportBatch(business_id=business_id, batch_reference=ref, record_count=len(orders), generated_by=user_id)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Voucher Ref", "Date", "Voucher Type", "Party / Ledger", "Debit / Credit", "Amount", "Narration"])
    
    for o in orders:
        dt_str = o.created_at.strftime("%Y-%m-%d") if o.created_at else ""
        writer.writerow([o.shopify_order_name, dt_str, m.voucher_sales, m.ledger_sales, "Credit", o.total_amount, f"Order {o.shopify_order_name}"])
        
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
```

Create `backend/app/api/tally.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.auth import get_current_user
from app.database import get_db
from app.services.tally_service import get_or_create_mapping, update_mapping, validate_tally_export, generate_tally_export
from app.models.tally import ExportBatch

router = APIRouter(prefix="/api/v1/tally", tags=["tally"])

class MappingIn(BaseModel):
    voucher_sales: str | None = None
    voucher_sales_return: str | None = None
    voucher_credit_note: str | None = None
    ledger_razorpay: str | None = None
    ledger_cod: str | None = None
    ledger_sales: str | None = None
    ledger_cgst: str | None = None
    ledger_sgst: str | None = None
    ledger_igst: str | None = None

@router.get("/mapping")
def get_mapping(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    m = get_or_create_mapping(db, u.get("business_id"))
    return {"success": True, "data": m}

@router.put("/mapping")
def put_mapping(body: MappingIn, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    m = update_mapping(db, u.get("business_id"), body.model_dump(exclude_unset=True))
    return {"success": True, "data": m}

@router.post("/validate")
def validate(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    return {"success": True, "data": validate_tally_export(db, u.get("business_id"))}

@router.post("/export")
def export(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    if u.get("role") not in ("ADMIN", "ACCOUNTANT"):
        raise HTTPException(403, "Accountant role required")
    try:
        out = generate_tally_export(db, u.get("business_id"), u.get("user_id"))
        headers = {"Content-Disposition": f'attachment; filename="{out["batch"]["batch_reference"]}.csv"'}
        return Response(content=out["content"], media_type="text/csv", headers=headers)
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.get("/batches")
def list_batches(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    batches = db.query(ExportBatch).filter_by(business_id=u.get("business_id")).order_by(ExportBatch.created_at.desc()).all()
    return {"success": True, "data": batches}
```

Mount `tally.py` router in `backend/app/main.py`.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_tally.py -v`
Expected: PASS

---

### Task 4: Dashboard UI & Tally Settings Workspace

**Files:**
- Create: `frontend/app/page.tsx` (Dashboard page with metrics & financials), `frontend/app/settings/tally/page.tsx` (Tally mapping UI), `frontend/components/MetricCard.tsx`, `frontend/tests/dashboard.test.tsx`, `frontend/tests/tally.test.tsx`

**Interfaces:**
- Consumes: `api()`, `/api/v1/dashboard/summary`, `/api/v1/tally/mapping`, `/api/v1/tally/validate`, `/api/v1/tally/export`
- Produces: Executive dashboard and Tally settings workspace

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/tests/dashboard.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import MetricCard from "../components/MetricCard";

test("MetricCard renders title and value", () => {
  render(<MetricCard title="Gross Sales" value="₹10,000" />);
  expect(screen.getByText("Gross Sales")).toBeDefined();
  expect(screen.getByText("₹10,000")).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- dashboard.test`
Expected: FAIL missing component.

- [ ] **Step 3: Minimal implementation**

Create `frontend/components/MetricCard.tsx`:
```tsx
import React from "react";

export default function MetricCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div style={{ border: "1px solid #ccc", padding: "16px", borderRadius: "8px", background: "#fff" }}>
      <div style={{ fontSize: "14px", color: "#666" }}>{title}</div>
      <div style={{ fontSize: "24px", fontWeight: "bold", margin: "8px 0" }}>{value}</div>
      {subtitle && <div style={{ fontSize: "12px", color: "#888" }}>{subtitle}</div>}
    </div>
  );
}
```

Create `frontend/app/page.tsx` (Executive Dashboard):
```tsx
"use client";
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import MetricCard from "../components/MetricCard";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<any>("/dashboard/summary")
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading Dashboard...</div>;
  if (!data) return <div>Dashboard unavailable</div>;

  const { kpis, financials } = data;

  return (
    <div style={{ padding: "24px" }}>
      <h1>Executive Dashboard</h1>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <MetricCard title="Orders Total" value={kpis.orders_total} />
        <MetricCard title="Dispatched" value={kpis.dispatched_orders} />
        <MetricCard title="Returns / RTO" value={`${kpis.returns_total} / ${kpis.rto_total}`} />
        <MetricCard title="Open Exceptions" value={kpis.open_exceptions} />
      </div>

      <h2>Financial Summary</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <MetricCard title="Gross Sales" value={`₹${financials.gross_sales}`} />
        <MetricCard title="Total Refunds" value={`₹${financials.total_refunds}`} />
        <MetricCard title="Net Revenue" value={`₹${financials.net_revenue}`} />
      </div>
    </div>
  );
}
```

Create `frontend/app/settings/tally/page.tsx` (Tally Settings & Export):
```tsx
"use client";
import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function TallySettingsPage() {
  const [mapping, setMapping] = useState<any>({
    voucher_sales: "Sales",
    voucher_sales_return: "Sales Return",
    voucher_credit_note: "Credit Note",
    ledger_razorpay: "Razorpay Settlement",
    ledger_cod: "COD Receivable",
    ledger_sales: "Sales Account",
    ledger_cgst: "Output CGST",
    ledger_sgst: "Output SGST",
    ledger_igst: "Output IGST",
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    api<any>("/tally/mapping")
      .then((res) => { if (res.data) setMapping(res.data); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await api("/tally/mapping", { method: "PUT", body: JSON.stringify(mapping) });
      setStatus("Mappings saved successfully!");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div style={{ padding: "24px" }}>
      <h1>Tally ERP / Prime Settings</h1>
      {status && <div role="status" style={{ marginBottom: "16px", color: "blue" }}>{status}</div>}
      
      <h3>Voucher Mappings</h3>
      <div>
        <label>Sales Voucher: </label>
        <input value={mapping.voucher_sales || ""} onChange={(e) => setMapping({ ...mapping, voucher_sales: e.target.value })} />
      </div>
      <div>
        <label>Sales Return Voucher: </label>
        <input value={mapping.voucher_sales_return || ""} onChange={(e) => setMapping({ ...mapping, voucher_sales_return: e.target.value })} />
      </div>
      
      <h3 style={{ marginTop: "16px" }}>Ledger Mappings</h3>
      <div>
        <label>Sales Account: </label>
        <input value={mapping.ledger_sales || ""} onChange={(e) => setMapping({ ...mapping, ledger_sales: e.target.value })} />
      </div>

      <button onClick={handleSave} style={{ marginTop: "24px", padding: "8px 16px" }}>Save Tally Settings</button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run` + `npx tsc --noEmit` from `frontend/`
Expected: PASS (vitest 6/6, tsc clean)

---

### Task 5: End-to-End Hardening, Migration & Final Verification

**Files:**
- Run Alembic migration `0005_sprint5` on PostgreSQL (`recon_mvp`).
- Verify full test suite across all 5 sprints.

- [ ] **Step 1: Live DB Migration**

Run: `alembic upgrade head` (in `backend/`).
Verify Postgres tables: `tally_mappings`, `export_batches`.

- [ ] **Step 2: Full Regression Run**

- Backend: `python -m pytest tests -q` (Expect 50+ passed)
- Frontend: `npm test -- --run` (Expect 6+ passed)
- TypeScript: `npx tsc --noEmit` (Clean)

- [ ] **Step 3: Update Progress & Complete Documentation**

Verify all docs reflect complete MVP status across Sprints 1–5.
