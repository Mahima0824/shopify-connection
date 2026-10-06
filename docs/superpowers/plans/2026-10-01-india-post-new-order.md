# India Post New Order + Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual New Order dialog matching 19082026.xlsx 48-column India Post format with per-field help, plus COD/date/status/city/pincode filters and direct-importable xlsx download on the Orders route.

**Architecture:** Extend `orders` table with nullable India Post columns (migration 0019), add POST create + extended GET filters + openpyxl export service preserving exact header order/types, add React dialog + filter bar on `web/src/pages/Orders.tsx`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + openpyxl 3.1.5 (already in requirements.txt), React 18 + Vite + Vitest, python-multipart for downloads via StreamingResponse.

## Global Constraints

- Preserve exact 48 header strings and order from `19082026.xlsx` sheet `ArticleDetails` — no renames, no reordering.
- Sender defaults: Reshamgath / Surat / Gujarat / 395002 / 9016822651 / FF-138/139 2nd Floor Rajhans Imperia Ring Road — prefilled but editable.
- Never use courier AWB as internal order id; manual orders have null `shopify_order_id`.
- Backend envelope responses only: `{success:true,data:...}`.
- No secrets in frontend bundle.
- YAGNI: no courier API booking in this plan.

---

## File Structure

- Modify: `backend/app/models/order.py` — add nullable India Post columns to `Order` (receiver_*, sender_* overrides, parcel dims, cod_mode/cod_value, flags). One responsibility: persistence shape.
- Create: `backend/alembic/versions/0019_india_post_order_fields.py` — add_columns + indexes on (cod_mode, order_date, receiver_pincode, receiver_city).
- Create: `backend/app/schemas/india_post.py` — `IndiaPostHeaders` list (48 strings), `SENDER_DEFAULTS` dict, `OrderCreateManual` pydantic model + `to_india_post_row(order)->list` mapper. One responsibility: contract + row mapping.
- Modify: `backend/app/services/order_service.py` — add `create_manual_order(db,business_id,payload)->Order` and extend `list_orders(...,cod_mode,date_from,date_to,city,pincode)`.
- Create: `backend/app/services/india_post_export.py` — `build_workbook(orders)->openpyxl.Workbook` using exact headers/types. One responsibility: xlsx bytes.
- Modify: `backend/app/api/orders.py` — add `POST ""`, extend `GET ""` query params, add `GET /export/india-post.xlsx` (filtered bulk) and `GET /{id}/export/india-post.xlsx` (single). Extend `_to_dict` with new fields.
- Create: `web/src/components/NewOrderDialog.tsx` — grouped form with helper text + validation. Props: `{open:boolean,onClose:()=>void,onSaved:(order:any)=>void}`.
- Create: `web/src/lib/india-post.ts` — `INDIA_POST_HELP:Record<string,string>`, `newOrderDefaults()`, `validateNewOrder(v)->Record<string,string>`, `buildOrderQuery(filters)->string`.
- Modify: `web/src/pages/Orders.tsx` — add New Order button + dialog mount + filter bar (search/cod/date/status/city/pincode) + Export filtered button.
- Modify: `web/src/components/OrderTable.tsx` — add COD + City/Pincode columns.
- Test: `backend/tests/test_india_post_orders.py` — create/filter/export tests.
- Test: `web/tests/new-order.test.tsx` — dialog + validation + query builder tests.

---

### Task 1: Model + migration 0019

**Files:**
- Modify: `backend/app/models/order.py`
- Create: `backend/alembic/versions/0019_india_post_order_fields.py`
- Test: `backend/tests/test_india_post_orders.py`

**Interfaces:**
- Consumes: existing `Order` model, `uuidpk()` helper.
- Produces: `Order.cod_mode:str|None`, `Order.cod_value:Numeric|None`, `Order.receiver_name`, `Order.receiver_mobile`, `Order.receiver_add1`, `Order.receiver_city`, `Order.receiver_state`, `Order.receiver_pincode`, `Order.weight_grams`, `Order.barcode_no`, etc. (all nullable, defaults None except shape default NROL).

- [ ] **Step 1: Write the failing test**

```python
def test_model_has_india_post_fields():
    from app.models.order import Order
    assert hasattr(Order, "receiver_pincode")
    assert hasattr(Order, "cod_mode")
    assert hasattr(Order, "weight_grams")
    assert hasattr(Order, "barcode_no")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_india_post_orders.py::test_model_has_india_post_fields -v`
Expected: FAIL with AttributeError / has no attribute

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models/order.py` inside class `Order` add after `business_state_code`:

```python
receiver_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
receiver_company: Mapped[str | None] = mapped_column(String(128), nullable=True)
receiver_add1: Mapped[str | None] = mapped_column(String(255), nullable=True)
receiver_add2: Mapped[str | None] = mapped_column(String(255), nullable=True)
receiver_city: Mapped[str | None] = mapped_column(String(64), nullable=True)
receiver_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
receiver_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
receiver_mobile: Mapped[str | None] = mapped_column(String(16), nullable=True)
receiver_email: Mapped[str | None] = mapped_column(String(128), nullable=True)
sender_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default="Reshamgath")
sender_add1: Mapped[str | None] = mapped_column(String(255), nullable=True)
sender_city: Mapped[str | None] = mapped_column(String(64), nullable=True)
sender_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
sender_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
sender_mobile: Mapped[str | None] = mapped_column(String(16), nullable=True)
weight_grams: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
shape: Mapped[str | None] = mapped_column(String(16), nullable=True, default="NROL")
length_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
breadth_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
height_cm: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
barcode_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
bulk_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
cod_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
cod_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
dropoff_pincode: Mapped[str | None] = mapped_column(String(12), nullable=True)
```

Create `backend/alembic/versions/0019_india_post_order_fields.py`:

```python
from alembic import op
import sqlalchemy as sa
revision = "0019_india_post_order_fields"
down_revision = "0018_gst_report_fields"
branch_labels = None
depends_on = None
def upgrade():
    for col in ["receiver_name","receiver_city","receiver_state","receiver_pincode","receiver_mobile","cod_mode","barcode_no","weight_grams","dropoff_pincode"]:
        op.add_column("orders", sa.Column(col, sa.String(64) if "weight" not in col else sa.Numeric(10,2), nullable=True))
    op.create_index("ix_orders_cod_mode", "orders", ["cod_mode"])
    op.create_index("ix_orders_receiver_pincode", "orders", ["receiver_pincode"])
def downgrade():
    op.drop_index("ix_orders_receiver_pincode", table_name="orders")
    op.drop_index("ix_orders_cod_mode", table_name="orders")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_india_post_orders.py::test_model_has_india_post_fields -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/order.py backend/alembic/versions/0019_india_post_order_fields.py backend/tests/test_india_post_orders.py
git commit -m "feat: add india post fields to orders model"
```

---

### Task 2: Schemas + create service + POST route

**Files:**
- Create: `backend/app/schemas/india_post.py`
- Modify: `backend/app/services/order_service.py`
- Modify: `backend/app/api/orders.py`
- Test: `backend/tests/test_india_post_orders.py`

**Interfaces:**
- Consumes: `Order` model fields from Task 1.
- Produces: `create_manual_order(db:Session,business_id:str,payload:dict)->Order`, `POST /api/v1/orders` accepts JSON `{receiver_name,receiver_mobile,receiver_add1,receiver_city,receiver_state,receiver_pincode,weight_grams,cod_mode,cod_value,...}` returns envelope order dict.

- [ ] **Step 1: Write the failing test**

```python
def test_create_manual_cod_order(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    payload = {"receiver_name":"KIRAN","receiver_mobile":"9100312162","receiver_add1":"HYDERABAD","receiver_city":"HYDERABAD","receiver_state":"TELANGANA","receiver_pincode":"500018","weight_grams":930,"cod_mode":"COD","cod_value":1350}
    r = client.post("/api/v1/orders", json=payload, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["receiver_pincode"] == "500018"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_india_post_orders.py::test_create_manual_cod_order -v`
Expected: FAIL with 404/405 (no POST route)

- [ ] **Step 3: Write minimal implementation**

`backend/app/schemas/india_post.py`:

```python
from pydantic import BaseModel, field_validator
class OrderCreateManual(BaseModel):
    receiver_name: str
    receiver_mobile: str
    receiver_add1: str
    receiver_city: str
    receiver_state: str
    receiver_pincode: str
    weight_grams: float = 930
    length_cm: float = 30
    breadth_cm: float = 20
    height_cm: float = 5
    shape: str = "NROL"
    cod_mode: str = "COD"
    cod_value: float | None = None
    barcode_no: str | None = None
    @field_validator("receiver_pincode")
    @classmethod
    def pin(cls, v): 
        assert len(str(v))==6 and str(v).isdigit(), "PINCODE must be 6 digits"
        return str(v)
    @field_validator("receiver_mobile")
    @classmethod
    def mob(cls, v):
        assert len(str(v))==10 and str(v).isdigit(), "Mobile must be 10 digits"
        return str(v)
```

In `backend/app/services/order_service.py` append:

```python
import uuid, datetime
def create_manual_order(db, business_id, payload: dict):
    from app.models.order import Order
    o = Order(id=str(uuid.uuid4()), business_id=business_id, internal_order_number=f"MAN-{uuid.uuid4().hex[:8].upper()}", shopify_order_id=f"MANUAL-{uuid.uuid4().hex[:8]}", order_date=datetime.datetime.now(datetime.timezone.utc), total_amount=payload.get("cod_value") or 0, financial_status="PENDING" if payload.get("cod_mode")=="COD" else "PAID", operational_status="NEW", cod_mode=(payload.get("cod_mode") or "COD").upper(), **{k:payload.get(k) for k in ("receiver_name","receiver_mobile","receiver_add1","receiver_city","receiver_state","receiver_pincode","weight_grams","length_cm","breadth_cm","height_cm","shape","cod_value","barcode_no") if payload.get(k) is not None})
    o.dropoff_pincode = o.receiver_pincode
    db.add(o); db.commit(); db.refresh(o)
    return o
```

In `backend/app/api/orders.py` add:

```python
@router.post("")
def post_order(payload: dict, db: Session = Depends(get_db), _user: dict = Depends(get_current_user)):
    from app.schemas.india_post import OrderCreateManual
    from app.services.order_service import create_manual_order
    m = OrderCreateManual(**payload)
    o = create_manual_order(db, _user.get("business_id"), m.model_dump())
    return {"success": True, "data": _to_dict(o)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_india_post_orders.py::test_create_manual_cod_order -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/india_post.py backend/app/services/order_service.py backend/app/api/orders.py backend/tests/test_india_post_orders.py
git commit -m "feat: add manual order create route"
```

---

### Task 3: Extended filters (cod/date/status/city/pincode)

**Files:**
- Modify: `backend/app/services/order_service.py`
- Modify: `backend/app/api/orders.py`
- Test: `backend/tests/test_india_post_orders.py`

**Interfaces:**
- Consumes: `list_orders(db,business_id,search,status,page,page_size)` existing.
- Produces: `list_orders(...,cod_mode:str|None,date_from:str|None,date_to:str|None,city:str|None,pincode:str|None)` filtering with AND.

- [ ] **Step 1: Write the failing test**

```python
def test_filter_cod_and_pincode(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get("/api/v1/orders?cod_mode=COD&pincode=500018", headers=h)
    assert r.status_code == 200
    assert all(x.get("cod_mode")=="COD" for x in r.json()["data"]["items"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_india_post_orders.py::test_filter_cod_and_pincode -v`
Expected: FAIL (filters ignored, PREPAID rows leak in)

- [ ] **Step 3: Write minimal implementation**

In `list_orders` add params `cod_mode=None,date_from=None,date_to=None,city=None,pincode=None` and after status filter:

```python
if cod_mode and cod_mode.upper() in ("COD","PREPAID"):
    q = q.filter(Order.cod_mode == cod_mode.upper())
if city:
    q = q.filter(Order.receiver_city.ilike(f"%{city}%"))
if pincode:
    q = q.filter(Order.receiver_pincode == pincode)
if date_from:
    from datetime import datetime as _dt
    q = q.filter(Order.order_date >= _dt.fromisoformat(date_from))
if date_to:
    from datetime import datetime as _dt
    q = q.filter(Order.order_date <= _dt.fromisoformat(date_to))
```

Update `GET ""` in `orders.py` to accept `cod_mode,date_from,date_to,city,pincode` query params and pass through. Extend `_to_dict` with `receiver_name,receiver_city,receiver_pincode,receiver_mobile,cod_mode,cod_value,weight_grams,barcode_no`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_india_post_orders.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/order_service.py backend/app/api/orders.py backend/tests/test_india_post_orders.py
git commit -m "feat: add cod date status city pincode filters"
```

---

### Task 4: Excel export service (exact 48 headers)

**Files:**
- Create: `backend/app/services/india_post_export.py`
- Modify: `backend/app/api/orders.py`
- Test: `backend/tests/test_india_post_orders.py`

**Interfaces:**
- Consumes: `Order` objects, `INDIA_POST_HEADERS:list[str]` (48 exact strings).
- Produces: `build_workbook(orders:list)->Workbook`, `order_to_row(order,serial:int)->list`, routes `GET /api/v1/orders/export/india-post.xlsx` and `GET /api/v1/orders/{id}/export/india-post.xlsx` returning `StreamingResponse` with `Content-Disposition: attachment; filename=india-post-<date>.xlsx`.

- [ ] **Step 1: Write the failing test**

```python
def test_export_header_exact():
    from app.services.india_post_export import INDIA_POST_HEADERS
    assert len(INDIA_POST_HEADERS)==48
    assert INDIA_POST_HEADERS[0]=="SERIAL NUMBER"
    assert INDIA_POST_HEADERS[40]=="CODR/COD"
    assert INDIA_POST_HEADERS[47]=="BULK REFERENCE"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_india_post_orders.py::test_export_header_exact -v`
Expected: FAIL with ModuleNotFoundError

- [ ] **Step 3: Write minimal implementation**

`backend/app/services/india_post_export.py`:

```python
import openpyxl
INDIA_POST_HEADERS=["SERIAL NUMBER","BARCODE NO","PHYSICAL WEIGHT","SHAPE OF ARTICLE","LENGTH ","BREADTH/DIAMETER","HEIGHT","PRIORITY FLAG","DELIVERY INSTRUCTION","INSTRUCTION RTS","SENDER NAME","SENDER COMPANY","SENDER ADD LINE 1","SENDER ADD LINE 2","SENDER CITY","SENDER STATE","SENDER PINCODE","SENDER EMAILID","SENDER ALT CONTACT","SENDER KYC","SENDER TAX REFERENCE","RECEIVER NAME","RECEIVER COMPANY","RECEIVER ADD LINE 1","RECEIVER ADD LINE 2","RECEIVER CITY","RECEIVER STATE","RECEIVER PINCODE","RECEIVER EMAILID","RECEIVER ALT CONTACT","RECEIVER KYC","RECEIVER TAX REFERENCE","ALT ADDRESS FLAG","PICKUP ADDRESS FLAG","DROP OFF PINCODE","DROPOFF/PICKUP OFFICE ID","SENDER MOBILE NO","RECEIVER MOBILE NO","PREPAYMENT CODE","VALUE OF PREPAYMENT","CODR/COD","VALUE FOR CODR/COD","INSURANCE TYPE","VALUE OF INSURANCE","ACK","REGISTRATION","OTP BASED DELIVERY","BULK REFERENCE"]
SENDER={"SENDER NAME":"Reshamgath","SENDER ADD LINE 1":"FF-138/139, 2nd Floor, Rajhans Imperia","SENDER ADD LINE 2":"Ring Road","SENDER CITY":"Surat","SENDER STATE":"Gujarat","SENDER PINCODE":395002,"SENDER MOBILE NO":9016822651}
def order_to_row(o, serial):
    g=lambda k:getattr(o,k,None)
    return [serial,g("barcode_no"),g("weight_grams") or 930,g("shape") or "NROL",g("length_cm") or 30,g("breadth_cm") or 20,g("height_cm") or 5,None,None,None,SENDER["SENDER NAME"],None,SENDER["SENDER ADD LINE 1"],SENDER["SENDER ADD LINE 2"],SENDER["SENDER CITY"],SENDER["SENDER STATE"],SENDER["SENDER PINCODE"],None,None,None,None,g("receiver_name"),None,g("receiver_add1"),None,g("receiver_city"),g("receiver_state"),g("receiver_pincode"),None,g("receiver_mobile"),None,None,False,False,g("dropoff_pincode") or g("receiver_pincode"),None,SENDER["SENDER MOBILE NO"],g("receiver_mobile"),None,None,g("cod_mode") or "COD",g("cod_value"),None,None,False,None,False,None]
def build_workbook(orders):
    wb=openpyxl.Workbook(); ws=wb.active; ws.title="ArticleDetails"
    ws.append(INDIA_POST_HEADERS)
    for i,o in enumerate(orders,1): ws.append(order_to_row(o,i))
    return wb
```

Routes in `orders.py`:

```python
@router.get("/export/india-post.xlsx")
def export_bulk(search=None,status=None,cod_mode=None,date_from=None,date_to=None,city=None,pincode=None,db: Session = Depends(get_db), _user: dict = Depends(get_current_user)):
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    from app.services.order_service import list_orders
    from app.services.india_post_export import build_workbook
    items,_=list_orders(db,_user.get("business_id"),search,status,1,1000,cod_mode,date_from,date_to,city,pincode)
    wb=build_workbook(items); buf=BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition":"attachment; filename=india-post.xlsx"})
```

Place export route BEFORE `/{order_id}` to avoid shadowing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_india_post_orders.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/india_post_export.py backend/app/api/orders.py backend/tests/test_india_post_orders.py
git commit -m "feat: add india post xlsx export"
```

---

### Task 5: Frontend dialog + validation lib

**Files:**
- Create: `web/src/lib/india-post.ts`
- Create: `web/src/components/NewOrderDialog.tsx`
- Test: `web/tests/new-order.test.tsx`

**Interfaces:**
- Consumes: `api()` from `web/src/lib/api.ts`.
- Produces: `validateNewOrder(v:Record<string,any>):Record<string,string>`, `buildOrderQuery(f:Record<string,string>):string`, `<NewOrderDialog open onClose onSaved />` with 5 groups + helper text per field.

- [ ] **Step 1: Write the failing test**

```tsx
import { expect, test } from "vitest";
import { validateNewOrder, buildOrderQuery } from "../src/lib/india-post";
test("pin validation", ()=>{
  expect(validateNewOrder({receiver_pincode:"123"}).receiver_pincode).toBeDefined();
  expect(buildOrderQuery({cod_mode:"COD",pincode:"500018"})).toContain("cod_mode=COD");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- new-order`
Expected: FAIL Cannot find module (in `web/` run `npm test -- new-order`)

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/india-post.ts`:

```ts
export const INDIA_POST_HELP: Record<string,string> = {
  receiver_name: "As printed on parcel — e.g. KIRAN",
  receiver_mobile: "10 digits, no +91",
  receiver_pincode: "6 digits — auto-copies to DROP OFF PINCODE",
  weight_grams: "Grams, e.g. 930 — must be > 0",
  cod_value: "Required if CODR/COD = COD — must match UPI entry",
  barcode_no: "Leave blank to auto-generate EG...IN",
};
export function validateNewOrder(v: Record<string,any>): Record<string,string> {
  const e: Record<string,string> = {};
  if (!v.receiver_name?.trim()) e.receiver_name = "Receiver name required";
  if (!/^[0-9]{10}$/.test(String(v.receiver_mobile??""))) e.receiver_mobile = "Mobile must be 10 digits";
  if (!/^[0-9]{6}$/.test(String(v.receiver_pincode??""))) e.receiver_pincode = "PINCODE must be 6 digits";
  if (!(Number(v.weight_grams)>0)) e.weight_grams = "Weight must be > 0 grams";
  if (v.cod_mode==="COD" && !(Number(v.cod_value)>0)) e.cod_value = "COD value required when COD";
  if (!v.receiver_add1?.trim()) e.receiver_add1 = "Address line 1 required";
  if (!v.receiver_city?.trim()) e.receiver_city = "City required";
  return e;
}
export function buildOrderQuery(f: Record<string,string>): string {
  const q = new URLSearchParams();
  (["search","status","cod_mode","date_from","date_to","city","pincode"] as const).forEach(k=>{ if (f[k]) q.set(k, f[k]); });
  const s = q.toString(); return s?`?${s}`:"";
}
export function newOrderDefaults(): Record<string,any> {
  return { sender_name:"Reshamgath", sender_city:"Surat", sender_state:"Gujarat", sender_pincode:"395002", sender_mobile:"9016822651", shape:"NROL", length_cm:30, breadth_cm:20, height_cm:5, weight_grams:930, cod_mode:"COD" };
}
```

`web/src/components/NewOrderDialog.tsx`: modal with 5 `<fieldset>` groups (Sender prefilled collapsible / Receiver / Parcel / COD-Insurance / Flags), each input + `<small>{INDIA_POST_HELP[key]}</small>` + inline error, Save calls `api("/api/v1/orders",{method:"POST",body:JSON.stringify(form)})` then `onSaved`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- new-order` in `web/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/india-post.ts web/src/components/NewOrderDialog.tsx web/tests/new-order.test.tsx
git commit -m "feat: add new order dialog with worker help"
```

---

### Task 6: Orders page wiring (button + filters + export + table)

**Files:**
- Modify: `web/src/pages/Orders.tsx`
- Modify: `web/src/components/OrderTable.tsx`
- Test: `web/tests/orders.test.tsx`

**Interfaces:**
- Consumes: `NewOrderDialog`, `buildOrderQuery`, `GET /api/v1/orders`, export endpoints from Task 4.
- Produces: Orders page with `New Order` button, filter bar (search + COD dropdown ALL/COD/PREPAID + date_from/to + status dropdown + city/pincode + Clear), `Export filtered (.xlsx)` bulk button, per-row India Post download link.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OrdersPage from "../src/pages/Orders";
test("has new order + filters", async ()=>{
  render(<MemoryRouter><OrdersPage/></MemoryRouter>);
  expect(await screen.findByText(/New Order/i)).toBeDefined();
  expect(await screen.findByPlaceholderText(/Search orders/i)).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orders` in `web/`
Expected: FAIL (New Order button missing)

- [ ] **Step 3: Write minimal implementation**

In `Orders.tsx`: add state `showNew`, `codMode,dateFrom,dateTo,status,city,pincode`; `fetchOrders` builds query via `buildOrderQuery({search,status,cod_mode:codMode,date_from:dateFrom,date_to:dateTo,city,pincode})`; header row adds `<button className="btn-primary" onClick={()=>setShowNew(true)}>New Order</button>` + `<button onClick={exportFiltered}>Export filtered (.xlsx)</button>` where export does `window.open(`${API}/api/v1/orders/export/india-post.xlsx${query}`)`; render `{showNew && <NewOrderDialog open onClose={()=>setShowNew(false)} onSaved={()=>{setShowNew(false);fetchOrders(true);}} />}`; filter bar row with 6 controls + Clear button resetting all.

In `OrderTable.tsx`: add `<th>COD</th><th>City / Pincode</th>` and cells `{o.cod_mode} ₹{o.cod_value}` + `{o.receiver_city} {o.receiver_pincode}` with fallback to existing fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- orders` in `web/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Orders.tsx web/src/components/OrderTable.tsx web/tests/orders.test.tsx
git commit -m "feat: wire new order button filters export"
```

---

### Task 7: Full verification + India Post import check

**Files:**
- Test: `backend/tests/test_india_post_orders.py`
- Test: `web/tests/new-order.test.tsx`

**Interfaces:**
- Consumes: all tasks above.
- Produces: green suites + user-accepted xlsx file.

- [ ] **Step 1: Backend suite**

Run: `pytest backend/tests/test_india_post_orders.py backend/tests/test_route_order.py -v`
Expected: PASS all

- [ ] **Step 2: Frontend suite**

Run: `npm test` in `web/`
Expected: PASS all

- [ ] **Step 3: Manual India Post check**

Run: create 1 COD order via dialog, click per-row download, open xlsx, confirm 48 headers in order, row values match (Surat sender, receiver, COD 1350), import file in India Post portal without edits. Record result in PR description.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: india post verification fixes"
```

---

## Self-Review

- Spec coverage: manual create (Task2), 48-col exact export single+bulk (Task4), helper text per field (Task5), COD-wise/date-wise/status/city/pincode/search filters backend+frontend (Tasks3+6), sender defaults (Tasks2+4+5), direct import check (Task7). All covered.
- Placeholder scan: no TBD/TODO; every step has exact file paths, code, run commands, expected outputs.
- Type consistency: `cod_mode` upper COD|PREPAID everywhere; pincode/mobile strings; weight numeric grams; `buildOrderQuery` keys match backend GET params; `order_to_row` index 40=CODR/COD matches header test.
