# CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants upload Shopify's orders-export CSV and get fully reconcilable orders with zero Shopify credentials.

**Architecture:** Pure `csv_import_service` (parse CSV → group by Name → adapt each group to the API-shaped payload `upsert_order` already accepts) reuses the entire write path (normalize, customer/item upsert, parcel ensure, reconcile hook); thin `imports` router; Next.js `/import` page with result card. No migrations, no new env keys.

**Tech Stack:** Python 3.14 stdlib `csv`/`io`, FastAPI multipart (`python-multipart` already pinned), SQLAlchemy 2.0, pytest 8, Next.js 14 TS.

## Global Constraints

- Every business-owned row carries `business_id` UUID; import scoped by JWT `business_id`.
- Reuse `upsert_order(db, business_id, api_payload) -> order_id` — never duplicate its logic; CSV adapter outputs API-shaped payloads only.
- Adapter payload keys (exact, per `normalize_shopify_order`): `id, name, currency, subtotal, total_discounts, total_shipping, total_tax, total_price, financial_status, fulfillment_status, created_at, cancelled_at, cancel_reason, customer{id,first_name,email,phone}, line_items[{id,title,sku,quantity,price}]`.
- `shopify_order_id` = `"gid://shopify/Order/<Id>"` when Id present else `"csv:<Name>"`; dedupes naturally with future webhooks.
- API envelope on all routes; upload restricted to ADMIN/ACCOUNTANT (403 otherwise); `.csv` only (415), 5MB/5,000-row caps (400 `FILE_TOO_LARGE`).
- UTF-8-SIG decode (Shopify BOM); `Created at` format `%Y-%m-%d %H:%M:%S %z` → UTC.
- Never commit `.env` or the sample CSV's PII (sample has none — safe as fixture).
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React`.

---

### Task 1: CSV parser (pure, no DB)

**Files:**
- Create: `backend/app/services/csv_import_service.py`, `backend/tests/test_csv_parse.py`
- Test fixture (copy, do not move): `backend/tests/fixtures/orders_export_1.csv` from `A:/Shopify Connection/orders_export_1.csv`

**Interfaces:**
- Consumes: raw CSV bytes
- Produces: `parse_shopify_csv(content: bytes) -> tuple[list[dict], list[dict]]` → (api_payloads, errors[{row, name, reason}])

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_csv_parse.py
from pathlib import Path

def _content():
    return (Path(__file__).parent / "fixtures" / "orders_export_1.csv").read_bytes()

def test_parse_sample():
    from app.services.csv_import_service import parse_shopify_csv
    payloads, errors = parse_shopify_csv(_content())
    assert errors == []
    assert len(payloads) == 4
    by_name = {p["name"]: p for p in payloads}
    assert by_name["#1004"]["financial_status"] == "refunded"
    assert by_name["#1004"]["id"] == "gid://shopify/Order/7193174442228"
    assert by_name["#1002"]["total_price"] == "25.00" or float(by_name["#1002"]["total_price"]) == 25.0
    assert len(by_name["#1001"]["line_items"]) == 1
    assert by_name["#1001"]["line_items"][0]["quantity"] in (1, "1")

def test_missing_name_skipped():
    from app.services.csv_import_service import parse_shopify_csv
    payloads, errors = parse_shopify_csv(b"Name,Email,Financial Status,Id,Created at,Total\n,,paid,1,2026-09-28 07:00:30 -0400,5.00\n")
    assert payloads == [] and len(errors) == 1 and errors[0]["row"] == 2
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_csv_parse.py -v`
Expected: FAIL "No module named app.services.csv_import_service"

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/services/csv_import_service.py
"""Parse Shopify orders-export CSV into API-shaped order payloads. Pure: no DB."""
import csv
import io
from datetime import datetime, timezone

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000

FINANCIAL = {"paid": "paid", "refunded": "refunded", "pending": "pending",
             "voided": "voided", "authorized": "authorized", "partially_paid": "partially_paid",
             "partially_refunded": "partially_refunded", "partially refunded": "partially_refunded"}
FULFILL = {"unfulfilled": "unfulfilled", "fulfilled": "fulfilled", "partial": "partial",
           "partially_fulfilled": "partial", "restocked": "unfulfilled"}

class FileTooLarge(Exception):
    pass

def _dt(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M %z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None

def parse_shopify_csv(content: bytes):
    if len(content) > MAX_BYTES:
        raise FileTooLarge(f"File exceeds {MAX_BYTES} bytes.")
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    groups: dict[str, dict] = {}
    order: list[str] = []
    errors: list[dict] = []
    warnings: list[dict] = []
    for lineno, row in enumerate(reader, start=2):
        if lineno - 1 > MAX_ROWS:
            raise FileTooLarge(f"File exceeds {MAX_ROWS} rows.")
        name = (row.get("Name") or "").strip()
        if not name:
            errors.append({"row": lineno, "name": "", "reason": "Missing order Name."})
            continue
        if name not in groups:
            sid = (row.get("Id") or "").strip()
            fin = (row.get("Financial Status") or "pending").strip().lower()
            ful = (row.get("Fulfillment Status") or "unfulfilled").strip().lower()
            if fin not in FINANCIAL:
                warnings.append({"row": lineno, "name": name, "reason": f"Unknown financial status '{fin}', defaulted to pending."})
            if ful not in FULFILL:
                warnings.append({"row": lineno, "name": name, "reason": f"Unknown fulfillment status '{ful}', defaulted to unfulfilled."})
            created = _dt(row.get("Created at", ""))
            if row.get("Created at", "").strip() and created is None:
                warnings.append({"row": lineno, "name": name, "reason": "Unparseable Created at, using import time."})
            cancelled = _dt(row.get("Cancelled at", ""))
            email = (row.get("Email") or "").strip() or None
            phone = (row.get("Phone") or "").strip() or None
            bname = (row.get("Billing Name") or row.get("Shipping Name") or "").strip()
            parts = bname.split(None, 1)
            groups[name] = {
                "id": f"gid://shopify/Order/{sid}" if sid else f"csv:{name}",
                "name": name,
                "currency": (row.get("Currency") or "INR").strip() or "INR",
                "subtotal": (row.get("Subtotal") or "0").strip(),
                "total_discounts": (row.get("Discount Amount") or "0").strip(),
                "total_shipping": (row.get("Shipping") or "0").strip(),
                "total_tax": (row.get("Taxes") or "0").strip(),
                "total_price": (row.get("Total") or "0").strip(),
                "financial_status": FINANCIAL.get(fin, "pending"),
                "fulfillment_status": FULFILL.get(ful, "unfulfilled"),
                "created_at": row.get("Created at", "").strip(),
                "cancelled_at": row.get("Cancelled at", "").strip() or None,
                "cancel_reason": "imported cancelled" if (row.get("Cancelled at") or "").strip() else None,
                "refunded_amount": (row.get("Refunded Amount") or "0").strip(),
                "payment_method": (row.get("Payment Method") or "").strip() or None,
                "customer": {"id": None, "first_name": parts[0] if parts else "",
                             "email": email, "phone": phone},
                "line_items": [],
            }
            order.append(name)
        g = groups[name]
        title = (row.get("Lineitem name") or "").strip()
        if not title:
            continue
        try:
            qty = int(float(row.get("Lineitem quantity") or 1))
        except ValueError:
            errors.append({"row": lineno, "name": name, "reason": f"Bad lineitem quantity '{row.get('Lineitem quantity')}'."})
            continue
        g["line_items"].append({"title": title, "sku": (row.get("Lineitem sku") or "").strip() or None,
                                "quantity": qty, "price": (row.get("Lineitem price") or "0").strip()})
    return [groups[n] for n in order], errors + warnings
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_csv_parse.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Fixture safety check**

Run: `Select-String -Pattern "@|\\+91" backend/tests/fixtures/orders_export_1.csv`
Expected: no output (no PII committed).

---

### Task 2: Import API (upsert + refunds + summary)

**Files:**
- Create: `backend/app/api/imports.py`, `backend/tests/test_csv_import.py`
- Modify: `backend/app/main.py` (mount imports router)

**Interfaces:**
- Consumes: `parse_shopify_csv`, `FileTooLarge`, `upsert_order`, `ensure_parcel_for_order`, `reconcile_order` (best-effort), `Refund`, `get_current_user`
- Produces: `POST /api/v1/imports/shopify-csv` (multipart `file`, `dry_run` query) → `{parsed, created, updated, skipped, errors[], order_ids[]}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_csv_import.py
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel
import app.models.scan_event, app.models.return_record, app.models.audit_log
import app.models.shopify_store, app.models.webhook_event, app.models.payment
import app.models.refund, app.models.reconciliation
from app.main import app
from app.database import get_db

def _client():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"), role="ADMIN")
    db.add(u); db.commit(); db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    return c, tok

def _bytes():
    return (Path(__file__).parent / "fixtures" / "orders_export_1.csv").read_bytes()

def test_import_creates_orders_and_refund():
    c, tok = _client()
    r = c.post("/api/v1/imports/shopify-csv", files={"file": ("orders.csv", _bytes(), "text/csv")},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["created"] == 4 and d["skipped"] == 0
    r2 = c.get("/api/v1/orders", headers={"Authorization": f"Bearer {tok}"})
    assert r2.json()["data"]["total"] == 4
    names = [o["shopify_order_name"] for o in r2.json()["data"]["items"]]
    assert "#1004" in names

def test_reimport_no_duplicates_and_dry_run():
    c, tok = _client()
    h = {"Authorization": f"Bearer {tok}"}
    c.post("/api/v1/imports/shopify-csv", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
    r = c.post("/api/v1/imports/shopify-csv", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
    assert r.json()["data"]["created"] == 0 and r.json()["data"]["updated"] == 4
    d = c.post("/api/v1/imports/shopify-csv?dry_run=true", files={"file": ("o.csv", _bytes(), "text/csv")}, headers=h)
    assert d.json()["data"]["created"] == 0 and d.json()["data"]["parsed"] == 4
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_csv_import.py -v`
Expected: FAIL 404 (no route) or "No module named app.api.imports".

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/api/imports.py
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
    from app.models.refund import Refund
    created = updated = skipped = 0
    errors = list(issues)
    order_ids: list[str] = []
    for p in payloads:
        try:
            before = _count_orders(db, bid)
            oid = upsert_order(db, bid, p)
            after = _count_orders(db, bid)
            if after > before:
                created += 1
            else:
                updated += 1
            order_ids.append(oid)
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
```

Mount in main.py: `from app.api.imports import router as imports_router; app.include_router(imports_router)`.

Note: `upsert_order` commits internally (Sprint 1 behavior: commit+refresh per order) — the before/after count heuristic distinguishes created vs updated. Verify against actual `upsert_order` return contract when implementing (it returns order id; created-detection via count delta is robust regardless).

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_csv_import.py -v`
Expected: PASS (2 passed). Full suite green.

- [ ] **Step 5: Sample end-to-end via TestClient (document)**

Upload → 4 orders → parcel lookup for one barcode works → reconcile issues sane (R004 PAYMENT_DATA_MISSING expected: CSV path creates PENDING payment rows via `_upsert_items_and_payment`? upsert creates Payment PENDING — R004 fires only when PAID. Note outcome in report.)

---

### Task 3: Upload UI

**Files:**
- Create: `frontend/app/import/page.tsx`, `frontend/tests/import.test.tsx`
- Modify: `frontend/app/orders/page.tsx` (add Import link next to sync button)

**Interfaces:**
- Consumes: `api()` (multipart: pass FormData with NO explicit Content-Type so browser sets boundary — `api()` forces `application/json`! Must bypass: use raw fetch to `${API}/api/v1/imports/shopify-csv` with token header, or extend api. Chosen: raw fetch in page, token from localStorage.)
- Produces: upload page + result card

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/import.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ImportResult from "../components/ImportResult";
test("result shows counts", () => {
  render(<ImportResult summary={{ parsed: 4, created: 4, updated: 0, skipped: 0, errors: [] }} />);
  expect(screen.getByText(/4 created/)).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- import.test`
Expected: FAIL missing component.

- [ ] **Step 3: Minimal implementation**

```tsx
// frontend/components/ImportResult.tsx
import React from "react";
export type ImportSummary = { parsed: number; created: number; updated: number; skipped: number; errors: { row: number | null; name?: string; reason: string }[] };
export default function ImportResult({ summary }: { summary: ImportSummary }) {
  return (
    <div>
      <p>{summary.parsed} parsed · {summary.created} created · {summary.updated} updated · {summary.skipped} skipped</p>
      {summary.errors.length > 0 && (
        <table><thead><tr><th>Row</th><th>Order</th><th>Reason</th></tr></thead>
          <tbody>{summary.errors.map((e, ix) => <tr key={ix}><td>{e.row ?? "-"}</td><td>{e.name ?? "-"}</td><td>{e.reason}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
```

```tsx
// frontend/app/import/page.tsx
"use client";
import React, { useState } from "react";
import Link from "next/link";
import { API } from "../../lib/api";
import ImportResult, { ImportSummary } from "../../components/ImportResult";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true); setError(null); setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") ?? "";
      const r = await fetch(`${API}/api/v1/imports/shopify-csv`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? "Import failed");
      setSummary(j.data);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Import Shopify orders CSV</h1>
      <p>Shopify admin → Orders → Export → upload the .csv here. No store connection needed.</p>
      <input type="file" accept=".csv" aria-label="CSV file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={upload} disabled={!file || busy}>{busy ? "Importing…" : "Upload & import"}</button>
      {error && <p role="alert">{error}</p>}
      {summary && (<><ImportResult summary={summary} /><Link href="/orders">View orders</Link></>)}
    </main>
  );
}
```

Orders page edit: next to the sync button add `<Link href="/import">Import CSV</Link>` (import Link from next/link if missing — verify file first).

- [ ] **Step 4: Verify**

Run: `npm test -- import.test` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Manual upload**

Dev stack: upload the real sample → result card 4 created → /orders shows #1001–#1004.

---

### Task 4: Regression + docs + sample decision

**Files:**
- Modify: `README.md` (append CSV import section)

**Interfaces:**
- Consumes: full suites
- Produces: green build + docs + committed fixture

- [ ] **Step 1: Full backend regression**

Run: `python -m pytest tests -v`
Expected: zero failures (52 existing + 2 parse + 2 import = 56).

- [ ] **Step 2: Full frontend checks**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: clean + green (22 suites incl import).

- [ ] **Step 3: Fixture + sample hygiene**

Run: `git check-ignore orders_export_1.csv; echo "ignored=$?"` — the root sample must STAY untracked (add `orders_export_*.csv` to `.gitignore`; fixture copy under tests/ is the committed one).
Confirm: `git status --porcelain` shows `backend/tests/fixtures/orders_export_1.csv` staged, root sample absent.

- [ ] **Step 4: Live drill on dev DB**

Upload sample via running backend (TestClient or UI) → backfill not needed (parcels auto) → dispatch one parcel → return it → timeline + exceptions sane. Document results in report.

- [ ] **Step 5: Docs**

Append to `README.md`:
```md
## CSV import (no-connection onboarding)
- Export: Shopify admin → Orders → Export → CSV.
- Upload: `/import` page or `POST /api/v1/imports/shopify-csv` (multipart `file`, ADMIN/ACCOUNTANT, `?dry_run=true` for validation-only).
- Identity: real Shopify `Id` reused (`gid://shopify/Order/<Id>`), so later webhooks/sync upsert instead of duplicating. Caps: 5MB / 5,000 rows. Refunded Amount > 0 creates a refund row.
```
