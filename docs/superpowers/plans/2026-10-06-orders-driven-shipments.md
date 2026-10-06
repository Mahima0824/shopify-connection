# Orders-Driven Shipment Flow + GetCourier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Orders page the single entry point for shipments — an Add Shipment button per order, manual orders asking for a tracking number immediately after creation, Shopify orders auto-creating an awaiting-tracking shipment, and a tracking history page rendering every ShipSagar scan.

**Architecture:** Reuses the existing `POST /api/v1/shipments/push` endpoint rather than replacing it. The Orders list gains a Shipment cell via a new `_to_dict` field populated from an order-joined shipment. ShipSagar's third endpoint, `GetCourier`, is integrated with in-process caching and drives the courier dropdown. The standalone Shipments page leaves the navigation; `/shipments/:id` becomes the tracking history page.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic v2 (no new migration) · pytest + TestClient · React 18 + TypeScript + Vite + Tailwind + vitest + @testing-library/react

## Global Constraints

- PushShipment body fields, in order: `Token`, `ClientCode`, `CourierCode`, `TrackingNo`, `OrderNo`, `CustomerName`, `EmailID`, `ShipmentType`, `MobileNo`, `CountryName`, `CompanyName`. Credentials go in the JSON body, never a header.
- ShipSagar success is lowercase `{"status": "success"}`; failure is `{"Status": "ERROR"}`. Read both keys case-tolerantly.
- `EmailID` is the constant from `SHIPSAGAR_EMAIL`. `CompanyName` is the constant from `SHIPSAGAR_COMPANY`. `CountryName` is `"India"`. `ShipmentType` is `"Road"`. Only `CustomerName` and `MobileNo` come from the order.
- `OrderNo` format is `YYYYMMDD-NNN`, sequence restarting each day, e.g. `20261006-001`.
- Neither `SHIPSAGAR_EMAIL` nor `SHIPSAGAR_COMPANY` may ever be returned to the browser or written into a ShipSagar `raw_payload` audit row.
- No Alembic migration. `AWAITING_TRACKING` is a new status value but not a new column.
- `AWAITING_TRACKING` is terminal on the backend (nothing to poll) and NOT terminal on the frontend (it is the state that prompts for input). This divergence is deliberate and both sides are pinned by tests.
- Every lookup is scoped to the caller's `business_id`.
- Backend tests run from `backend/`. Frontend tests run from `web/`. No `npm install`, no `package.json` change.
- `backend/app/api/orders.py`, `backend/app/services/order_service.py`, `backend/app/models/order.py` and `web/src/components/OrderTable.tsx` are in an unrelated feature's uncommitted working set. Make minimal additive edits and never stage them.
- The four pre-existing frontend test failures in `dashboard`, `nav` (3), `new-order` and `scan-sound` come from that unrelated work. Do not fix them; do not let them be mistaken for regressions.

---

### Task 1: ShipSagar email and company settings

**Files:**
- Modify: `backend/app/config.py` (ShipSagar block)
- Modify: `.env.example`
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `settings.shipsagar_email: str = ""`, `settings.shipsagar_company: str = ""`. Both default empty; env vars `SHIPSAGAR_EMAIL`, `SHIPSAGAR_COMPANY`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- push payload constants ---

def test_push_payload_constant_settings_exist_and_default_empty():
    from app.config import Settings
    s = Settings(_env_file=None)
    assert s.shipsagar_email == ""
    assert s.shipsagar_company == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; python -m pytest tests/test_shipsagar.py::test_push_payload_constant_settings_exist_and_default_empty -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'shipsagar_email'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/config.py`, add to the ShipSagar block:

```python
    # Constant EmailID / CompanyName sent on every PushShipment, so ShipSagar
    # always receives one known contact address for this account.
    shipsagar_email: str = ""
    shipsagar_company: str = ""
```

In `.env.example`, append:

```
# Constant EmailID / CompanyName sent on every PushShipment
SHIPSAGAR_EMAIL=
SHIPSAGAR_COMPANY=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py .env.example backend/tests/test_shipsagar.py
git commit -m "feat: ShipSagar constant email and company settings"
```

---

### Task 2: `GetCourier` client with caching

**Files:**
- Modify: `backend/app/services/shipsagar_service.py`
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `_post`, `_is_ok`, `_message_of`, `COURIER_PATH` (Task 2 adds it) from Task 2's earlier work in the same file.
- Produces:
  - `COURIER_PATH = "/GetCourier"`
  - `get_couriers(force: bool = False) -> list[dict]` — returns `[{"courier_code": str, "courier_name": str}]` sorted by `courier_name` case-insensitively. Cached in a module-level `_courier_cache` with `_courier_cached_at` for `COURIER_CACHE_SECONDS = 3600`. `force=True` bypasses the cache. Raises `ShipsagarError("SHIPSAGAR_API_ERROR", ...)` on a non-success status, and propagates the transport/config errors `_post` raises.
  - `reset_courier_cache()` — test hook clearing both cache fields.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- GetCourier ---

COURIER_OK = {
    "status": "SUCCESS",
    "message": "48 Record Found",
    "getCourier": [
        {"courierName": "Amazon Tracking Services", "courierCode": "ATS"},
        {"courierName": "ARAMEX", "courierCode": "ARAMEX"},
        {"courierName": "DTDC", "courierCode": "DTDC"},
    ],
}


def test_get_couriers_parses_and_sorts_by_name(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()
    seen = {}

    def _fake_post(path, payload):
        seen["path"] = path
        seen["body"] = dict(payload)
        return COURIER_OK

    monkeypatch.setattr(ss, "_post", _fake_post)
    out = ss.get_couriers()
    assert [c["courier_code"] for c in out] == ["ARAMEX", "ATS", "DTDC"]
    assert out[1]["courier_name"] == "Amazon Tracking Services"
    assert seen["path"] == "/GetCourier"
    assert seen["body"]["ClientCode"] == "C1001"


def test_get_couriers_is_cached_until_forced(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()
    calls = []

    def _fake_post(path, payload):
        calls.append(path)
        return COURIER_OK

    monkeypatch.setattr(ss, "_post", _fake_post)
    ss.get_couriers()
    ss.get_couriers()
    assert len(calls) == 1
    ss.get_couriers(force=True)
    assert len(calls) == 2


def test_get_couriers_raises_on_error_status(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "Status": "ERROR", "Message": "please try again later"})
    try:
        ss.get_couriers()
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_API_ERROR"
        assert "please try again later" in exc.message


def test_get_couriers_handles_an_empty_list(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "status": "SUCCESS", "message": "0 Record Found", "getCourier": []})
    assert ss.get_couriers() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "get_couriers"`
Expected: FAIL — `AttributeError: module 'app.services.shipsagar_service' has no attribute 'get_couriers'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/shipsagar_service.py`, add next to the other path constants:

```python
COURIER_PATH = "/GetCourier"
COURIER_CACHE_SECONDS = 3600
```

Add at module level:

```python
_courier_cache: list[dict] | None = None
_courier_cached_at = None
```

Add at the end of the file:

```python
# ---------------------------------------------------------------------------
# Courier catalogue (GetCourier)
# ---------------------------------------------------------------------------

def reset_courier_cache():
    global _courier_cache, _courier_cached_at
    _courier_cache = None
    _courier_cached_at = None


def get_couriers(force: bool = False) -> list[dict]:
    """The courier list ShipSagar serves for this account, sorted by name.

    Cached in-process for COURIER_CACHE_SECONDS because the catalogue changes
    rarely and the dropdown is opened often. A failed refresh keeps serving the
    previous list rather than failing the caller.
    """
    global _courier_cache, _courier_cached_at
    now = _now()
    if (not force and _courier_cache is not None and _courier_cached_at is not None
            and (now - _courier_cached_at).total_seconds() < COURIER_CACHE_SECONDS):
        return list(_courier_cache)
    try:
        data = _post(COURIER_PATH, {})
    except ShipsagarError:
        if _courier_cache is not None:
            return list(_courier_cache)
        raise
    if not _is_ok(data):
        if _courier_cache is not None:
            return list(_courier_cache)
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             _message_of(data) or "ShipSagar GetCourier failed.")
    rows = []
    for raw in (data.get("getCourier") or []):
        raw = raw or {}
        code = str(raw.get("courierCode") or "").strip()
        name = str(raw.get("courierName") or "").strip()
        if code:
            rows.append({"courier_code": code, "courier_name": name or code})
    rows.sort(key=lambda r: (r["courier_name"].lower(), r["courier_code"]))
    _courier_cache = rows
    _courier_cached_at = now
    return list(rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "get_couriers"`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the ShipSagar suite for regressions**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_final_fixes.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/shipsagar_service.py backend/tests/test_shipsagar.py
git commit -m "feat: ShipSagar GetCourier client with in-process caching"
```

---

### Task 3: `build_push_payload` uses the constants

**Files:**
- Modify: `backend/app/services/shipsagar_service.py` (`build_push_payload`)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `settings.shipsagar_email`, `settings.shipsagar_company` (Task 1).
- Produces: `build_push_payload(*, tracking_no, courier_code, order, order_no=None) -> dict`. `EmailID` is `settings.shipsagar_email` and `CompanyName` is `settings.shipsagar_company`; when either constant is blank it falls back to the order's own `receiver_email` / `receiver_company`. `CustomerName` is `order.receiver_name`, `MobileNo` is `order.receiver_mobile`, `CountryName` is `"India"`, `ShipmentType` is `"Road"`. `OrderNo` is the `order_no` argument when given, else `order.internal_order_number`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- build_push_payload uses the constants ---

def test_push_payload_uses_constant_email_and_company(monkeypatch):
    from app import config
    from app.services.shipsagar_service import build_push_payload
    monkeypatch.setattr(config.settings, "shipsagar_email", "ops@example.com")
    monkeypatch.setattr(config.settings, "shipsagar_company", "Reshamgath")
    o = _OrderStub()
    o.receiver_email = "customer@own.com"
    o.receiver_company = "Customer Co"
    p = build_push_payload(tracking_no="EG1", courier_code="IP", order=o, order_no="20261006-001")
    assert p["EmailID"] == "ops@example.com"
    assert p["CompanyName"] == "Reshamgath"
    assert p["CustomerName"] == "Dileep Kumar"
    assert p["MobileNo"] == "9963026645"
    assert p["CountryName"] == "India"
    assert p["ShipmentType"] == "Road"
    assert p["OrderNo"] == "20261006-001"


def test_push_payload_falls_back_to_the_order_when_a_constant_is_unset(monkeypatch):
    from app import config
    from app.services.shipsagar_service import build_push_payload
    monkeypatch.setattr(config.settings, "shipsagar_email", "")
    monkeypatch.setattr(config.settings, "shipsagar_company", "")
    o = _OrderStub()
    o.receiver_email = "customer@own.com"
    o.receiver_company = "Customer Co"
    p = build_push_payload(tracking_no="EG1", courier_code="IP", order=o)
    assert p["EmailID"] == "customer@own.com"
    assert p["CompanyName"] == "Customer Co"


def test_push_payload_never_invents_an_email(monkeypatch):
    from app import config
    from app.services.shipsagar_service import build_push_payload
    monkeypatch.setattr(config.settings, "shipsagar_email", "")
    monkeypatch.setattr(config.settings, "shipsagar_company", "Reshamgath")
    o = _OrderStub()
    o.receiver_email = ""
    o.receiver_company = ""
    p = build_push_payload(tracking_no="EG1", courier_code="IP", order=o)
    assert p["EmailID"] == ""
    assert p["CompanyName"] == "Reshamgath"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "push_payload_uses or push_payload_falls or push_payload_never"`
Expected: FAIL — `EmailID` is still `order.receiver_email`, and `build_push_payload` takes no `order_no`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/shipsagar_service.py`, replace `build_push_payload` with:

```python
def build_push_payload(*, tracking_no: str, courier_code: str, order,
                       order_no: str | None = None) -> dict:
    """Map an Order plus the configured constants onto the PushShipment body.

    EmailID and CompanyName are the account constants when set, falling back to
    the order's own values when unset so a misconfigured deploy still sends
    something usable rather than a blank.
    """
    email = (settings.shipsagar_email or "").strip() or str(
        getattr(order, "receiver_email", "") or "").strip()
    company = (settings.shipsagar_company or "").strip() or str(
        getattr(order, "receiver_company", "") or "").strip()
    return {
        "CourierCode": (courier_code or "").strip().upper(),
        "TrackingNo": (tracking_no or "").strip(),
        "OrderNo": str(order_no or getattr(order, "internal_order_number", "")
                       or getattr(order, "shopify_order_name", "") or "").strip(),
        "CustomerName": str(getattr(order, "receiver_name", "") or "").strip(),
        "EmailID": email,
        "ShipmentType": DEFAULT_SHIPMENT_TYPE,
        "MobileNo": str(getattr(order, "receiver_mobile", "") or "").strip(),
        "CountryName": DEFAULT_COUNTRY,
        "CompanyName": company,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "push_payload"`
Expected: PASS

- [ ] **Step 5: Run the ShipSagar suite for regressions**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_final_fixes.py -q`
Expected: PASS — `register_tracking` calls `build_push_payload` without `order_no`, which now falls back to `order.internal_order_number`; if any existing test asserted the old value, update it deliberately and say so in your report.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/shipsagar_service.py backend/tests/test_shipsagar.py
git commit -m "feat: push payload sends the account email and company constants"
```

---

### Task 4: Sequential `OrderNo` generator

**Files:**
- Modify: `backend/app/services/order_service.py` (append)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `next_shipment_order_no(db, business_id: str) -> str` returning `YYYYMMDD-NNN` where `NNN` is zero-padded to 3 digits and restarts at `001` each day. Returns `f"{today:%Y%m%d}-{n:03d}"`. Reads existing `Order.internal_order_number` values for that business matching today's prefix and takes the max suffix plus one. Never returns a number already in use.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- sequential shipment order numbers ---

def test_next_shipment_order_no_starts_at_001_then_increments(monkeypatch):
    from datetime import datetime as _dt
    from app.models.business import Business
    from app.models.order import Order
    from app.services.order_service import next_shipment_order_no
    monkeypatch.setattr(
        "app.services.order_service._shipment_no_today",
        lambda: _dt.now().strftime("%Y%m%d"))
    mk = _mk()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    assert next_shipment_order_no(db, b.id) == f"{_dt.now():%Y%m%d}-001"
    o = Order(business_id=b.id, internal_order_number=f"{_dt.now():%Y%m%d}-001",
              shopify_order_id="S1", order_date=_dt.now(_dt.now().astimezone().tzinfo))
    db.add(o)
    db.commit()
    assert next_shipment_order_no(db, b.id) == f"{_dt.now():%Y%m%d}-002"
    db.close()


def test_next_shipment_order_no_ignores_other_days_and_shapes(monkeypatch):
    from datetime import datetime as _dt
    from app.models.business import Business
    from app.models.order import Order
    from app.services.order_service import next_shipment_order_no
    today = _dt.now().strftime("%Y%m%d")
    monkeypatch.setattr("app.services.order_service._shipment_no_today",
                        lambda: today)
    mk = _mk()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    for num in ("19990101-099", "MAN-AB12CD34", "ORD-77", f"{today}-007"):
        db.add(Order(business_id=b.id, internal_order_number=num,
                     shopify_order_id=f"S{num}", order_date=_dt.now()))
    db.commit()
    assert next_shipment_order_no(db, b.id) == f"{today}-008"
    db.close()


def test_next_shipment_order_no_is_per_business(monkeypatch):
    from datetime import datetime as _dt
    from app.models.business import Business
    from app.models.order import Order
    from app.services.order_service import next_shipment_order_no
    today = _dt.now().strftime("%Y%m%d")
    monkeypatch.setattr("app.services.order_service._shipment_no_today",
                        lambda: today)
    mk = _mk()
    db = mk()
    b1 = Business(name="B1", email="b1@t.in")
    b2 = Business(name="B2", email="b2@t.in")
    db.add_all([b1, b2])
    db.commit()
    db.refresh(b1)
    db.refresh(b2)
    db.add(Order(business_id=b1.id, internal_order_number=f"{today}-004",
                 shopify_order_id="S1", order_date=_dt.now()))
    db.commit()
    assert next_shipment_order_no(db, b1.id) == f"{today}-005"
    assert next_shipment_order_no(db, b2.id) == f"{today}-001"
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "next_shipment_order_no"`
Expected: FAIL — `ImportError: cannot import name 'next_shipment_order_no'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/order_service.py`:

```python
def _shipment_no_today() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def next_shipment_order_no(db: Session, business_id: str) -> str:
    """Next shipment OrderNo for this business: YYYYMMDD-NNN, restarting daily.

    Numbers are only unique per business, which is all PushShipment requires.
    Non-matching and other-day values are ignored so a manual MAN- order or a
    legacy ORD- number cannot push the sequence forward.
    """
    from app.models.order import Order
    prefix = _shipment_no_today()
    rows = (db.query(Order.internal_order_number)
            .filter(Order.business_id == business_id,
                    Order.internal_order_number.like(f"{prefix}-%"))
            .all())
    highest = 0
    for (number,) in rows:
        tail = str(number or "")[len(prefix) + 1:]
        if len(tail) == 3 and tail.isdigit():
            highest = max(highest, int(tail))
    candidate = highest + 1
    while db.query(Order).filter_by(
            business_id=business_id,
            internal_order_number=f"{prefix}-{candidate:03d}").first() is not None:
        candidate += 1
    return f"{prefix}-{candidate:03d}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "next_shipment_order_no"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/order_service.py backend/tests/test_shipsagar.py
git commit -m "feat: sequential daily shipment order numbers"
```

---

### Task 5: Push endpoint assigns OrderNo and validates the courier

**Files:**
- Modify: `backend/app/api/shipments.py` (push route)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `next_shipment_order_no(db, business_id)` (Task 4), `get_couriers()` (Task 2), `build_push_payload` (Task 3), `INDIA_POST_COURIER_CODES` (added here).
- Produces:
  - `INDIA_POST_COURIER_CODES = ("IP", "INDIA_POST")` module constant in `backend/app/api/shipments.py`.
  - `POST /api/v1/shipments/push` additionally assigns `OrderNo` via `next_shipment_order_no`, writes it to `Order.internal_order_number`, and returns it as `order_no` in `data`. A courier that is neither in the ShipSager catalogue nor an India Post code is rejected with `UNSUPPORTED_COURIER` 400 **before** anything is persisted.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- push assigns an OrderNo and validates the courier ---

def _stub_couriers(monkeypatch, codes=("IP", "DTDC", "FEDEX")):
    from app.services import shipsagar_service as ss
    ss.reset_courier_cache()
    monkeypatch.setattr(ss, "get_couriers",
                        lambda force=False: [{"courier_code": c,
                                             "courier_name": c} for c in codes])


def test_push_assigns_an_order_no_to_the_order(monkeypatch):
    from app.models.order import Order
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch)
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
        "ok": True, "message": "Data has been recorded successfully"})
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-NO-1", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["order_no"].startswith(_shipment_day())
        assert data["order_no"].endswith("-001")
        db = mk()
        try:
            assert db.query(Order).filter_by(id=oid).first().internal_order_number \
                == data["order_no"]
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_numbers_are_sequential_across_pushes(monkeypatch):
    from datetime import datetime as _dt
    from app.models.order import Order
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch)
    mk = _mk()
    c, h, bid, oid1 = _authed_with_order(monkeypatch, mk)
    db = mk()
    try:
        o2 = Order(business_id=bid, internal_order_number="MAN-P2",
                   shopify_order_id="MANUAL-P2",
                   order_date=_dt.now(_dt.now().astimezone().tzinfo))
        db.add(o2)
        db.commit()
        db.refresh(o2)
        oid2 = o2.id
    finally:
        db.close()
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {"ok": True, "message": "ok"})
    try:
        first = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid1, "tracking_no": "EG-NO-A", "courier_code": "IP"})
        second = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid2, "tracking_no": "EG-NO-B", "courier_code": "DTDC"})
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["data"]["order_no"].endswith("-001")
        assert second.json()["data"]["order_no"].endswith("-002")
    finally:
        app.dependency_overrides.clear()


def test_push_rejects_a_courier_shipsagar_does_not_serve(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch, codes=("IP", "DTDC"))
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-BAD-C", "courier_code": "NOT_A_COURIER"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "UNSUPPORTED_COURIER"
        db = mk()
        try:
            from app.models.shipment import Shipment
            assert db.query(Shipment).filter_by(business_id=bid).count() == 0
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_accepts_india_post_even_when_the_catalogue_omits_it(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch, codes=("DTDC", "FEDEX"))
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {"ok": True, "message": "ok"})
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-IP-OK", "courier_code": "IP"})
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()


def test_push_survives_an_unreachable_catalogue(monkeypatch):
    """A GetCourier outage must not block a push; fall back to the allow-list."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()

    def _boom(force=False):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "courier list down")

    monkeypatch.setattr(ss, "get_couriers", _boom)
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {"ok": True, "message": "ok"})
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-FALLBACK", "courier_code": "IP"})
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()
```

Add this helper near the top of the test file's helper block:

```python
def _shipment_day() -> str:
    from datetime import datetime as _dt
    return _dt.now().strftime("%Y%m%d")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "order_no or courier"`
Expected: FAIL — `data["order_no"]` raises `KeyError`, and the unsupported courier is accepted.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/api/shipments.py`, add near the module's other constants:

```python
INDIA_POST_COURIER_CODES = ("IP", "INDIA_POST")
```

In the push route, insert the courier check after the blank-input checks and before the Order lookup:

```python
    allowed = set(INDIA_POST_COURIER_CODES)
    try:
        allowed.update(c["courier_code"].upper() for c in ss.get_couriers())
    except ss.ShipsagarError:
        pass
    if courier_code not in allowed:
        return _err(400, "UNSUPPORTED_COURIER",
                    f"ShipSagar does not serve courier '{courier_code}'.")
```

Note: `ss` is imported inside the function; make sure the `get_couriers` call happens after that import.

In the same route, replace the `ss.push_shipment(...)` call and the success return so the OrderNo is generated and persisted before the push:

```python
    order_no = next_shipment_order_no(db, bid)
    order.internal_order_number = order_no
    db.flush()
    try:
        result = ss.push_shipment(tracking_no=tracking_no,
                                  courier_code=courier_code, order=order,
                                  order_no=order_no)
```

and add `"order_no": order_no` to the success `data` dict.

Add the import inside the function alongside the others:

```python
    from app.services.order_service import next_shipment_order_no
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "order_no or courier"`
Expected: PASS

- [ ] **Step 5: Run the ShipSagar suite for regressions**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_final_fixes.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/shipments.py backend/tests/test_shipsagar.py
git commit -m "feat: push assigns an OrderNo and validates the courier against GetCourier"
```

---

### Task 6: Couriers endpoint and shipment history endpoint

**Files:**
- Modify: `backend/app/api/shipments.py`
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `get_couriers()` (Task 2), `track_shipment` (existing), `find_shipment` (existing).
- Produces:
  - `GET /api/v1/shipments/couriers` — ADMIN/WAREHOUSE only. Returns `{"success": true, "data": {"couriers": [{"courier_code", "courier_name"}]}}`. On a ShipSagar failure with no cached list, returns `SHIPSAGAR_API_ERROR` 502 with a `couriers: []` body so the dialog can still render its fallback.
  - `GET /api/v1/shipments/{sid}/history` — any authenticated user, business-scoped. Calls `track_shipment(s.awb_number, s.carrier_code)` live and returns `{"success": true, "data": {"awb", "courier_code", "status": <normalized>, "tracking_url": <build_tracking_url or null>, "events": [{"action_date", "action_time", "action_location", "action_description", "normalized_status"}]}}` ordered **newest first**. It does **not** ingest or mutate. 404 `SHIPMENT_NOT_FOUND`; 400 `NO_TRACKING_NUMBER` when `awb_number` is empty; 502 on a ShipSagar failure.
  - Route placement: `/couriers` must be declared **before** `/{sid}` so it is not swallowed by the parameterised route.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- couriers + history endpoints ---

def test_couriers_endpoint_returns_the_catalogue(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch, codes=("IP", "DTDC"))
    mk = _mk()
    c, h, _ = _authed(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments/couriers", headers=h)
        assert r.status_code == 200, r.text
        codes = [x["courier_code"] for x in r.json()["data"]["couriers"]]
        assert codes == ["IP", "DTDC"]
    finally:
        app.dependency_overrides.clear()


def test_couriers_endpoint_is_forbidden_for_a_viewer(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    _stub_couriers(monkeypatch)
    mk = _mk()
    c, h, _ = _authed(monkeypatch, mk, role="VIEWER", email="v2@t.in")
    try:
        r = c.get("/api/v1/shipments/couriers", headers=h)
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "FORBIDDEN"
    finally:
        app.dependency_overrides.clear()


def test_couriers_endpoint_reports_an_unreachable_catalogue(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    ss.reset_courier_cache()

    def _boom(force=False):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "courier list down")

    monkeypatch.setattr(ss, "get_couriers", _boom)
    mk = _mk()
    c, h, _ = _authed(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments/couriers", headers=h)
        assert r.status_code == 502, r.text
        assert r.json()["error"]["code"] == "SHIPSAGAR_API_ERROR"
        assert r.json()["data"]["couriers"] == []
    finally:
        app.dependency_overrides.clear()


def test_history_endpoint_returns_scans_newest_first_without_ingesting(monkeypatch):
    from app.models.shipment import Shipment, ShipmentEvent
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid, bid = _seed_pushed_shipment(mk, awb="EG-HIST-1", status="IN_TRANSIT")
    c, h, _ = _authed(monkeypatch, mk)
    try:
        monkeypatch.setattr(ss, "track_shipment", lambda awb, courier_code="": {
            "awb": awb, "events": [
                {"event_id": "e-old", "status_raw": "Item Booked",
                 "normalized_status": "READY_TO_SHIP", "message": "Item Booked",
                 "location": "Mumbai", "event_time": "2023-05-16T10:00:00+00:00"},
                {"event_id": "e-new", "status_raw": "Out for delivery",
                 "normalized_status": "OUT_FOR_DELIVERY", "message": "Out for delivery",
                 "location": "Delhi", "event_time": "2023-05-17T09:00:00+00:00"},
            ]})
        r = c.get(f"/api/v1/shipments/{sid}/history", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["awb"] == "EG-HIST-1"
        assert data["status"] == "OUT_FOR_DELIVERY"
        assert [e["action_description"] for e in data["events"]] == [
            "Out for delivery", "Item Booked"]
        assert data["events"][0]["action_location"] == "Delhi"
        db = mk()
        try:
            # Reading the history must not write anything.
            assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 0
            assert db.query(Shipment).filter_by(id=sid).first().tracking_status \
                == "IN_TRANSIT"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_history_endpoint_requires_a_tracking_number(monkeypatch):
    mk = _mk()
    from app.models.shipment import Shipment
    db = mk()
    b = db.query(__import__("app.models.business", fromlist=["Business"]).Business).first()
    db.close()
    sid, bid = _seed_shipment_without_awb(mk)
    c, h, _ = _authed(monkeypatch, mk)
    try:
        r = c.get(f"/api/v1/shipments/{sid}/history", headers=h)
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "NO_TRACKING_NUMBER"
    finally:
        app.dependency_overrides.clear()


def test_history_endpoint_is_tenant_scoped(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid, bid = _seed_pushed_shipment(mk, awb="EG-HIST-2")
    c2, h2, _, _ = _authed(monkeypatch, mk, role="ADMIN", email="other2@t.in")
    try:
        r = c2.get(f"/api/v1/shipments/{sid}/history", headers=h2)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "SHIPMENT_NOT_FOUND"
    finally:
        app.dependency_overrides.clear()
```

Add this helper next to the other seed helpers:

```python
def _seed_shipment_without_awb(mk):
    from app.models.business import Business
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    s = Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                 carrier_code="IP", awb_number="", tracking_status="AWAITING_TRACKING")
    db.add(s)
    db.commit()
    db.refresh(s)
    sid = s.id
    db.close()
    return sid, b.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "couriers_endpoint or history_endpoint"`
Expected: FAIL — 404 route not found.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/api/shipments.py`, add **before** the `@router.get("/{sid}")` route:

```python
@router.get("/couriers")
def list_couriers(db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    """The courier catalogue ShipSagar serves, for the push dialog's dropdown."""
    from app.services import shipsagar_service as ss
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        return _err(403, "FORBIDDEN", "Warehouse role required")
    try:
        rows = ss.get_couriers()
    except ss.ShipsagarError as exc:
        return _err(502, exc.code, exc.message, couriers=[])
    return {"success": True, "data": {"couriers": rows}}
```

Add after `get_shipment`:

```python
@router.get("/{sid}/history")
def shipment_history(sid: str, db: Session = Depends(get_db),
                     u: dict = Depends(get_current_user)):
    """Live tracking history from ShipSagar. Reads only - nothing is ingested."""
    from app.services import shipsagar_service as ss
    from app.models.shipment import Shipment
    from app.carriers.registry import provider_for_shipment
    s = db.query(Shipment).filter_by(id=sid, business_id=u.get("business_id")).first()
    if s is None:
        return _err(404, "SHIPMENT_NOT_FOUND", "Shipment not found")
    awb = (s.awb_number or "").strip()
    if not awb:
        return _err(400, "NO_TRACKING_NUMBER",
                    "This shipment has no tracking number yet.")
    try:
        provider = provider_for_shipment(s)
        data = provider.get_tracking(awb)
    except Exception as exc:
        code = getattr(exc, "code", "SHIPSAGAR_API_ERROR")
        return _err(502, code, str(exc))
    from app.services import shipsagar_service as ss2
    courier = s.carrier_code
    events = [{
        "action_date": _fmt_action_date(e.get("event_time")),
        "action_time": _fmt_action_time(e.get("event_time")),
        "action_location": e.get("location") or "",
        "action_description": e.get("status_raw") or "",
        "normalized_status": ss2.normalize_shipsagar_status(courier, e.get("status_raw") or ""),
    } for e in (data.get("events") or [])]
    newest = data.get("events") or []
    normalized = ss2.normalize_shipsagar_status(courier, newest[0].get("status_raw") if newest else "")
    url = None
    try:
        url = provider.build_tracking_url(awb)
    except Exception:
        url = None
    return {"success": True, "data": {
        "awb": awb, "courier_code": courier, "status": normalized,
        "tracking_url": url, "events": events}}
```

Note on ordering: the events above are built in the order `track_shipment` returns them. ShipSagar documents `TrackingHistory` as oldest-first (the sample runs 12:27 → 15:51 → 19:43 on one day), so **reverse the list** before building `events` so the newest scan is first:

```python
    events = [{...} for e in reversed(data.get("events") or [])]
```

and compute `normalized` from `data["events"][-1]` (the oldest, i.e. most advanced, entry) — actually the correct final status is the **last entry of the ShipSagar list**, since the sample shows it ascending. Use:

```python
    raw_events = data.get("events") or []
    final_raw = raw_events[-1].get("status_raw") if raw_events else ""
    normalized = ss2.normalize_shipsagar_status(courier, final_raw or "")
```

Add these two helpers next to `_day_bounds`:

```python
def _fmt_action_date(value) -> str:
    try:
        return value.strftime("%d-%b-%Y")
    except Exception:
        return ""


def _fmt_action_time(value) -> str:
    try:
        return value.strftime("%H:%M")
    except Exception:
        return ""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "couriers_endpoint or history_endpoint"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/shipments.py backend/tests/test_shipsagar.py
git commit -m "feat: courier catalogue and live shipment history endpoints"
```

---

### Task 7: Shipments on the orders list

**Files:**
- Modify: `backend/app/api/orders.py` (`_to_dict` and `get_orders` only)
- Modify: `backend/app/services/order_service.py` (`list_orders` only if needed)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: every order row in `GET /api/v1/orders` gains a `shipment` object, `null` when the order has none:
  `{"id", "awb_number", "carrier_code", "tracking_status", "current_location", "last_checkpoint_at", "shipped_at", "push_state"}` where `push_state` is one of `"none"`, `"awaiting"`, `"pushed"`, `"rejected"`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- orders list carries shipment state ---

def test_orders_list_includes_shipment_state(monkeypatch):
    from app.models.order import Order
    from app.models.shipment import Shipment
    from datetime import timedelta
    mk = _mk()
    c, h, bid = _authed_for_list(monkeypatch, mk)
    db = mk()
    try:
        waiting = Order(business_id=bid, internal_order_number="MAN-W1",
                        shopify_order_id="MANUAL-W1",
                        order_date=datetime.now(timezone.utc))
        pushed = Order(business_id=bid, internal_order_number="MAN-P1",
                       shopify_order_id="MANUAL-P1",
                       order_date=datetime.now(timezone.utc))
        bare = Order(business_id=bid, internal_order_number="MAN-B1",
                     shopify_order_id="MANUAL-B1",
                     order_date=datetime.now(timezone.utc))
        db.add_all([waiting, pushed, bare])
        db.commit()
        for o in db.query(Order).filter(Order.internal_order_number.in_(
                ["MAN-W1", "MAN-P1", "MAN-B1"])).all():
            db.refresh(o)
        ids = {o.internal_order_number: o.id for o in db.query(Order).all()}
        db.add(Shipment(business_id=bid, order_id=ids["MAN-W1"], parcel_id="pw",
                        carrier_code="IP", awb_number="", tracking_status="AWAITING_TRACKING"))
        db.add(Shipment(business_id=bid, order_id=ids["MAN-P1"], parcel_id="pp",
                        carrier_code="IP", awb_number="EG-P1",
                        tracking_status="IN_TRANSIT",
                        current_location="Delhi",
                        last_checkpoint_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        db.commit()
    finally:
        db.close()
    try:
        r = c.get("/api/v1/orders?page_size=100", headers=h)
        assert r.status_code == 200, r.text
        rows = {row["internal_order_number"]: row for row in r.json()["data"]["items"]}
        assert rows["MAN-B1"]["shipment"] is None
        assert rows["MAN-W1"]["shipment"]["push_state"] == "awaiting"
        assert rows["MAN-W1"]["shipment"]["awb_number"] == ""
        assert rows["MAN-P1"]["shipment"]["push_state"] == "pushed"
        assert rows["MAN-P1"]["shipment"]["awb_number"] == "EG-P1"
        assert rows["MAN-P1"]["shipment"]["current_location"] == "Delhi"
        assert rows["MAN-P1"]["shipment"]["last_checkpoint_at"]
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "orders_list_includes_shipment"`
Expected: FAIL — `KeyError: 'shipment'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/api/orders.py`, add a helper just above `_to_dict`:

```python
def _shipment_dict(db, order_id: str) -> dict | None:
    from app.models.shipment import Shipment
    s = db.query(Shipment).filter_by(order_id=order_id).first()
    if s is None:
        return None
    awb = (s.awb_number or "").strip()
    if not awb:
        push_state = "awaiting"
    elif s.shipsagar_tracking_id and (s.shipsagar_tracking_id or "").startswith("SS-"):
        push_state = "pushed"
    else:
        push_state = "rejected"

    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {"id": s.id, "awb_number": awb or None, "carrier_code": s.carrier_code,
            "tracking_status": s.tracking_status, "current_location": s.current_location,
            "last_checkpoint_at": iso(s.last_checkpoint_at), "shipped_at": iso(s.shipped_at),
            "push_state": push_state}
```

Change `_to_dict(o)` to `_to_dict(o, shipment=None)` and add `"shipment": shipment` to the returned dict. Update `get_orders` to build the shipment map and pass it through:

```python
    rows = [_to_dict(o) for o in items]
    by_order = {}
    for o in items:
        row = next(r for r in rows if r["id"] == o.id)
        row["shipment"] = _shipment_dict(db, o.id)
    return {
        "success": True,
        "data": {"items": rows, "total": total, "page": max(int(page or 1), 1)},
    }
```

The `next(...)` lookup is O(n^2) and deliberately simple; the page size is capped at 100 in `list_orders`, so this is acceptable. If you prefer, index the rows by id first — either is fine, but do not run a per-row query inside `_to_dict` (it has no `db`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "orders_list_includes_shipment"`
Expected: PASS

- [ ] **Step 5: Run the orders and ShipSagar suites for regressions**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_final_fixes.py tests/test_india_post_orders.py tests/test_route_order.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/orders.py backend/tests/test_shipsagar.py
git commit -m "feat(orders): expose shipment state on each order row"
```

---

### Task 8: Shopify orders auto-create an awaiting-tracking shipment

**Files:**
- Modify: `backend/app/services/shopify_service.py` (`upsert_order`)
- Modify: `backend/app/services/shipment_service.py` (add helper + terminal set)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `ensure_parcel_for_order(db, order_id)` (existing, `backend/app/services/barcode_service.py:34`), `COURIER_ALIASES` (existing).
- Produces:
  - `AWAITING_TRACKING = "AWAITING_TRACKING"` module constant in `backend/app/services/shipment_service.py`, added to that module's `TERMINAL` tuple (nothing to poll yet).
  - `ensure_awaiting_shipment(db, order) -> Shipment | None` in `shipment_service.py`. Returns the order's existing Shipment if it has one; otherwise creates one with `carrier_code` resolved through `COURIER_ALIASES` to `"IP"`, `awb_number=""`, `tracking_status=AWAITING_TRACKING`, and the order's existing Parcel. Never overwrites an existing shipment. Returns `None` when the order has no Parcel to attach (NOT NULL FK).
  - `upsert_order` calls `ensure_awaiting_shipment(db, o)` after `ensure_parcel_for_order(db, o.id)`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- Shopify auto-creates an awaiting shipment ---

def test_ensure_awaiting_shipment_creates_one_and_is_idempotent(monkeypatch):
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.services.barcode_service import ensure_parcel_for_order
    from app.services.shipment_service import (AWAITING_TRACKING,
                                                ensure_awaiting_shipment)
    from app.services.shipsagar_service import resolve_courier
    assert AWAITING_TRACKING == "AWAITING_TRACKING"
    assert resolve_courier("IP") == "INDIA_POST"
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    db = mk()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        parcel = ensure_parcel_for_order(db, o.id)
        first = ensure_awaiting_shipment(db, o)
        assert first is not None
        assert first.tracking_status == AWAITING_TRACKING
        assert first.awb_number == ""
        assert first.parcel_id == parcel.id
        assert first.carrier_code == "IP"
        sid = first.id
        second = ensure_awaiting_shipment(db, o)
        assert second.id == sid
        from app.models.shipment import Shipment
        assert db.query(Shipment).filter_by(order_id=oid).count() == 1
    finally:
        db.close()


def test_ensure_awaiting_shipment_leaves_an_existing_shipment_alone(monkeypatch):
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services.shipment_service import ensure_awaiting_shipment
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    db = mk()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        p = Parcel(business_id=bid, order_id=o.id, parcel_code="P1",
                   barcode_value="EG-EXIST")
        db.add(p)
        db.commit()
        db.refresh(p)
        s = Shipment(business_id=bid, order_id=o.id, parcel_id=p.id,
                     carrier_code="IP", awb_number="EG-EXIST",
                     tracking_status="IN_TRANSIT",
                     shipsagar_tracking_id="SS-EG-EXIST")
        db.add(s)
        db.commit()
        out = ensure_awaiting_shipment(db, o)
        assert out.awb_number == "EG-EXIST"
        assert out.tracking_status == "IN_TRANSIT"
    finally:
        db.close()


def test_awaiting_tracking_is_terminal_on_the_backend():
    from app.services.shipment_service import TERMINAL
    assert "AWAITING_TRACKING" in TERMINAL


def test_shopify_upsert_creates_the_awaiting_shipment(monkeypatch):
    """A synced Shopify order lands with a shipment already waiting for tracking."""
    from app.models.order import Order
    from app.models.shipment import Shipment
    from app.services.shopify_service import upsert_order
    mk = _mk()
    db = mk()
    from app.models.business import Business
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    payload = {
        "id": 9001, "name": "#S9001", "created_at": "2026-10-06T10:00:00Z",
        "email": "buyer@example.com", "total_price": "1500.00",
        "currency": "INR", "financial_status": "paid",
        "shipping_address": {"first_name": "Asha", "last_name": "Rao",
                             "city": "Nashik", "zip": "422001"},
        "line_items": [{"title": "Item", "quantity": 1, "price": "1500.00"}],
    }
    try:
        oid = upsert_order(db, b.id, payload)
        s = db.query(Shipment).filter_by(order_id=oid).first()
        assert s is not None
        assert s.tracking_status == "AWAITING_TRACKING"
        assert s.awb_number == ""
        assert s.shipsagar_tracking_id is None
    finally:
        db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "awaiting"`
Expected: FAIL — `ImportError: cannot import name 'ensure_awaiting_shipment'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/shipment_service.py`, add near the top and append the helper at the end:

```python
AWAITING_TRACKING = "AWAITING_TRACKING"

TERMINAL = ("DELIVERED", "RETURNED", "RTO_DELIVERED", "LOST", "CLOSED",
            AWAITING_TRACKING)
```

```python
def ensure_awaiting_shipment(db, order):
    """Give an order a shipment row that is waiting for a tracking number.

    ShipSagar's PushShipment requires a TrackingNo, so a freshly synced order
    cannot be pushed yet. It still gets a row so the Orders page can show a
    consistent Shipment cell and prompt for the number. Never touches an order
    that already has a shipment.
    """
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services.shipsagar_service import resolve_courier
    existing = db.query(Shipment).filter_by(order_id=order.id).first()
    if existing is not None:
        return existing
    parcel = db.query(Parcel).filter_by(order_id=order.id).first()
    if parcel is None:
        return None
    courier = resolve_courier("IP")
    s = Shipment(business_id=order.business_id, order_id=order.id,
                 parcel_id=parcel.id, carrier_code=courier, awb_number="",
                 tracking_status=AWAITING_TRACKING)
    db.add(s)
    db.flush()
    return s
```

In `backend/app/services/shopify_service.py`, in `upsert_order`, immediately after the existing `ensure_parcel_for_order(db, o.id)` call:

```python
    from app.services.shipment_service import ensure_awaiting_shipment
    ensure_awaiting_shipment(db, o)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "awaiting"`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the ShipSagar and sync suites for regressions**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_webhooks.py tests/test_sync_idempotency.py tests/test_final_fixes.py -q`
Expected: PASS. If a sync test now sees an extra Shipment, that is the intended new behaviour — update the assertion deliberately and say so.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/shipment_service.py backend/app/services/shopify_service.py backend/tests/test_shipsagar.py
git commit -m "feat: synced orders get an awaiting-tracking shipment"
```

---

### Task 9: Frontend shipment clients and the Add Shipment dialog

**Files:**
- Modify: `web/src/lib/api.ts` (append)
- Modify: `web/src/lib/shipments.ts`
- Create: `web/src/components/AddShipmentDialog.tsx`
- Create: `web/tests/add-shipment-dialog.test.tsx`
- Modify: `web/tests/shipments-client.test.tsx`

**Interfaces:**
- Consumes: the Task 6 endpoints.
- Produces:
  - `web/src/lib/api.ts`: `CourierOption`, `getShipmentCouriers(token?)`, `ShipmentHistoryEvent`, `ShipmentHistory`, `getShipmentHistory(id, token?)`, and `PushShipmentResult` gains `order_no: string`.
  - `web/src/lib/shipments.ts`: `AWAITING_TRACKING = "AWAITING_TRACKING"`, `OrderShipment`, `pushStateLabel(state)`, `PUSH_STATES = ["none", "awaiting", "pushed", "rejected"]`, `isAwaiting(shipment)`, and `SHIPMENT_STATUSES` gains `"AWAITING_TRACKING"`. `TERMINAL_STATUSES` deliberately does **not** gain it.
  - `AddShipmentDialog({ open, orderId, orderLabel, onClose, onPushed })`.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/shipments-client.test.tsx`:

```tsx
test("AWAITING_TRACKING is filterable but not terminal", async () => {
  const { AWAITING_TRACKING, isAwaiting, pushStateLabel, PUSH_STATES } =
    await import("../src/lib/shipments");
  expect(AWAITING_TRACKING).toBe("AWAITING_TRACKING");
  const mod = await import("../src/lib/shipments");
  expect(mod.SHIPMENT_STATUSES).toContain(AWAITING_TRACKING);
  // Deliberately NOT terminal: it is the state that prompts for a tracking number.
  expect(mod.TERMINAL_STATUSES as readonly string[]).not.toContain(AWAITING_TRACKING);
  expect(statusTone(AWAITING_TRACKING)).toBe("info");
  expect(isAwaiting({ push_state: "awaiting" })).toBe(true);
  expect(isAwaiting({ push_state: "pushed" })).toBe(false);
  expect(isAwaiting(null)).toBe(false);
  expect(pushStateLabel("none")).toBe("No shipment");
  expect(pushStateLabel("awaiting")).toBe("Awaiting tracking number");
  expect(pushStateLabel("pushed")).toBe("Tracking");
  expect(pushStateLabel("rejected")).toBe("Not accepted by ShipSagar");
  expect(PUSH_STATES).toEqual(["none", "awaiting", "pushed", "rejected"]);
});

test("getShipmentCouriers unwraps the courier list", async () => {
  const { getShipmentCouriers } = await import("../src/lib/api");
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { couriers: [
      { courier_code: "IP", courier_name: "India Post" }] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await getShipmentCouriers();
  expect(out[0].courier_code).toBe("IP");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/couriers");
});

test("getShipmentHistory returns the events newest first", async () => {
  const { getShipmentHistory } = await import("../src/lib/api");
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      awb: "EG1", courier_code: "IP", status: "OUT_FOR_DELIVERY",
      tracking_url: null,
      events: [
        { action_date: "17-May-2023", action_time: "09:00",
          action_location: "Delhi", action_description: "Out for delivery",
          normalized_status: "OUT_FOR_DELIVERY" },
        { action_date: "16-May-2023", action_time: "12:27",
          action_location: "", action_description: "Label Created",
          normalized_status: "READY_TO_SHIP" },
      ] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await getShipmentHistory("s1");
  expect(out.events[0].action_description).toBe("Out for delivery");
  expect(out.status).toBe("OUT_FOR_DELIVERY");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/s1/history");
});
```

Create `web/tests/add-shipment-dialog.test.tsx`:

```tsx
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AddShipmentDialog from "../src/components/AddShipmentDialog";

afterEach(() => { cleanup(); });
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const COURIERS = [
  { courier_code: "IP", courier_name: "India Post" },
  { courier_code: "DTDC", courier_name: "DTDC" },
  { courier_code: "FEDEX", courier_name: "FedEx" },
];

function stubFetch(pushResult?: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/api/v1/shipments/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    if (String(url).includes("/api/v1/shipments/push")) {
      return { ok: true, json: async () => ({ success: true, data: {
        id: "s1", awb_number: "EG1", carrier_code: "IP",
        tracking_status: "READY_TO_SHIP", order_no: "20261006-001",
        ...(pushResult ?? {}), } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  });
}

test("loads couriers, defaults to India Post, and pushes the tracking number", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  const courier = await screen.findByLabelText("Courier") as HTMLSelectElement;
  await waitFor(() => expect(courier.options.length).toBeGreaterThan(1));
  expect(courier.value).toBe("IP");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG080960145IN" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onPushed).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/push"));
  expect(JSON.parse((call?.[1] as any).body)).toEqual({
    order_id: "o1", tracking_no: "EG080960145IN", courier_code: "IP",
  });
});

test("a blank tracking number is refused before any request", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  await screen.findByLabelText("Courier");
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("Tracking number is required.")).toBeTruthy());
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/push"))).toBe(false);
  expect(onPushed).not.toHaveBeenCalled();
});

test("a ShipSagar refusal is shown without pretending the push failed", async () => {
  vi.stubGlobal("fetch", stubFetch({ pushed: false, message: "please try again later" }));
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
  expect(onPushed).toHaveBeenCalled();
});

test("an unreachable courier catalogue still offers a usable dropdown", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/couriers")) {
      return { ok: false, status: 502, json: async () => ({ success: false,
        error: { code: "SHIPSAGAR_API_ERROR", message: "courier list down" },
        data: { couriers: [] } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {
      id: "s1", awb_number: "EG1", carrier_code: "IP",
      tracking_status: "READY_TO_SHIP", order_no: "20261006-001", pushed: true, message: "" } }) };
  }));
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={() => {}} />);
  const courier = await screen.findByLabelText("Courier") as HTMLSelectElement;
  expect(courier.value).toBe("IP");
  expect(courier.options.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web; npx vitest run tests/shipments-client.test.tsx tests/add-shipment-dialog.test.tsx`
Expected: FAIL — missing module and missing exports.

- [ ] **Step 3: Add the frontend helpers**

In `web/src/lib/shipments.ts`, add `"AWAITING_TRACKING"` to `SHIPMENT_STATUSES`, add `"AWAITING_TRACKING": "info"` to `TONES`, and append:

```ts
export const AWAITING_TRACKING = "AWAITING_TRACKING";

export const PUSH_STATES = ["none", "awaiting", "pushed", "rejected"] as const;
export type PushState = (typeof PUSH_STATES)[number];

export type OrderShipment = {
  id?: string | null;
  awb_number?: string | null;
  carrier_code?: string | null;
  tracking_status?: string | null;
  current_location?: string | null;
  last_checkpoint_at?: string | null;
  shipped_at?: string | null;
  push_state?: string | null;
};

export function isAwaiting(shipment: OrderShipment | null | undefined): boolean {
  return (shipment?.push_state ?? "") === "awaiting";
}

const PUSH_LABELS: Record<string, string> = {
  none: "No shipment",
  awaiting: "Awaiting tracking number",
  pushed: "Tracking",
  rejected: "Not accepted by ShipSagar",
};

export function pushStateLabel(state?: string | null): string {
  return PUSH_LABELS[state ?? ""] ?? PUSH_LABELS.none;
}
```

In `web/src/lib/api.ts`, extend `PushShipmentResult` with `order_no: string` and append:

```ts
export type CourierOption = { courier_code: string; courier_name: string };

export function getShipmentCouriers(token?: string): Promise<CourierOption[]> {
  return api<{ couriers: CourierOption[] }>(
    "/api/v1/shipments/couriers", {}, token,
  ).then((data: any) => data?.couriers ?? []);
}

export type ShipmentHistoryEvent = {
  action_date: string;
  action_time: string;
  action_location: string;
  action_description: string;
  normalized_status: string;
};

export type ShipmentHistory = {
  awb: string;
  courier_code: string;
  status: string;
  tracking_url: string | null;
  events: ShipmentHistoryEvent[];
};

export function getShipmentHistory(id: string, token?: string): Promise<ShipmentHistory> {
  return api<ShipmentHistory>(`/api/v1/shipments/${id}/history`, {}, token);
}
```

- [ ] **Step 4: Create the dialog**

Create `web/src/components/AddShipmentDialog.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { CourierOption, getShipmentCouriers, pushShipment } from "../lib/api";
import { IconAlert, IconTruck } from "./icons";

export type AddShipmentDialogProps = {
  open: boolean;
  orderId: string | null;
  orderLabel?: string;
  onClose: () => void;
  onPushed: (result: any) => void;
};

const FALLBACK_COURIERS: CourierOption[] = [
  { courier_code: "IP", courier_name: "India Post" },
  { courier_code: "DTDC", courier_name: "DTDC" },
];

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

export default function AddShipmentDialog({
  open, orderId, orderLabel, onClose, onPushed,
}: AddShipmentDialogProps) {
  const [couriers, setCouriers] = useState<CourierOption[]>(FALLBACK_COURIERS);
  const [trackingNo, setTrackingNo] = useState("");
  const [courier, setCourier] = useState("IP");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTrackingNo("");
    setCourier("IP");
    setError(null);
    setNotice(null);
    setSubmitError(null);
    setSubmitting(false);
    getShipmentCouriers()
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) setCouriers(rows);
      })
      .catch(() => setCouriers(FALLBACK_COURIERS));
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitError(null);
    if (!trackingNo.trim()) {
      setError("Tracking number is required.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await pushShipment({
        order_id: orderId ?? "",
        tracking_no: trackingNo.trim(),
        courier_code: courier,
      });
      setTrackingNo("");
      if (!result.pushed) {
        setNotice(result.message || "ShipSagar did not accept this shipment.");
      }
      onPushed(result);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to push shipment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      role="dialog" aria-modal="true" aria-label="Add Shipment">
      <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <IconTruck size={20} /> Add Shipment
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {orderLabel ? `Order ${orderLabel}` : "Register a tracking number with ShipSagar"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <form id="add-shipment-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
            {submitError && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">
                {submitError}
              </div>
            )}
            {notice && (
              <div role="status" className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3">
                {notice}
              </div>
            )}
            <div>
              <label htmlFor="add-tracking" className={labelClass}>Tracking No</label>
              <input id="add-tracking" aria-label="Tracking No" required
                className={inputClass} placeholder="e.g. EG080960145IN"
                value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} />
              {error && (
                <span className="text-xs font-medium text-red-600 flex items-center gap-1 mt-1" role="alert">
                  <IconAlert size={12} /> {error}
                </span>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Tracking number issued by the India Post worker. This becomes the parcel
                barcode and the AWB.
              </p>
            </div>
            <div>
              <label htmlFor="add-courier" className={labelClass}>Courier</label>
              <select id="add-courier" aria-label="Courier" className={inputClass}
                value={courier} onChange={(e) => setCourier(e.target.value)}>
                {couriers.map((c) => (
                  <option key={c.courier_code} value={c.courier_code}>
                    {c.courier_name} ({c.courier_code})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Loaded from ShipSagar. Defaults to India Post.
              </p>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition">
            Cancel
          </button>
          <button type="submit" form="add-shipment-form" disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition disabled:opacity-60">
            {submitting ? "Pushing…" : "Push shipment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web; npx vitest run tests/shipments-client.test.tsx tests/add-shipment-dialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck and commit**

Run: `cd web; npx tsc --noEmit`
Expected: clean

```bash
git add web/src/lib/api.ts web/src/lib/shipments.ts web/src/components/AddShipmentDialog.tsx web/tests/shipments-client.test.tsx web/tests/add-shipment-dialog.test.tsx
git commit -m "feat: Add Shipment dialog with a live ShipSagar courier list"
```

---

### Task 10: Shipment cell on the orders table and the New Order tracking step

**Files:**
- Modify: `web/src/components/OrderTable.tsx`
- Modify: `web/src/components/NewOrderDialog.tsx`
- Modify: `web/src/pages/Orders.tsx`
- Test: `web/tests/order-shipment-cell.test.tsx`
- Modify: `web/tests/new-order.test.tsx`

**Interfaces:**
- Consumes: `OrderShipment`, `isAwaiting`, `pushStateLabel`, `statusTone` (Task 9); `AddShipmentDialog` (Task 9); `pushShipment` (Task 9).
- Produces:
  - `OrderTable({ orders, onAddShipment })` — `onAddShipment(order: any) => void` is new and **required**. Adds a Shipment column rendering `Add Shipment` when `isAwaiting(order.shipment)`, the tracking number as a `<Link to={/shipments/${id}}>` plus a status pill when pushed, and the rejection label when rejected.
  - `NewOrderDialog` gains a second step after a successful save: a tracking-number field plus **Save & push shipment** and **Skip for now**.

- [ ] **Step 1: Write the failing test**

Create `web/tests/order-shipment-cell.test.tsx`:

```tsx
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import OrderTable from "../src/components/OrderTable";

afterEach(() => { cleanup(); });
beforeEach(() => { localStorage.clear(); });

function order(over: Record<string, unknown> = {}) {
  return {
    id: "o1", internal_order_number: "MAN-1", shopify_order_name: "#1",
    financial_status: "PAID", fulfillment_status: "UNFULFILLED",
    operational_status: "NEW", total_amount: 100, cod_mode: "COD",
    cod_value: 100, receiver_city: "Nashik", receiver_pincode: "422001",
    order_date: "2026-10-06T10:00:00+00:00", shipment: null, ...over,
  };
}

function renderTable(rows: any[]) {
  return render(
    <MemoryRouter>
      <OrderTable orders={rows} onAddShipment={() => {}} />
    </MemoryRouter>,
  );
}

test("an order with no shipment shows No shipment", () => {
  renderTable([order()]);
  expect(screen.getByText("No shipment")).toBeTruthy();
});

test("an awaiting order offers Add Shipment and fires the callback", () => {
  const onAddShipment = vi.fn();
  render(
    <MemoryRouter>
      <OrderTable orders={[order({ shipment: { id: "s1", awb_number: "",
        carrier_code: "IP", tracking_status: "AWAITING_TRACKING",
        push_state: "awaiting" } })]} onAddShipment={onAddShipment} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Awaiting tracking number")).toBeTruthy();
  fireEvent.click(screen.getByText("Add Shipment", { selector: "button" }));
  expect(onAddShipment).toHaveBeenCalled();
  expect(onAddShipment.mock.calls[0][0].internal_order_number).toBe("MAN-1");
});

test("a pushed order links its tracking number to the history page", () => {
  renderTable([order({ shipment: { id: "s9", awb_number: "EG080960145IN",
    carrier_code: "IP", tracking_status: "IN_TRANSIT",
    push_state: "pushed", current_location: "Delhi" } })]);
  const link = screen.getByText("EG080960145IN").closest("a");
  expect(link?.getAttribute("href")).toBe("/shipments/s9");
  expect(screen.getByText("IN_TRANSIT")).toBeTruthy();
});

test("a refused push is labelled, not hidden", () => {
  renderTable([order({ shipment: { id: "s8", awb_number: "EG-REFUSED",
    carrier_code: "IP", tracking_status: "READY_TO_SHIP",
    push_state: "rejected" } })]);
  expect(screen.getByText("Not accepted by ShipSagar")).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run tests/order-shipment-cell.test.tsx`
Expected: FAIL — `OrderTable` has no Shipment column and no `onAddShipment` prop.

- [ ] **Step 3: Implement the Shipment cell**

In `web/src/components/OrderTable.tsx`, add the imports:

```tsx
import { Link } from "react-router-dom";
import { isAwaiting, pushStateLabel, statusTone, OrderShipment } from "../lib/shipments";
```

(merge with the existing `Link` import — do not duplicate it.)

Change the signature:

```tsx
export default function OrderTable({ orders, onAddShipment }: { orders: any[]; onAddShipment: (order: any) => void }) {
```

Add a status pill helper and the Shipment cell renderer above the component:

```tsx
function ShipmentPill({ status }: { status: string }) {
  const tone = statusTone(status);
  const cls: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-800",
    info: "bg-sky-100 text-sky-800",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-800",
    neutral: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide ${cls[tone]}`}>
      {status}
    </span>
  );
}

function ShipmentCell({ shipment, onAdd }: {
  shipment: OrderShipment | null | undefined; onAdd: () => void;
}) {
  if (!shipment) {
    return <span className="text-xs text-slate-400">{pushStateLabel("none")}</span>;
  }
  if (isAwaiting(shipment)) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button type="button" onClick={onAdd}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition">
          Add Shipment
        </button>
        <span className="text-[11px] text-amber-700">{pushStateLabel("awaiting")}</span>
      </div>
    );
  }
  if (shipment.push_state === "rejected") {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="font-mono text-xs text-slate-900">{shipment.awb_number}</span>
        <span className="text-[11px] text-red-700">{pushStateLabel("rejected")}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {shipment.id ? (
        <Link to={`/shipments/${shipment.id}`} className="font-mono text-xs font-semibold text-emerald-800 hover:underline">
          {shipment.awb_number}
        </Link>
      ) : (
        <span className="font-mono text-xs text-slate-900">{shipment.awb_number}</span>
      )}
      <ShipmentPill status={shipment.tracking_status ?? ""} />
      {shipment.current_location && (
        <span className="text-[11px] text-slate-500">{shipment.current_location}</span>
      )}
    </div>
  );
}
```

Add the `<th>` after the Order Name column and the `<td>` in the same position in the body row:

```tsx
<th className="px-4 py-3.5">Shipment</th>
```

```tsx
<td className="px-4 py-3.5">
  <ShipmentCell shipment={o.shipment} onAdd={() => onAddShipment(o)} />
</td>
```

- [ ] **Step 4: Wire the dialog into the Orders page**

In `web/src/pages/Orders.tsx`, add the import and state:

```tsx
import AddShipmentDialog from "../components/AddShipmentDialog";

const [addShipmentOrder, setAddShipmentOrder] = useState<any | null>(null);
```

Pass the handler to the table:

```tsx
<OrderTable orders={orders} onAddShipment={(o) => setAddShipmentOrder(o)} />
```

Render the dialog next to `NewOrderDialog`:

```tsx
<AddShipmentDialog
  open={!!addShipmentOrder}
  orderId={addShipmentOrder?.id ?? null}
  orderLabel={addShipmentOrder?.internal_order_number ?? undefined}
  onClose={() => setAddShipmentOrder(null)}
  onPushed={() => { fetchOrders(true); }}
/>
```

- [ ] **Step 5: Add the New Order tracking step**

In `web/src/components/NewOrderDialog.tsx`, add a `step` state (`"form" | "tracking"`), a `savedOrderId` state, and after the existing successful save set `step` to `"tracking"` instead of calling `onSaved`. Render the tracking step as a second block inside the same dialog with its own form id `tracking-step-form`, containing a tracking-number input plus two buttons: **Save & push shipment** (submit) and **Skip for now** (close and call `onSaved` with the saved order).

The submit handler must call `pushShipment({ order_id: savedOrderId, tracking_no, courier_code: "IP" })`, tolerate a `pushed: false` result by showing the message, and call `onSaved` either way so the caller refreshes.

- [ ] **Step 6: Run tests**

Run: `cd web; npx vitest run tests/order-shipment-cell.test.tsx tests/new-order.test.tsx tests/shipments-page.test.tsx`
Expected: the new file passes. `new-order.test.tsx` has one **pre-existing** failure unrelated to this work — leave it failing and say so; do not "fix" it.

- [ ] **Step 7: Typecheck and commit**

Run: `cd web; npx tsc --noEmit`
Expected: clean

```bash
git add web/src/components/OrderTable.tsx web/src/components/NewOrderDialog.tsx web/src/pages/Orders.tsx web/tests/order-shipment-cell.test.tsx
git commit -m "feat(orders): shipment cell per row and a tracking step after New Order"
```

---

### Task 11: Tracking history page and nav cleanup

**Files:**
- Create: `web/src/pages/ShipmentHistory.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/lib/app-nav.ts`
- Create: `web/tests/shipment-history.test.tsx`
- Delete: `web/src/pages/ShipmentDetail.tsx`, `web/src/pages/Shipments.tsx`

**Interfaces:**
- Consumes: `getShipmentHistory` (Task 9), `statusTone`, `SHIPMENT_STATUSES` (Task 9), `getShipsagarHealth`, `canDrainRetries`, `drainShipsagarRetries` (existing).
- Produces: `ShipmentHistoryPage` at route `/shipments/:id`. The nav loses both Shipments entries.

- [ ] **Step 1: Write the failing test**

Create `web/tests/shipment-history.test.tsx`:

```tsx
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShipmentHistoryPage from "../src/pages/ShipmentHistory";

afterEach(() => { cleanup(); });
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const HISTORY = {
  awb: "EG080960145IN", courier_code: "IP", status: "OUT_FOR_DELIVERY",
  tracking_url: null,
  events: [
    { action_date: "17-May-2023", action_time: "09:00", action_location: "New Delhi",
      action_description: "Out for delivery", normalized_status: "OUT_FOR_DELIVERY" },
    { action_date: "16-May-2023", action_time: "19:43", action_location: "",
      action_description: "Package arrived at the carrier facility",
      normalized_status: "IN_TRANSIT" },
    { action_date: "16-May-2023", action_time: "15:51", action_location: "",
      action_description: "Package picked up", normalized_status: "READY_TO_SHIP" },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/shipments/s1"]}>
      <Routes>
        <Route path="/shipments/:id" element={<ShipmentHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("renders the tracking number, status and every scan newest first", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: HISTORY }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
  expect(screen.getByText("OUT_FOR_DELIVERY")).toBeTruthy();
  const descs = ["Out for delivery", "Package arrived at the carrier facility",
                 "Package picked up"];
  const rendered = descs.map((d) =>
    screen.getByText(d).compareDocumentPosition(
      screen.getByText(descs[descs.length - 1])) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(rendered.every((r) => r !== 0)).toBe(true);
  expect(screen.getByText("New Delhi")).toBeTruthy();
  expect(screen.getByText(/17-May-2023/)).toBeTruthy();
});

test("an empty history says so explicitly instead of rendering blank", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { ...HISTORY, events: [] } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText(/No scans yet/i)).toBeTruthy());
});

test("a ShipSagar failure is shown inline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 502,
    json: async () => ({ success: false, error: { code: "SHIPSAGAR_API_ERROR",
      message: "please try again later" } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run tests/shipment-history.test.tsx`
Expected: FAIL — `Cannot find module '../src/pages/ShipmentHistory'`

- [ ] **Step 3: Create the page**

Create `web/src/pages/ShipmentHistory.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getShipmentHistory, ShipmentHistory as History } from "../lib/api";
import { statusTone, Tone } from "../lib/shipments";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

const DOT_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
};

export default function ShipmentHistoryPage() {
  const { id } = useParams();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    getShipmentHistory(id)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load tracking history");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [load]);

  const tone = statusTone(data?.status);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <Link to="/orders" className="text-xs font-semibold text-emerald-700 hover:underline">
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tracking History</h1>
            <p className="text-sm text-slate-500 mt-1">
              {data ? `${data.awb} · ${data.courier_code}` : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}>
                {data.status}
              </span>
            )}
            <button type="button" onClick={() => load()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        {loading ? (
          <p className="text-sm text-slate-500">Loading tracking history…</p>
        ) : (data?.events ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No scans yet for this tracking number.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {data!.events.map((e, i) => {
              const t = statusTone(e.normalized_status);
              return (
                <li key={`${e.action_date}-${e.action_time}-${i}`} className="flex gap-3">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT_CLASS[t]}`} aria-hidden="true" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-slate-900">{e.action_description}</span>
                    <span className="text-xs text-slate-500">
                      {[e.action_date, e.action_time].filter(Boolean).join(" · ")}
                      {e.action_location ? ` · ${e.action_location}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Point the route at it and clean the nav**

In `web/src/App.tsx`, replace the `ShipmentDetail` import with `ShipmentHistory` and change the route:

```tsx
import ShipmentHistory from "./pages/ShipmentHistory";
```
```tsx
<Route path="/shipments/:id" element={<ShipmentHistory />} />
```

In `web/src/lib/app-nav.ts`, delete `{ label: "Shipments", href: "/shipments" },` from the top level and `{ label: "Shipments", href: "/shipments" },` from the Orders children.

Delete the now-unused pages:

```bash
Remove-Item web/src/pages/ShipmentDetail.tsx, web/src/pages/Shipments.tsx
```

Then run `npx tsc --noEmit` and fix any import that still referenced the deleted pages. `web/tests/shipments-page.test.tsx` renders the deleted `Shipments` page — **delete that test file too**, and remove the two shipment-page tests from `web/tests/fe5-reports-shipments.test.tsx`, keeping its GST and profit tests. `web/tests/shipments.test.tsx` is an unrelated `slaTone` test — leave it.

- [ ] **Step 5: Run tests**

Run: `cd web; npx vitest run tests/shipment-history.test.tsx tests/shipments-client.test.tsx tests/fe5-reports-shipments.test.tsx`
Expected: PASS

Run: `cd web; npx vitest run`
Expected: the same 4 pre-existing failing files (dashboard, nav×3, new-order, scan-sound) and nothing else. `nav.test.tsx` asserts on nav labels — if removing the Shipments entry breaks an assertion, update that assertion deliberately and say so.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ShipmentHistory.tsx web/src/App.tsx web/src/lib/app-nav.ts web/tests/shipment-history.test.tsx
git add -u web/src/pages web/tests
git commit -m "feat: tracking history page and Orders-only shipment entry point"
```

---

### Task 12: End-to-end verification and docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: a documented env contract and a verified end-to-end push.

- [ ] **Step 1: Run the backend suite**

Run: `cd backend; python -m pytest tests -q`
Expected: PASS with zero failures. It takes 4-6 minutes.

- [ ] **Step 2: Run the frontend suite**

Run: `cd web; npx vitest run`
Expected: only the 4 pre-existing failing files. Report the exact counts.

- [ ] **Step 3: Verify the real PushShipment payload against ShipSagar**

With `SHIPSAGAR_TOKEN`, `SHIPSAGAR_CLIENT_CODE`, `SHIPSAGAR_EMAIL` and `SHIPSAGAR_COMPANY` set in `backend/.env`, restart the backend, log in, and call `GET /api/v1/shipments/couriers`. Record the **exact India Post courier code** ShipSagar returns for your account and compare it with `COURIER_ALIASES` in `backend/app/services/shipsagar_service.py`. If they differ, add the real code to the alias map and re-run the alias test.

Then push one real order and confirm the request ShipSagar receives carries all eleven fields with `OrderNo` in `YYYYMMDD-NNN` form and `EmailID` equal to `SHIPSAGAR_EMAIL`.

- [ ] **Step 4: Verify no secret leaks to the browser**

Run: `cd web; npm run build`, then grep the built output for `SHIPSAGAR_TOKEN`, `SHIPSAGAR_CLIENT_CODE`, `SHIPSAGAR_EMAIL` and `SHIPSAGAR_COMPANY`. Expected: zero matches.

- [ ] **Step 5: Document the env contract**

In `README.md`, extend the existing `## ShipSagar` section with:

```markdown
### ShipSagar environment

| Variable | Purpose |
| --- | --- |
| `SHIPSAGAR_TOKEN` | "api key" from the ShipSagar client profile page |
| `SHIPSAGAR_CLIENT_CODE` | "client code" from the client profile page |
| `SHIPSAGAR_EMAIL` | constant `EmailID` sent on every shipment |
| `SHIPSAGAR_COMPANY` | constant `CompanyName` sent on every shipment |
| `SHIPSAGAR_API_BASE_URL` | defaults to `https://app.shipsagar.com/api/Web` |
| `SHIPSAGAR_WEBHOOK_SECRET` | HMAC secret for the inbound webhook |

Set these in `backend/.env` only. Never in `web/.env` — anything prefixed `VITE_`
is compiled into the browser bundle and visible to every visitor.

Orders are the only entry point for shipments. A synced Shopify order starts in
`AWAITING_TRACKING`; open the Orders page and use **Add Shipment** to enter the
tracking number the India Post worker issued. Manual orders ask for the tracking
number immediately after they are created. Clicking a tracking number opens the
full scan history from ShipSagar's `TrackShipment`.
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: ShipSagar environment and the orders-driven shipment flow"
```