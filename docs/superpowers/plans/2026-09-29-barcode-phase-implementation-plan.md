# Barcode Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client-rendered Code128 labels with batch print + reprint audit, and phone-camera scanning into dispatch/return/RTO — keeping the stable `P…` barcode identity.

**Architecture:** Migration `0010` (barcode_format, parcel_items, client_scans, 2 indexes); `barcode_service` gains normalize/validate + parcel-items sync; `POST /scan/rto` + reprint endpoints; bwip-js rendering components; ZXing scanner component shared by 3 scan pages; labels + parcels-list + scan-hub + test-sheet pages.

**Tech Stack:** Python 3.14, FastAPI 0.115, SQLAlchemy 2.0, Alembic 1.14, pytest 8, Next.js 14 TS, bwip-js 4.x (pinned at install), @zxing/browser 0.1.x (pinned at install), vitest.

## Global Constraints

- Barcode identity NEVER changes: keep generating `P%08d`; validators accept `^P\d{8}$` (legacy) AND `^PKG-\d{10}$` (plan).
- `normalize_barcode(v) = v.strip().upper()` only — never strip/alter other characters.
- Every business-owned row carries `business_id`; lookups always `business_id + barcode_value`.
- `scan_events`/audit append-only; reprint writes audit, never touches parcel identity.
- API envelope; scan writes ADMIN/WAREHOUSE; reprint WAREHOUSE+; label/config reads all authed roles.
- Never commit `.env`; no new env keys; pin exact npm versions + lockfile.
- Backend tests run with workdir `backend/`; frontend `jsx: preserve`, JSX files in vitest graph need `import React`.

---

### Task 1: Schema + normalize/validate + parcel_items + client_scans

**Files:**
- Create: `backend/app/models/parcel_item.py`, `backend/alembic/versions/0010_barcode.py`, `backend/tests/test_barcode_format.py`
- Modify: `backend/app/models/parcel.py` (+barcode_format), `backend/app/models/__init__.py`, `backend/app/models/scan_event.py` (+client_scan_id NULL — idempotency key needs a column; metadata JSON query is not portable), `backend/app/services/barcode_service.py` (+normalize/validate/items-sync), `backend/alembic/env.py` only if imports missing (verify first)

**Interfaces:**
- Consumes: `Base`, `uuidpk`, `Order`, `OrderItem`
- Produces: `normalize_barcode(v: str) -> str`; `validate_barcode_format(v: str) -> bool`; `ParcelItem` model; `ScanEvent.client_scan_id`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_barcode_format.py
def test_normalize_and_validate():
    from app.services.barcode_service import normalize_barcode, validate_barcode_format
    assert normalize_barcode("  p00000001 ") == "P00000001"
    assert validate_barcode_format("P00000001")
    assert validate_barcode_format("PKG-0000000001")
    assert not validate_barcode_format("P123")
    assert not validate_barcode_format("PKG-123")
    assert not validate_barcode_format("")

def test_parcel_items_synced():
    from test_returns import _mk
    from app.models.parcel_item import ParcelItem
    db, b, u, o, i, p = _mk()  # 1 item qty 3
    rows = db.query(ParcelItem).filter_by(parcel_id=p.id).all()
    assert len(rows) == 1 and rows[0].quantity == 3 and rows[0].order_item_id == i.id
```

Note: `_mk` calls `ensure_parcel_for_order` — items sync lands via the Task 1 implementation (test fails until then).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_barcode_format.py -v`
Expected: FAIL "No module named app.models.parcel_item" (import at top fails first).

- [ ] **Step 3: Minimal implementation**

```python
# backend/app/models/parcel_item.py
from sqlalchemy import ForeignKey, String, Integer, DateTime, func, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from .base import uuidpk

class ParcelItem(Base):
    __tablename__ = "parcel_items"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_parcel_item_qty"),)
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcels.id"))
    order_item_id: Mapped[str] = mapped_column(ForeignKey("order_items.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

Parcel model addition: `barcode_format: Mapped[str] = mapped_column(String(16), default="CODE128")`.
ScanEvent addition: `client_scan_id: Mapped[str | None] = mapped_column(String(64), nullable=True)` + Index on (business_id, client_scan_id)? Index needs table_args edit — ScanEvent has `__table_args__ = (Index(...),)` single tuple; extend to second Index. Do it.

```python
# barcode_service.py additions
import re
LEGACY_RE = re.compile(r"^P\d{8}$")
PLAN_RE = re.compile(r"^PKG-\d{10}$")

def normalize_barcode(v: str) -> str:
    return (v or "").strip().upper()

def validate_barcode_format(v: str) -> bool:
    return bool(LEGACY_RE.match(v or "") or PLAN_RE.match(v or ""))

def sync_parcel_items(db, parcel) -> None:
    from app.models.order import OrderItem
    from app.models.parcel_item import ParcelItem
    for oi in db.query(OrderItem).filter_by(order_id=parcel.order_id).all():
        ex = db.query(ParcelItem).filter_by(parcel_id=parcel.id, order_item_id=oi.id).first()
        if ex is None:
            db.add(ParcelItem(business_id=parcel.business_id, parcel_id=parcel.id,
                              order_item_id=oi.id, quantity=oi.quantity))
    db.flush()
```

`ensure_parcel_for_order`: after parcel create-or-fetch, set `p.barcode_format = "CODE128"` if empty, call `sync_parcel_items(db, p)`, commit. Keep return contract.

Migration `0010_barcode.py` (down `0009_costs`): add parcels.barcode_format (server_default CODE128), create parcel_items (+check), add scan_events.client_scan_id NULL + index ix_scan_client (business_id, client_scan_id). Downgrade reverses.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_barcode_format.py -v` → PASS (2 passed); full suite green; `python -m alembic upgrade head --sql` shows 0010 DDL.

- [ ] **Step 5: Fixture check**

`_mk` orders created BEFORE this change have no parcel_items — `sync_parcel_items` runs on ensure (creation-time). Old parcels lack items: acceptable (test asserts only fresh `_mk` parabolas... `_mk` creates fresh each test → fine).

---

### Task 2: client_scan_id idempotency + /scan/rto + reprint audit

**Files:**
- Modify: `backend/app/api/scanning.py` (DispatchIn/ReturnIn += client_scan_id; new RtoIn + POST /rto; POST /parcels... no — reprint lives in parcels router), `backend/app/api/parcels.py` (+ POST /{id}/reprint), `backend/app/services/scanning_service.py` (dispatch dedupe), `backend/app/services/return_service.py` (return dedupe)
- Test: `backend/tests/test_scan_idempotency.py`

**Interfaces:**
- Consumes: `ScanEvent.client_scan_id`, `record_return`, `dispatch_parcel`, `log_audit`
- Produces: retry-safe scan endpoints; `POST /scan/rto`; `POST /parcels/{id}/reprint`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scan_idempotency.py
from test_returns import _mk

def test_dispatch_retry_same_id_no_second_event():
    from app.services.scanning_service import dispatch_parcel
    from app.models.scan_event import ScanEvent
    db, b, u, o, i, p = _mk()
    a = dispatch_parcel(db, b.id, p.barcode_value, u.id, client_scan_id="c1")
    before = db.query(ScanEvent).filter_by(parcel_id=p.id).count()
    b2 = dispatch_parcel(db, b.id, p.barcode_value, u.id, client_scan_id="c1")
    after = db.query(ScanEvent).filter_by(parcel_id=p.id).count()
    assert after == before and b2["parcel"]["status"] == "DISPATCHED"

def test_rto_endpoint():
    # TestClient + login (e2e pattern): POST /scan/rto on dispatched parcel → RTO statuses + event
```

Implementer: write the RTO test fully (seed via _mk through TestClient override is heavy — instead call `record_return(..., return_type="RTO")`? No — must hit the ROUTE. Use TestClient with StaticPool override + manual seed (copy test_tracking.py _seed style): create business/user/order/parcel, dispatch via service, then POST /scan/rto with Bearer → 200 + parcel RETURN_RECEIVED + order RTO).

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_scan_idempotency.py -v`
Expected: FAIL TypeError (unexpected client_scan_id) / 404 /scan/rto.

- [ ] **Step 3: Minimal implementation**

dispatch_parcel signature += `client_scan_id: str | None = None`; first lines after user check:
```python
    if client_scan_id:
        prior = db.query(ScanEvent).filter_by(business_id=business_id, client_scan_id=client_scan_id).first()
        if prior is not None:
            p0 = db.query(Parcel).filter_by(id=prior.parcel_id).first()
            o0 = db.query(Order).filter_by(id=prior.order_id).first()
            return {"parcel": {"id": p0.id, "barcode_value": p0.barcode_value, "status": p0.status},
                    "order": {"id": o0.id, "shopify_order_name": o0.shopify_order_name,
                              "operational_status": o0.operational_status}, "deduped": True}
```
Pass client_scan_id into the created ScanEvent. Same in record_return (return RunError import already aliased). Route models += `client_scan_id: str | None = None`, pass through.
`POST /scan/rto` (WAREHOUSE+): body {barcode, condition?, reason?, device_id?, client_scan_id?} → record_return(..., return_type="RTO", ...) + same error mapping.
`POST /parcels/{id}/reprint` (WAREHOUSE+): find parcel (id or barcode, tenant-scoped, 404) → log_audit RETURN... `LABEL_REPRINTED` old {count?} → new — audit needs old/new dicts: old {"barcode": code}, new {"barcode": code, "reprint": True} → return {"label_url": f"/api/v1/parcels/{id}/label", "reprint": True}.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_scan_idempotency.py -v` → PASS; full suite green.

- [ ] **Step 5: Manual retry drill**

Dispatch via /docs twice with same client_scan_id → one event row, identical bodies.

---

### Task 3: bwip-js rendering + labels management page

**Files:**
- Modify: `frontend/package.json` (+ `bwip-js` pinned exact — check latest 4.x via `npm view bwip-js version`, pin that), `frontend/app/parcels/[barcode]/page.tsx` (ParcelBarcode + print/PNG buttons)
- Create: `frontend/components/barcode/ParcelBarcode.tsx`, `frontend/components/barcode/LabelPreview.tsx`, `frontend/app/parcels/labels/page.tsx`, `frontend/app/parcels/page.tsx`, `frontend/tests/barcode.test.tsx`
- Test: error-state + contract only (jsdom has no canvas)

**Interfaces:**
- Consumes: bwip-js, parcel lookup API, label/reprint endpoints
- Produces: client-rendered barcodes; labels manager; parcels list

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/barcode.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { isValidBarcode } from "../lib/barcode";
import ParcelBarcode from "../components/barcode/ParcelBarcode";
test("accepts both formats", () => {
  expect(isValidBarcode("P00000001")).toBe(true);
  expect(isValidBarcode("PKG-0000000001")).toBe(true);
  expect(isValidBarcode("P123")).toBe(false);
});
test("invalid value shows error, not canvas", () => {
  render(<ParcelBarcode value="NOPE" />);
  expect(screen.getByRole("alert")).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- barcode.test` (after `npm install` for bwip-js)
Expected: FAIL missing modules.

- [ ] **Step 3: Minimal implementation**

```ts
// frontend/lib/barcode.ts
export function normalizeBarcode(v: string): string {
  return (v || "").trim().toUpperCase();
}
export function isValidBarcode(v: string): boolean {
  const s = normalizeBarcode(v);
  return /^P\d{8}$/.test(s) || /^PKG-\d{10}$/.test(s);
}
```

```tsx
// frontend/components/barcode/ParcelBarcode.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import bwipjs from "bwip-js";
import { isValidBarcode } from "../../lib/barcode";

export default function ParcelBarcode({ value, scale = 3 }: { value: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isValidBarcode(value)) {
      setErr(`Invalid barcode: ${value}`);
      return;
    }
    setErr(null);
    try {
      if (ref.current) {
        bwipjs.toCanvas(ref.current, { bcid: "code128", text: value, scale, height: 12, includetext: true, textxalign: "center" });
      }
    } catch (e: any) {
      setErr(e?.message ?? "Render failed");
    }
  }, [value, scale]);
  if (err) return <p role="alert">{err}</p>;
  return <canvas ref={ref} aria-label={`Barcode ${value}`} />;
}
```

```tsx
// frontend/components/barcode/LabelPreview.tsx
"use client";
import React from "react";
import ParcelBarcode from "./ParcelBarcode";

export default function LabelPreview({ businessName, orderName, parcelCode, customer, itemCount, reprint }: {
  businessName: string; orderName: string; parcelCode: string; customer?: string | null; itemCount?: number; reprint?: boolean;
}) {
  return (
    <div className="label" style={{ background: "#fff", color: "#000", padding: 24, maxWidth: 380 }}>
      {reprint && <p style={{ fontWeight: 800 }}>REPRINT</p>}
      <h3>{businessName}</h3>
      <p>Order: {orderName}</p>
      <p>Parcel: {parcelCode}</p>
      {customer && <p>Customer: {customer}</p>}
      {itemCount != null && <p>Items: {itemCount}</p>}
      <ParcelBarcode value={parcelCode} />
      <p>{parcelCode}</p>
    </div>
  );
}
```

Labels page (`app/parcels/labels/page.tsx`): fetch orders (or parcels? No list-parcels endpoint exists — use `/api/v1/orders` + per-order parcel lookup? Heavy. Better: add backend `GET /parcels` list in Task 4? No — plan §105 lists GET /parcels as minimum API. Add it HERE: `GET /api/v1/parcels?status=&page=` tenant-scoped envelope {items(id/parcel_code/barcode_value/status/order_id/order_name),total,page}. Implementer: add route in parcels.py + 1 test in test_labels.py.)
Page: today's parcels (filter created today client-side) + missing filter (status CREATED older than 1d? show all + search box) + checkboxes + Print Selected (render LabelPreview list in print-only div + window.print()) + per-row Reprint (POST reprint endpoint, show REPRINT tag).
Parcels list page (`app/parcels/page.tsx`): table Parcel/Order/Barcode/Status/Courier/AWB/Created + View/Print/Reprint (reuse lookups: courier/AWB need shipment join — backend list route: join Shipment optional per parcel (first shipment) + order name. Implement in route.)

- [ ] **Step 4: Verify**

Run: `npm test -- barcode.test` → PASS; `npx tsc --noEmit` clean. Backend: new labels tests pass.

- [ ] **Step 5: Visual check**

Open parcel detail → bwip canvas matches server PNG value; labels page → print preview one doc.

---

### Task 4: ZXing scanner + scan/rto + hub + test sheet

**Files:**
- Modify: `frontend/package.json` (+ `@zxing/browser` pinned), `frontend/app/scan/dispatch/page.tsx`, `frontend/app/scan/return/page.tsx` (camera sections)
- Create: `frontend/components/scanner/BarcodeScanner.tsx`, `frontend/components/scanner/ManualBarcodeInput.tsx`, `frontend/lib/scan-debounce.ts`, `frontend/app/scan/page.tsx`, `frontend/app/scan/rto/page.tsx`, `frontend/app/parcels/test-sheet/page.tsx`, `frontend/tests/scanner.test.tsx`

**Interfaces:**
- Consumes: @zxing/browser, scan APIs, `POST /scan/rto`
- Produces: shared camera component; 3 wired pages; hub; test sheet

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/scanner.test.tsx
import { expect, test } from "vitest";
import { shouldSuppress } from "../lib/scan-debounce";
test("debounce suppresses repeats inside window", () => {
  const t0 = 1000;
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000001", t0)).toBe(true);
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000002", t0)).toBe(false);
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000001", t0 + 5000)).toBe(false);
  expect(shouldSuppress(null, "P00000001", t0)).toBe(false);
});
```

```ts
// frontend/lib/scan-debounce.ts
export type LastScan = { value: string; at: number } | null;
export const DEBOUNCE_MS = 2500;
export function shouldSuppress(last: LastScan, value: string, now: number): boolean {
  if (!last || last.value !== value) return false;
  return now - last.at < DEBOUNCE_MS;
}
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- scanner.test`
Expected: FAIL missing modules.

- [ ] **Step 3: Minimal implementation**

```tsx
// frontend/components/scanner/BarcodeScanner.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/browser";
import { shouldSuppress, LastScan } from "../../lib/scan-debounce";

export type ScanErrorCode = "CAMERA_PERMISSION_DENIED" | "CAMERA_NOT_FOUND" | "CAMERA_NOT_READABLE" | "DECODER_ERROR" | "SCAN_TIMEOUT";

type Props = { onDetected: (v: string) => void; onError?: (code: ScanErrorCode, message: string) => void; active?: boolean };

export default function BarcodeScanner({ onDetected, onError, active = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastRef = useRef<LastScan>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!active) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const reader = new BrowserMultiFormatReader();
    async function start() {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        if (dead) return;
        setDevices(list);
        const rear = list.find((d) => /back|rear|environment/i.test(d.label)) ?? list[0];
        const chosen = deviceId ?? rear?.deviceId;
        if (!chosen) {
          fail("CAMERA_NOT_FOUND", "No camera found on this device.");
          return;
        }
        const controls = await reader.decodeFromVideoDevice(chosen, videoRef.current!, (result, err) => {
          if (result) {
            const v = result.getText();
            const now = Date.now();
            if (shouldSuppress(lastRef.current, v, now)) return;
            lastRef.current = { value: v, at: now };
            onDetectedRef.current(v);
          } else if (err && !(err instanceof NotFoundException)) {
            fail("DECODER_ERROR", String(err?.message ?? err));
          }
        });
        if (dead) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        timer = setTimeout(() => fail("SCAN_TIMEOUT", "Barcode not detected. Move closer or improve lighting."), 30000);
      } catch (e: any) {
        const n = e?.name ?? "";
        if (n === "NotAllowedError") fail("CAMERA_PERMISSION_DENIED", "Camera access was denied. Allow permission and try again.");
        else if (n === "NotFoundError") fail("CAMERA_NOT_FOUND", "No camera found on this device.");
        else if (n === "NotReadableError") fail("CAMERA_NOT_READABLE", "Camera is busy or unreadable.");
        else fail("DECODER_ERROR", e?.message ?? "Decoder error.");
      }
    }
    function fail(code: ScanErrorCode, message: string) {
      if (!dead) {
        setError(message);
        onError?.(code, message);
      }
    }
    start();
    return () => {
      dead = true;
      clearTimeout(timer);
      try { controlsRef.current?.stop(); } catch { /* ignore */ }
      const el = videoRef.current as any;
      const stream = el?.srcObject as MediaStream | undefined;
      stream?.getTracks().forEach((t) => t.stop());
      if (el) el.srcObject = null;
    };
  }, [active, deviceId, onError]);

  if (!active) return null;
  return (
    <div>
      <video ref={videoRef} muted playsInline style={{ width: "100%", maxHeight: 320, background: "#000" }} aria-label="Camera viewfinder" />
      {devices.length > 1 && (
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Camera">
          {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
        </select>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

```tsx
// frontend/components/scanner/ManualBarcodeInput.tsx
"use client";
import React, { useState } from "react";
export default function ManualBarcodeInput({ onSubmit, label }: { onSubmit: (v: string) => void; label?: string }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(""); } }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Enter barcode manually" aria-label={label ?? "Barcode manual entry"} />
      <button type="submit">Submit</button>
    </form>
  );
}
```

Dispatch/return integration: add `<BarcodeScanner active={camOn} onDetected={(v) => submitBarcode(v)} onError={...} />` + [Use camera]/[Stop] toggle + ManualBarcodeInput wired to same submit path (refactor submit to take value). RTO page: clone of return flow posting to `/scan/rto` with type fixed RTO (reuse condition buttons). Hub `/scan/page.tsx`: three big links + note. Test sheet: LabelPreview/Barcode for P00000001/02 + current parcel codes? Static P-values + print button.

- [ ] **Step 4: Verify**

Run: `npm test -- scanner.test` → PASS; `npx tsc --noEmit` clean. Camera paths are device-tested later (documented).

- [ ] **Step 5: Device checklist (document, human pilot)**

HTTPS/localhost, rear default, switch, deny → message, airplane (network error path), unmount stops track (verify via chrome://media-internals or simply no indicator light).
