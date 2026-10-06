# ShipSagar Push + Track, Shipments Page Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the speculative ShipSagar HTTP stub with the real `PushShipment` and `TrackShipment` endpoints, and rebuild `/shipments` so a user can pick an order, type the India Post worker's tracking number, push it to ShipSagar, and watch every parcel's live location on a ~25 second auto-refresh.

**Architecture:** ShipSagar becomes a real carrier provider behind the existing `app.carriers.registry` seam, so `POST /api/v1/shipments/{id}/sync` and `POST /poll-sweep` drive it with no changes. A new `POST /api/v1/shipments/push` endpoint auto-creates the `Parcel` (satisfying the NOT NULL `parcel_id` FK), creates the `Shipment`, and calls `PushShipment`. The list endpoint gains date filters, facet counts, and Order-joined display columns. The React page is rewritten in the Tailwind dialect already used by `Orders.tsx`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic (no new migration) · pytest + TestClient + in-memory SQLite · React 18 + TypeScript + Vite + Tailwind + vitest + @testing-library/react

## Global Constraints

- ShipSagar base URL is `https://app.shipsagar.com/api/Web`; credentials go in the JSON **body** as `Token` and `ClientCode` — never an `Authorization` header.
- ShipSagar's success body is lowercase `{"status": "success"}` and its failure body is `{"Status": "ERROR"}`. Compare status case-insensitively; read the message from `message` or `Message`.
- New settings are `SHIPSAGAR_TOKEN` and `SHIPSAGAR_CLIENT_CODE`. `shipsagar_api_key` stays as a deprecated alias for the token.
- `is_configured()` keys off **token and client code only** — never the base URL. Tests depend on this to force stub mode.
- No Alembic migration. The `shipments` table gains no columns.
- The auto-created `Parcel` uses `barcode_value = tracking_no` and `parcel_code = tracking_no[:32]`.
- `Shipment.shipsagar_tracking_id` is `f"SS-{tracking_no}"` when configured, and `f"SS-STUB-{courier_code}-{tracking_no}"` when not.
- Pushed shipments get `tracking_status = "READY_TO_SHIP"`.
- Status vocabulary is the existing 10-state set. An unmatched raw status is `EXCEPTION`; an empty raw status is `NOT_CREATED`.
- Preserve these exact UI strings — existing tests assert on them: `ShipSagar health: N failed webhooks · M pending retries`, the `Retry drain` button label, `Retry drain complete`, and `Retry drain complete: 3 drained, 1 requeued, 0 dead-lettered (4 checked)`.
- The provider badge is rendered inside a combined tracking-cell span (`IP · ShipSagar`), never as a standalone `ShipSagar` element. `getAllByText("ShipSagar", { exact: true })` must resolve to zero nodes on the page.
- Backend tests run from `backend/`: `python -m pytest tests/test_X.py -v`. Frontend tests run from `web/`: `npx vitest run tests/X.test.tsx`.
- There is no `conftest.py`; every backend test file hand-rolls its own `_mk()` / `_client()` / `_authed()` helpers. Follow that pattern.
- Do not add inline code comments. `shipsagar_service.py` uses `# --- name ---` section banners; match that style there.

---

### Task 1: ShipSagar settings and `.env.example`

**Files:**
- Modify: `backend/app/config.py:37-42`
- Modify: `.env.example`
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `settings.shipsagar_token: str`, `settings.shipsagar_client_code: str`, `settings.shipsagar_api_base_url: str` defaulting to `"https://app.shipsagar.com/api/Web"`; `shipsagar_api_key` retained as a deprecated alias; `shipsagar_webhook_secret` unchanged.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- settings ---

def test_shipsagar_settings_exist_and_default_to_unconfigured():
    from app import config
    from app.config import Settings
    s = Settings()
    assert s.shipsagar_token == ""
    assert s.shipsagar_client_code == ""
    # Base URL carries the real ShipSagar host but is not part of is_configured().
    assert s.shipsagar_api_base_url == "https://app.shipsagar.com/api/Web"
    assert hasattr(config.settings, "shipsagar_webhook_secret")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; python -m pytest tests/test_shipsagar.py::test_shipsagar_settings_exist_and_default_to_unconfigured -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'shipsagar_token'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/config.py`, replace the ShipSagar block (currently lines 37-42) with:

```python
    # ShipSagar Aggregation Provider (India Post + DTDC tracking via ShipSagar).
    # Credentials come from the ShipSagar client profile page: "api key" -> token,
    # "client code" -> client code. Both travel in the JSON body, not as headers.
    shipsagar_api_base_url: str = "https://app.shipsagar.com/api/Web"
    shipsagar_token: str = ""
    shipsagar_client_code: str = ""
    shipsagar_api_key: str = ""  # deprecated alias for shipsagar_token
    shipsagar_webhook_secret: str = ""
```

In `.env.example`, append:

```
# ShipSagar aggregation API (client profile page: "api key" and "client code")
SHIPSAGAR_API_BASE_URL=https://app.shipsagar.com/api/Web
SHIPSAGAR_TOKEN=
SHIPSAGAR_CLIENT_CODE=
SHIPSAGAR_WEBHOOK_SECRET=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q`
Expected: PASS (13 existing + 1 new = 14 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py .env.example backend/tests/test_shipsagar.py
git commit -m "feat: add ShipSagar token and client code settings"
```

---

### Task 2: Real ShipSagar HTTP client — `_post`, `push_shipment`, `track_shipment`

**Files:**
- Modify: `backend/app/services/shipsagar_service.py:1-14` (docstring), `:42-43` (add constants), `:225-226` (`is_configured`), `:229-267` (`_post` and its section banner)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `settings.shipsagar_token`, `settings.shipsagar_client_code`, `settings.shipsagar_api_base_url`, `settings.shipsagar_api_key` (Task 1).
- Produces:
  - `is_configured() -> bool`
  - `_post(path: str, payload: dict) -> dict` — raises `ShipsagarError` with code `SHIPSAGAR_NOT_CONFIGURED`, `SHIPSAGAR_CLIENT_MISSING`, `SHIPSAGAR_API_ERROR`, or `SHIPSAGAR_BAD_RESPONSE`. **Signature unchanged** — an existing test monkeypatches it as `_boom(path, payload)`.
  - `_base_url() -> str`, `_auth_payload() -> dict`, `_status_of(data) -> str`, `_is_ok(data) -> bool`, `_message_of(data) -> str`
  - `build_push_payload(*, tracking_no, courier_code, order) -> dict` — the nine PushShipment business fields (ShipSagar merges `Token`/`ClientCode` in via `_post`).
  - `push_shipment(*, tracking_no: str, courier_code: str, order) -> dict` — returns `{"ok": bool, "message": str}`; never raises for a provider-level ERROR.
  - `track_shipment(tracking_no: str, courier_code: str = "") -> dict` — returns `{"awb": str, "events": [...]}`.
  - `SHIPSAGAR_NOT_CONFIGURED_MESSAGE`, `DEFAULT_BASE_URL`, `PUSH_SHIPMENT_PATH`, `TRACK_SHIPMENT_PATH`, `DEFAULT_COUNTRY`, `DEFAULT_SHIPMENT_TYPE`.

  `register_tracking` is left untouched in this task and is rewritten in Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- real ShipSagar client: PushShipment + TrackShipment ---

def _configured(monkeypatch, token="TOK", client_code="C1001"):
    from app import config
    monkeypatch.setattr(config.settings, "shipsagar_token", token)
    monkeypatch.setattr(config.settings, "shipsagar_client_code", client_code)
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")


class _OrderStub:
    internal_order_number = "MAN-AB12CD34"
    shopify_order_name = "#10452"
    receiver_name = "Dileep Kumar"
    receiver_email = "rahul@example.com"
    receiver_mobile = "9963026645"
    receiver_company = "Reshamgath"


def test_is_configured_keys_off_token_and_client_code(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    assert ss.is_configured() is False
    _configured(monkeypatch, token="T", client_code="")
    assert ss.is_configured() is False
    _configured(monkeypatch, token="", client_code="C")
    assert ss.is_configured() is False
    _configured(monkeypatch)
    assert ss.is_configured() is True


def test_is_configured_accepts_deprecated_api_key_as_token(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "C1001")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "LEGACY")
    assert ss.is_configured() is True


def test_post_sends_token_and_client_code_in_the_body(monkeypatch):
    """Real ShipSagar auth is body-based; no Authorization header is sent."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch, token="TOK9", client_code="C1001")
    seen = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"status": "success", "message": "Data has been recorded successfully"}

    def _fake_post(url, json=None, headers=None, timeout=None):
        seen["url"] = url
        seen["json"] = json
        seen["headers"] = headers
        return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "post", _fake_post)
    out = ss._post("/PushShipment", {"TrackingNo": "EG080960145IN"})
    assert seen["url"] == "https://app.shipsagar.com/api/Web/PushShipment"
    assert seen["json"]["Token"] == "TOK9"
    assert seen["json"]["ClientCode"] == "C1001"
    assert seen["json"]["TrackingNo"] == "EG080960145IN"
    assert not (seen["headers"] or {}).get("Authorization")
    assert out["status"] == "success"


def test_build_push_payload_maps_every_business_field():
    from app.services.shipsagar_service import build_push_payload
    payload = build_push_payload(
        tracking_no="EG080960145IN", courier_code="ip", order=_OrderStub())
    assert payload["CourierCode"] == "IP"
    assert payload["TrackingNo"] == "EG080960145IN"
    assert payload["OrderNo"] == "MAN-AB12CD34"
    assert payload["CustomerName"] == "Dileep Kumar"
    assert payload["EmailID"] == "rahul@example.com"
    assert payload["MobileNo"] == "9963026645"
    assert payload["ShipmentType"] == "Road"
    assert payload["CountryName"] == "India"
    assert payload["CompanyName"] == "Reshamgath"


def test_build_push_payload_blanks_missing_optional_fields():
    from app.services import shipsagar_service as ss
    o = _OrderStub()
    o.receiver_email = ""
    o.receiver_company = ""
    payload = ss.build_push_payload(tracking_no="T1", courier_code="IP", order=o)
    assert payload["EmailID"] == ""
    assert payload["CompanyName"] == ""


def test_push_shipment_success_and_error_shapes(monkeypatch):
    """Success is lowercase 'success'; failure is uppercase 'Status'/'Message'."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "status": "success", "message": "Data has been recorded successfully"})
    out = ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
    assert out == {"ok": True, "message": "Data has been recorded successfully"}

    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "Status": "ERROR", "Message": "please try again later"})
    out = ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
    assert out["ok"] is False
    assert out["message"] == "please try again later"


def test_push_shipment_raises_when_not_configured(monkeypatch):
    from app import config
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        ss.push_shipment(tracking_no="T1", courier_code="IP", order=_OrderStub())
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_NOT_CONFIGURED"


TRACK_OK = {
    "status": "SUCCESS",
    "message": "3 Record Found",
    "TrackingDetails": [{
        "ClientCode": "C1001",
        "TrackingNo": "324049418658",
        "CourierCode": "ATS",
        "TrackingHistory": [
            {"ActionDate": "16-May-2023", "ActionTime": "12:27",
             "ActionLocation": "", "ActionDescription": "Label Created"},
            {"ActionDate": "16-May-2023", "ActionTime": "15:51",
             "ActionLocation": "", "ActionDescription": "Package picked up"},
            {"ActionDate": "16-May-2023", "ActionTime": "19:43",
             "ActionLocation": "New Delhi",
             "ActionDescription": "Package arrived at the carrier facility"},
        ],
    }],
}


def test_track_shipment_flattens_history_and_parses_dates(monkeypatch):
    from datetime import datetime
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: TRACK_OK)
    out = ss.track_shipment("324049418658")
    assert out["awb"] == "324049418658"
    assert len(out["events"]) == 3
    first = out["events"][0]
    assert first["status_raw"] == "Label Created"
    assert first["location"] == ""
    assert first["event_time"] == datetime(2023, 5, 16, 12, 27)
    assert out["events"][2]["location"] == "New Delhi"


def test_track_shipment_synthesizes_a_stable_event_id(monkeypatch):
    """ShipSagar sends no event id; the synthetic one makes dedupe work."""
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: TRACK_OK)
    a = ss.track_shipment("324049418658")
    b = ss.track_shipment("324049418658")
    ids_a = [e["event_id"] for e in a["events"]]
    ids_b = [e["event_id"] for e in b["events"]]
    assert ids_a == ids_b
    assert len(set(ids_a)) == 3


def test_track_shipment_raises_on_error_status(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, payload: {
        "Status": "ERROR", "Message": "please try again later"})
    try:
        ss.track_shipment("324049418658")
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "SHIPSAGAR_API_ERROR"
        assert "please try again later" in exc.message


def test_track_shipment_unparseable_date_falls_back_to_now(monkeypatch):
    from datetime import datetime, timezone
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, pl: {
        "status": "SUCCESS", "TrackingDetails": [{
            "CourierCode": "IP", "TrackingNo": "T9", "TrackingHistory": [
                {"ActionDate": "not-a-date", "ActionTime": "99:99",
                 "ActionLocation": "X", "ActionDescription": "Item Booked"}]}]})
    out = ss.track_shipment("T9")
    et = out["events"][0]["event_time"]
    assert abs((datetime.now(timezone.utc) - et).total_seconds()) < 120


def test_track_shipment_handles_empty_tracking_details(monkeypatch):
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    monkeypatch.setattr(ss, "_post", lambda path, pl: {
        "status": "SUCCESS", "message": "0 Record Found", "TrackingDetails": []})
    assert ss.track_shipment("NOPE") == {"awb": "NOPE", "events": []}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "post_sends or push_payload or push_shipment or track_shipment or is_configured"`
Expected: FAIL — `AttributeError: module 'app.services.shipsagar_service' has no attribute 'build_push_payload'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/shipsagar_service.py`, replace the module docstring (lines 1-14) with:

```python
"""ShipSagar provider adapter.

ShipSagar aggregates courier tracking for many carriers. Identity chain::

    parcel_id -> shipment_id -> courier_tracking_number (shipments.awb_number)
        -> shipsagar_tracking_id

ShipSagar IDs are provider references only — never business IDs.

Two endpoints are integrated against https://app.shipsagar.com/api/Web:
``PushShipment`` (register a shipment) and ``TrackShipment`` (poll history).
Both authenticate with ``Token`` + ``ClientCode`` carried in the JSON body.

Webhook ingest, signature verification, idempotency, retry/backoff and health
counters are unchanged. ShipSagar's own key casing is inconsistent between its
success and failure bodies, so every status read goes through ``_status_of``.
"""
```

Add after `MAX_ATTEMPTS = 4` (line 43):

```python
DEFAULT_BASE_URL = "https://app.shipsagar.com/api/Web"
PUSH_SHIPMENT_PATH = "/PushShipment"
TRACK_SHIPMENT_PATH = "/TrackShipment"
SHIPSAGAR_NOT_CONFIGURED_MESSAGE = (
    "ShipSagar credentials absent — set SHIPSAGAR_TOKEN and SHIPSAGAR_CLIENT_CODE.")

# ShipSagar's PushShipment contract. Country and transport mode are fixed for
# this deployment; everything else is mapped from the Order at push time.
DEFAULT_COUNTRY = "India"
DEFAULT_SHIPMENT_TYPE = "Road"
```

Replace `is_configured` (lines 225-226) with:

```python
def is_configured() -> bool:
    token = (settings.shipsagar_token or settings.shipsagar_api_key or "").strip()
    return bool(token and (settings.shipsagar_client_code or "").strip())
```

Then replace everything from the `# ---` banner above `class ShipsagarError` through the end of `_post` (lines 229-267) with the following, keeping `class ShipsagarError` exactly where it is relative to the functions that raise it — i.e. put the helpers after the class:

```python
class ShipsagarError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Real ShipSagar HTTP client: PushShipment + TrackShipment
# ---------------------------------------------------------------------------

def _base_url() -> str:
    return (settings.shipsagar_api_base_url or DEFAULT_BASE_URL).rstrip("/")


def _auth_payload() -> dict:
    return {
        "Token": (settings.shipsagar_token or settings.shipsagar_api_key or "").strip(),
        "ClientCode": (settings.shipsagar_client_code or "").strip(),
    }


def _status_of(data: dict) -> str:
    """ShipSagar returns 'status' on success and 'Status' on failure."""
    d = data or {}
    return str(d.get("status") or d.get("Status") or "").strip().lower()


def _message_of(data: dict) -> str:
    d = data or {}
    return str(d.get("message") or d.get("Message") or "").strip()


def _is_ok(data: dict) -> bool:
    return _status_of(data) == "success"


def _post(path: str, payload: dict) -> dict:
    """POST a ShipSagar endpoint. Auth travels in the body, not a header.

    Raises ShipsagarError for configuration, transport and malformed-response
    failures. A provider-level ERROR body is returned to the caller so
    push_shipment can report it without raising.
    """
    if not is_configured():
        raise ShipsagarError("SHIPSAGAR_NOT_CONFIGURED", SHIPSAGAR_NOT_CONFIGURED_MESSAGE)
    try:
        import httpx
    except ImportError as exc:
        raise ShipsagarError("SHIPSAGAR_CLIENT_MISSING", "httpx is not installed.") from exc
    import httpx as _httpx
    body = {**_auth_payload(), **(payload or {})}
    try:
        resp = _httpx.post(_base_url() + path, json=body,
                           headers={"Content-Type": "application/json"}, timeout=10.0)
    except Exception as exc:
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             f"ShipSagar request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             f"ShipSagar API {resp.status_code}: {str(resp.text)[:500]}")
    try:
        return resp.json()
    except Exception as exc:
        raise ShipsagarError("SHIPSAGAR_BAD_RESPONSE",
                             "ShipSagar returned non-JSON.") from exc


def build_push_payload(*, tracking_no: str, courier_code: str, order) -> dict:
    """Map an Order onto the PushShipment business fields."""
    return {
        "CourierCode": (courier_code or "").strip().upper(),
        "TrackingNo": (tracking_no or "").strip(),
        "OrderNo": str(getattr(order, "internal_order_number", "")
                       or getattr(order, "shopify_order_name", "") or "").strip(),
        "CustomerName": str(getattr(order, "receiver_name", "") or "").strip(),
        "EmailID": str(getattr(order, "receiver_email", "") or "").strip(),
        "ShipmentType": DEFAULT_SHIPMENT_TYPE,
        "MobileNo": str(getattr(order, "receiver_mobile", "") or "").strip(),
        "CountryName": DEFAULT_COUNTRY,
        "CompanyName": str(getattr(order, "receiver_company", "") or "").strip(),
    }


def push_shipment(*, tracking_no: str, courier_code: str, order) -> dict:
    """Register a shipment with ShipSagar. Returns {"ok", "message"}.

    A provider-level ERROR is a returned result, not an exception — the local
    Shipment already exists by the time this is called.
    """
    data = _post(PUSH_SHIPMENT_PATH,
                 build_push_payload(tracking_no=tracking_no,
                                    courier_code=courier_code, order=order))
    return {"ok": _is_ok(data), "message": _message_of(data)}


def _parse_event_time(date_str, time_str):
    """ShipSagar splits the timestamp into '16-May-2023' and '12:27'."""
    from datetime import datetime as _dt
    raw = f"{str(date_str or '').strip()} {str(time_str or '').strip()}".strip()
    if raw:
        for fmt in ("%d-%b-%Y %H:%M", "%d-%b-%Y %I:%M %p", "%d-%B-%Y %H:%M"):
            try:
                return _dt.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return _now()


def track_shipment(tracking_no: str, courier_code: str = "") -> dict:
    """Fetch tracking history for one AWB. Returns {"awb", "events"}.

    ShipSagar returns a TrackingDetails array for a single TrackingNo and no
    event identifier, so event_id is synthesized from the AWB, the event's own
    timestamp and its index. That makes repeated polls dedupe cleanly through
    shipment_service.ingest_event.
    """
    awb = (tracking_no or "").strip()
    data = _post(TRACK_SHIPMENT_PATH, {"TrackingNo": awb})
    if not _is_ok(data):
        raise ShipsagarError("SHIPSAGAR_API_ERROR",
                             _message_of(data) or "ShipSagar TrackShipment failed.")
    details = data.get("TrackingDetails") or []
    if not details:
        return {"awb": awb, "events": []}
    detail = details[0] or {}
    resolved_courier = str(detail.get("CourierCode") or courier_code or "").strip()
    events = []
    for idx, raw_ev in enumerate(detail.get("TrackingHistory") or []):
        raw_ev = raw_ev or {}
        at_date = str(raw_ev.get("ActionDate") or "").strip()
        at_time = str(raw_ev.get("ActionTime") or "").strip()
        description = str(raw_ev.get("ActionDescription") or "").strip()
        events.append({
            "event_id": f"ss-{awb}-{at_date}-{at_time}-{idx}",
            "status_raw": description,
            "normalized_status": normalize_shipsagar_status(resolved_courier, description),
            "message": description,
            "location": str(raw_ev.get("ActionLocation") or "").strip(),
            "event_time": _parse_event_time(at_date, at_time),
        })
    return {"awb": awb, "events": events}
```

- [ ] **Step 4: Verify the new tests pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "post_sends or push_payload or push_shipment or track_shipment or is_configured"`
Expected: PASS (11 tests)

Two pre-existing tests will now fail, because they forced configured mode through the old `shipsagar_api_base_url` / `shipsagar_api_key` fields. That is expected and resolved in Step 5.

- [ ] **Step 5: Update the helpers and tests that forced configured mode**

Four sites in `backend/tests/test_shipsagar.py` force stub/live mode by patching `shipsagar_api_base_url` / `shipsagar_api_key`. Under the new `is_configured()` those patches are no-ops, so **all four** must be repointed at the new fields.

In `_client` (lines 51-52), replace:

```python
    monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
```

with:

```python
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
```

In `test_register_tracking_stub_keeps_identity_chain` (lines 267-268), make the same three-line replacement.

In `test_retry_drain_marks_done_and_dead_letters` (lines 426-427), make the same three-line replacement. Then at lines 448-449, replace:

```python
        monkeypatch.setattr(config.settings, "shipsagar_api_base_url", "https://example.invalid")
        monkeypatch.setattr(config.settings, "shipsagar_api_key", "k")
```

with:

```python
        monkeypatch.setattr(config.settings, "shipsagar_token", "TOK")
        monkeypatch.setattr(config.settings, "shipsagar_client_code", "C1001")
```

A test that leaves a stub-mode site unpatched would silently attempt a live network call to `https://app.shipsagar.com` the moment real credentials land in `.env`.

- [ ] **Step 6: Run the ShipSagar and final-fixes suites**

Run: `cd backend; python -m pytest tests/test_shipsagar.py tests/test_final_fixes.py -q`
Expected: fully green. (Verified during execution — this step originally predicted
one surviving failure, but Step 5's repointing clears it. If your run is green,
that is the correct outcome; only investigate if something fails.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/shipsagar_service.py backend/tests/test_shipsagar.py
git commit -m "feat: real ShipSagar PushShipment and TrackShipment client"
```

---

### Task 3: Generic courier fallback in status normalization

**Files:**
- Modify: `backend/app/services/shipsagar_service.py:57-126`
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing.
- Produces: module-level `_GENERIC_MATRIX: list[tuple[str, str]]` (keyword, status) and a widened `normalize_shipsagar_status(courier: str, raw: str) -> str` that consults `_GENERIC_MATRIX` when the courier is neither `INDIA_POST` nor `DTDC`. Unmatched still returns `EXCEPTION`; empty raw still returns `NOT_CREATED`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- generic courier fallback matrix ---

def test_generic_matrix_covers_non_india_post_couriers():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    cases = [
        ("FEDEX", "Delivered", "DELIVERED"),
        ("FEDEX", "Out for delivery", "OUT_FOR_DELIVERY"),
        ("FEDEX", "In transit", "IN_TRANSIT"),
        ("FEDEX", "Package picked up", "READY_TO_SHIP"),
        ("FEDEX", "Arrived at facility", "IN_TRANSIT"),
        ("FEDEX", "Delivery attempted", "FAILED_ATTEMPT"),
        ("FEDEX", "Returned to sender", "RETURNED"),
        ("FEDEX", "RTO", "RTO"),
        ("FEDEX", "Package lost", "LOST"),
        ("FEDEX", "Damaged", "EXCEPTION"),
        ("IP", "Item Delivered", "DELIVERED"),
        ("IP", "Item Booked", "READY_TO_SHIP"),
        ("IP", "Undelivered", "FAILED_ATTEMPT"),
    ]
    for courier, raw, expected in cases:
        assert norm(courier, raw) == expected, f"{courier}/{raw}"


def test_generic_matrix_still_falls_back_to_exception():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    assert norm("FEDEX", "some future unknown phrase xyz") == "EXCEPTION"
    assert norm("FEDEX", "") == "NOT_CREATED"


def test_generic_matrix_does_not_shadow_courier_specific_rows():
    from app.services.shipsagar_service import normalize_shipsagar_status as norm
    # "undelivered" must win over "delivered" for every courier.
    assert norm("FEDEX", "Undelivered") == "FAILED_ATTEMPT"
    assert norm("INDIA_POST", "Undelivered") == "FAILED_ATTEMPT"
    assert norm("DTDC", "Not delivered") == "FAILED_ATTEMPT"
```

Then **update** the existing case at `backend/tests/test_shipsagar.py:123`, which currently reads `("UNKNOWN_COURIER", "delivered", "EXCEPTION")` — change it to `("UNKNOWN_COURIER", "delivered", "DELIVERED")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "generic_matrix or normalization_matrix"`
Expected: FAIL — `("FEDEX", "Delivered", "DELIVERED")` returns `EXCEPTION`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/shipsagar_service.py`, insert after the `_MATRIX` definition (after line 108):

```python
# Fallback for every courier outside INDIA_POST / DTDC (ShipSagar aggregates many
# carriers and GetCourier is not integrated, so codes arrive unvalidated).
# Same ordering rule as _MATRIX: negative/attempt and return rows precede the
# generic "delivered" row because "undelivered" contains "delivered".
_GENERIC_MATRIX: list[tuple[str, str]] = [
    ("out for delivery", "OUT_FOR_DELIVERY"),
    ("ofd", "OUT_FOR_DELIVERY"),
    ("undelivered", "FAILED_ATTEMPT"),
    ("not delivered", "FAILED_ATTEMPT"),
    ("delivery attempted", "FAILED_ATTEMPT"),
    ("delivery failed", "FAILED_ATTEMPT"),
    ("consignee", "FAILED_ATTEMPT"),
    ("attempt", "FAILED_ATTEMPT"),
    ("returned to sender", "RETURNED"),
    ("item returned", "RETURNED"),
    ("returned", "RETURNED"),
    ("rto", "RTO"),
    ("return to origin", "RTO"),
    ("booked", "READY_TO_SHIP"),
    ("label created", "READY_TO_SHIP"),
    ("picked up", "READY_TO_SHIP"),
    ("manifested", "READY_TO_SHIP"),
    ("delivered", "DELIVERED"),
    ("lost", "LOST"),
    ("damaged", "EXCEPTION"),
    ("exception", "EXCEPTION"),
    ("on hold", "EXCEPTION"),
    ("detained", "EXCEPTION"),
    ("in transit", "IN_TRANSIT"),
    ("transit", "IN_TRANSIT"),
    ("shipped", "IN_TRANSIT"),
    ("dispatched", "IN_TRANSIT"),
    ("arrived", "IN_TRANSIT"),
    ("reached", "IN_TRANSIT"),
    ("received", "IN_TRANSIT"),
]
```

Then replace the body of `normalize_shipsagar_status` (lines 111-126) with:

```python
def normalize_shipsagar_status(courier: str, raw: str) -> str:
    """Normalize a courier raw status to the plan #15 vocabulary.

    Courier-specific rows win for INDIA_POST and DTDC; every other courier
    falls through to _GENERIC_MATRIX. Unrecognized strings -> EXCEPTION
    (visible, never silently swallowed). Empty string -> NOT_CREATED.
    """
    text = (raw or "").strip().lower()
    if not text:
        return "NOT_CREATED"
    code = (courier or "").upper()
    if code in SUPPORTED_COURIERS:
        for courier_key, keyword, status in _MATRIX:
            if courier_key == code and keyword in text:
                return status
        return "EXCEPTION"
    for keyword, status in _GENERIC_MATRIX:
        if keyword in text:
            return status
    return "EXCEPTION"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "normaliz or generic_matrix"`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite for regressions**

Run: `cd backend; python -m pytest tests -q`
Expected: only the one known Task-2-deferred failure; no new failures.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/shipsagar_service.py backend/tests/test_shipsagar.py
git commit -m "feat: generic courier fallback for ShipSagar status normalization"
```

---

### Task 4: `ShipsagarProvider` and shipment-aware provider routing

**Files:**
- Create: `backend/app/carriers/shipsagar.py`
- Modify: `backend/app/carriers/registry.py`
- Modify: `backend/app/services/shipment_service.py` (normalization block in `ingest_event`)
- Modify: `backend/app/api/shipments.py` (`sync` and `poll-sweep` provider lookups)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `track_shipment(tracking_no, courier_code="")`, `normalize_shipsagar_status(courier, raw)` (Tasks 2-3).
- Produces:
  - `app.carriers.shipsagar.ShipsagarProvider(courier: str = "")` with `.code = "SHIPSAGAR"`, `.capabilities()`, `.validate_credentials(creds)`, `.normalize_status(raw)`, `.get_tracking(awb, creds=None)`.
  - `registry.provider_code_for_shipment(shipment) -> str`
  - `registry.provider_for_shipment(shipment) -> CarrierProvider`
  - `registry.normalize_for_shipment(shipment, raw) -> str`
  - `registry.PROVIDERS["SHIPSAGAR"]`

**Why this is needed:** a pushed shipment stores the *ShipSagar* courier code (`IP`, `FEDEX`) in `carrier_code`, not one of our provider keys. `get_provider("IP")` would raise `CARRIER_NOT_CONNECTED`, and `ingest_event` would normalize to `UNKNOWN`. `shipsagar_tracking_id` presence is the reliable discriminator.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- ShipsagarProvider wiring ---

def test_registry_exposes_shipsagar_provider():
    from app.carriers.registry import PROVIDERS, get_provider
    assert "SHIPSAGAR" in PROVIDERS
    p = get_provider("SHIPSAGAR")
    assert p.code == "SHIPSAGAR"
    assert "TRACKING" in p.capabilities()


def test_provider_for_shipment_routes_on_shipsagar_tracking_id():
    from app.carriers.registry import (normalize_for_shipment,
                                       provider_code_for_shipment,
                                       provider_for_shipment)

    class _Pushed:
        carrier_code = "IP"
        shipsagar_tracking_id = "SS-EG080960145IN"

    assert provider_code_for_shipment(_Pushed()) == "SHIPSAGAR"
    assert provider_for_shipment(_Pushed()).code == "SHIPSAGAR"
    assert normalize_for_shipment(_Pushed(), "Item Delivered") == "DELIVERED"

    class _Direct:
        carrier_code = "INDIA_POST"
        shipsagar_tracking_id = None

    assert provider_code_for_shipment(_Direct()) == "INDIA_POST"
    assert provider_for_shipment(_Direct()).code == "INDIA_POST"
    assert normalize_for_shipment(_Direct(), "Item Delivered") == "DELIVERED"


def test_shipsagar_provider_get_tracking_delegates(monkeypatch):
    from app.carriers import shipsagar as ssmod
    p = ssmod.ShipsagarProvider(courier="IP")
    monkeypatch.setattr(ssmod, "track_shipment", lambda awb, courier_code="": {
        "awb": awb, "events": [{
            "event_id": "e1", "status_raw": "Item Delivered",
            "normalized_status": "DELIVERED", "message": "Item Delivered",
            "location": "Delhi", "event_time": "2023-05-16T19:43:00+00:00"}]})
    out = p.get_tracking("EG080960145IN")
    assert out["awb"] == "EG080960145IN"
    assert out["events"][0]["normalized_status"] == "DELIVERED"


def test_shipsagar_provider_normalize_uses_its_courier():
    from app.carriers.shipsagar import ShipsagarProvider
    assert ShipsagarProvider(courier="FEDEX").normalize_status("Delivered") == "DELIVERED"
    assert ShipsagarProvider(courier="IP").normalize_status("Item Booked") == "READY_TO_SHIP"


def test_shipsagar_provider_raises_carrier_error_when_unconfigured(monkeypatch):
    from app import config
    from app.carriers.base import CarrierError
    from app.carriers.shipsagar import ShipsagarProvider
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        ShipsagarProvider(courier="IP").get_tracking("EG1")
        raise AssertionError("expected CarrierError")
    except CarrierError as exc:
        assert exc.code == "CARRIER_NOT_CONNECTED"


def _seed_pushed_shipment(mk, awb="EG080960145IN", courier="IP", status="READY_TO_SHIP"):
    from app.models.business import Business
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    s = Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                 carrier_code=courier, awb_number=awb, tracking_status=status,
                 shipsagar_tracking_id=f"SS-{awb}")
    db.add(s)
    db.commit()
    db.refresh(s)
    sid, bid = s.id, b.id
    db.close()
    return sid, bid


def test_sync_endpoint_pulls_shipsagar_history(monkeypatch):
    """A pushed shipment's sync hits TrackShipment and rolls the status up."""
    from app.models.shipment import Shipment, ShipmentEvent
    mk = _mk()
    sid, bid = _seed_pushed_shipment(mk)
    c, h, _ = _authed(monkeypatch, mk)
    try:
        calls = []

        def _fake_track(tracking_no, courier_code=""):
            calls.append((tracking_no, courier_code))
            from datetime import datetime as _dt, timezone as _tz
            return {"awb": tracking_no, "events": [{
                "event_id": "ss-EG080960145IN-16-May-2023-19:43-0",
                "status_raw": "Out for delivery",
                "normalized_status": "OUT_FOR_DELIVERY",
                "message": "Out for delivery", "location": "New Delhi",
                "event_time": _dt.now(_tz.utc)}]}

        from app.carriers import shipsagar as ssmod
        monkeypatch.setattr(ssmod, "track_shipment", _fake_track)
        r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["synced"] is True
        assert calls == [("EG080960145IN", "IP")]
        db = mk()
        try:
            s = db.query(Shipment).filter_by(id=sid).first()
            assert s.tracking_status == "OUT_FOR_DELIVERY"
            assert s.current_location == "New Delhi"
            assert db.query(ShipmentEvent).filter_by(shipment_id=sid).count() == 1
        finally:
            db.close()
        # A second sync inside the 60s cooldown is refused, not double-counted.
        r = c.post(f"/api/v1/shipments/{sid}/sync", headers=h)
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "REFRESH_COOLDOWN"
    finally:
        app.dependency_overrides.clear()


def test_poll_sweep_includes_shipsagar_shipments(monkeypatch):
    from datetime import datetime as _dt, timezone as _tz
    from app.carriers import shipsagar as ssmod
    mk = _mk()
    sid, bid = _seed_pushed_shipment(mk, awb="EG080960000IN", status="READY_TO_SHIP")
    c, h, _ = _authed(monkeypatch, mk)
    try:
        monkeypatch.setattr(ssmod, "track_shipment", lambda awb, courier_code="": {
            "awb": awb, "events": [{
                "event_id": f"ss-{awb}-0", "status_raw": "Delivered",
                "normalized_status": "DELIVERED", "message": "Delivered",
                "location": "Pune", "event_time": _dt.now(_tz.utc)}]})
        r = c.post("/api/v1/shipments/poll-sweep", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["checked"] == 1
        assert data["synced"] == 1
        assert data["skipped"] == 0
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "registry_exposes or provider_for_shipment or shipsagar_provider or sync_endpoint_pulls or poll_sweep_includes"`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.carriers.shipsagar'`

- [ ] **Step 3: Create the provider**

Write `backend/app/carriers/shipsagar.py`:

```python
"""ShipSagar aggregation provider.

ShipSagar proxies tracking for many carriers, so the registry key is
``SHIPSAGAR`` while the underlying courier (``IP``, ``FEDEX``, ``DTDC``, ...)
lives on the shipment. The courier is supplied per instance so status
normalization can pick the right matrix.
"""

from .base import CarrierError, CarrierProvider
from app.services import shipsagar_service as ss


class ShipsagarProvider(CarrierProvider):
    code = "SHIPSAGAR"
    name = "ShipSagar"

    def __init__(self, courier: str = ""):
        self.courier = (courier or "").strip().upper()

    def capabilities(self) -> list[str]:
        return ["TRACKING"]

    def validate_credentials(self, creds: dict) -> bool:
        return ss.is_configured()

    def normalize_status(self, raw: str) -> str:
        return ss.normalize_shipsagar_status(self.courier, raw)

    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        if not awb or not str(awb).strip():
            raise CarrierError("CARRIER_NOT_CONNECTED",
                               "ShipSagar needs a tracking number.")
        if not ss.is_configured():
            raise CarrierError("CARRIER_NOT_CONNECTED",
                               "ShipSagar is not connected. Set SHIPSAGAR_TOKEN "
                               "and SHIPSAGAR_CLIENT_CODE.")
        try:
            return ss.track_shipment(str(awb).strip(), self.courier)
        except ss.ShipsagarError as exc:
            raise CarrierError(exc.code, exc.message) from exc
```

- [ ] **Step 4: Register it and add the shipment-aware helpers**

Replace `backend/app/carriers/registry.py` with:

```python
from .base import CarrierError, CarrierProvider  # noqa: F401
from .manual import ManualProvider
from .dtdc import DtdcProvider
from .tirupati import TirupatiProvider
from .india_post import IndiaPostProvider
from .shipsagar import ShipsagarProvider

PROVIDERS: dict[str, CarrierProvider] = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
    "SHIPSAGAR": ShipsagarProvider(),
}


def get_provider(code: str) -> CarrierProvider:
    p = PROVIDERS.get((code or "").upper())
    if p is None:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"Unknown carrier '{code}'.")
    return p


def provider_code_for_shipment(shipment) -> str:
    """Which provider owns this shipment's tracking.

    A shipment pushed through ShipSagar keeps the ShipSagar courier code
    (IP, FEDEX, ...) in carrier_code, so the carrier code alone cannot select a
    provider. shipsagar_tracking_id is the discriminator.
    """
    if (getattr(shipment, "shipsagar_tracking_id", "") or "").strip():
        return "SHIPSAGAR"
    return (getattr(shipment, "carrier_code", "") or "").strip().upper()


def provider_for_shipment(shipment) -> CarrierProvider:
    if provider_code_for_shipment(shipment) == "SHIPSAGAR":
        return ShipsagarProvider(courier=getattr(shipment, "carrier_code", "") or "")
    return get_provider(getattr(shipment, "carrier_code", "") or "")


def normalize_for_shipment(shipment, raw: str) -> str:
    if provider_code_for_shipment(shipment) == "SHIPSAGAR":
        return ShipsagarProvider(
            courier=getattr(shipment, "carrier_code", "") or "").normalize_status(raw)
    return normalize_status(getattr(shipment, "carrier_code", "") or "", raw)


def normalize_status(code: str, raw: str) -> str:
    try:
        return get_provider(code).normalize_status(raw)
    except CarrierError:
        return "UNKNOWN"


def db_normalize(db, business_id: str, provider: str, raw: str) -> str | None:
    from app.models.courier_meta import CourierStatusMapping
    code = (raw or "").strip()
    if not code:
        return None
    for bid in (business_id, None):
        q = db.query(CourierStatusMapping).filter_by(
            provider=(provider or "").upper(), provider_status_code=code)
        if bid is None:
            q = q.filter(CourierStatusMapping.business_id.is_(None))
        else:
            q = q.filter(CourierStatusMapping.business_id == bid)
        m = q.first()
        if m is not None:
            return m.normalized_status
    return None
```

- [ ] **Step 5: Route `ingest_event` through the shipment-aware helpers**

In `backend/app/services/shipment_service.py`, inside `ingest_event`, replace the import and the normalization block:

```python
    from app.models.shipment import ShipmentEvent
    from app.carriers.registry import (db_normalize, normalize_for_shipment,
                                       provider_code_for_shipment)
    if carrier_event_id:
        existing = db.query(ShipmentEvent).filter_by(
            shipment_id=shipment.id, carrier_event_id=carrier_event_id).first()
        if existing is not None:
            return existing, False
    if isinstance(event_time, str) and event_time.strip():
        try:
            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        except ValueError:
            event_time = _now()

    raw_text = raw or ""
    try:
        norm = (db_normalize(db, shipment.business_id,
                             provider_code_for_shipment(shipment), raw_text)
                or normalize_for_shipment(shipment, raw_text))
    except Exception:
        norm = normalize_for_shipment(shipment, raw_text)
```

- [ ] **Step 6: Point `sync` and `poll-sweep` at the new resolver**

In `backend/app/api/shipments.py`, change the import line in **both** `sync` and `poll-sweep` from:

```python
    from app.carriers.registry import get_provider
```

to:

```python
    from app.carriers.registry import provider_for_shipment
```

And change both provider call sites from:

```python
            provider = get_provider(s.carrier_code)
            data = provider.get_tracking(s.awb_number)
```

to:

```python
            provider = provider_for_shipment(s)
            data = provider.get_tracking(s.awb_number)
```

Note: `poll-sweep` skips shipments whose `carrier_code == "MANUAL"` (around line 294). A pushed ShipSagar shipment carries `IP`/`FEDEX`, so it is **not** skipped — leave that check as-is.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "registry_exposes or provider_for_shipment or shipsagar_provider or sync_endpoint_pulls or poll_sweep_includes"`
Expected: PASS (6 tests)

- [ ] **Step 8: Run the full backend suite for regressions**

Run: `cd backend; python -m pytest tests -q`
Expected: no failures. (Verified during execution — this step originally predicted one
surviving Task-2-deferred failure; Task 5 already landed by then.)

- [ ] **Step 9: Commit**

```bash
git add backend/app/carriers/shipsagar.py backend/app/carriers/registry.py backend/app/services/shipment_service.py backend/app/api/shipments.py backend/tests/test_shipsagar.py
git commit -m "feat: ShipSagar carrier provider behind the existing sync and sweep"
```

---

### Task 5: Rework `register_tracking` onto `push_shipment`

**Files:**
- Modify: `backend/app/services/shipsagar_service.py` (`register_tracking`)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `push_shipment(*, tracking_no, courier_code, order)` (Task 2), `SUPPORTED_COURIERS`, `schedule_retry`.
- Produces: `register_tracking(db, shipment, *, courier: str | None = None) -> dict` returning `{"shipsagar_tracking_id": str, "stubbed": bool, "pushed": bool, "message": str}`. Behaviour: resolves the Order via `shipment.order_id`, calls `push_shipment`, sets `shipsagar_tracking_id` to `SS-{awb}` on success or `SS-STUB-{courier}-{awb}` when unconfigured, still rejects a courier outside `SUPPORTED_COURIERS` with `ShipsagarError("UNSUPPORTED_COURIER", ...)`, and still queues a retry then raises on transport failure.

`backend/app/api/shipments.py:249-273` reads only `result['stubbed']` and `result['shipsagar_tracking_id']`, both of which stay present — no endpoint change needed.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- register_tracking on the real PushShipment path ---

def _seed_shipment_with_order(mk, awb, courier="DTDC", status="READY_TO_SHIP",
                              order_no="MAN-R1"):
    from app.models.business import Business
    from app.models.order import Order
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    o = Order(business_id=b.id, internal_order_number=order_no,
              shopify_order_id=f"MANUAL-{order_no}",
              order_date=datetime.now(timezone.utc),
              receiver_name="Dileep", receiver_email="r@e.com",
              receiver_mobile="9963026645", receiver_company="Reshamgath")
    db.add(o)
    db.commit()
    db.refresh(o)
    s = Shipment(business_id=b.id, order_id=o.id, parcel_id="p1",
                 carrier_code=courier, awb_number=awb, tracking_status=status)
    db.add(s)
    db.commit()
    db.refresh(s)
    s_id = s.id
    db.close()
    return s_id


def test_register_tracking_calls_push_shipment_when_configured(monkeypatch):
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-CFG-1")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        seen = {}

        def _fake_push(*, tracking_no, courier_code, order):
            seen["awb"] = tracking_no
            seen["courier"] = courier_code
            seen["order_no"] = order.internal_order_number
            return {"ok": True, "message": "Data has been recorded successfully"}

        monkeypatch.setattr(ss, "push_shipment", _fake_push)
        out = ss.register_tracking(db, s)
        assert out["pushed"] is True
        assert out["stubbed"] is False
        assert out["shipsagar_tracking_id"] == "SS-D-CFG-1"
        assert seen == {"awb": "D-CFG-1", "courier": "DTDC", "order_no": "MAN-R1"}
        assert s.shipsagar_tracking_id == "SS-D-CFG-1"
    finally:
        db.close()


def test_register_tracking_reports_provider_error_without_raising(monkeypatch):
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-ERR-1", order_no="MAN-R2")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
            "ok": False, "message": "please try again later"})
        out = ss.register_tracking(db, s)
        assert out["pushed"] is False
        assert out["message"] == "please try again later"
        assert out["shipsagar_tracking_id"] == "SS-D-ERR-1"
    finally:
        db.close()


def test_register_tracking_stub_when_unconfigured(monkeypatch):
    from app import config
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    mk = _mk()
    sid = _seed_shipment_with_order(mk, "D-STUB", order_no="MAN-R3")
    db = mk()
    try:
        s = db.query(Shipment).filter_by(id=sid).first()
        out = ss.register_tracking(db, s)
        assert out["stubbed"] is True
        assert out["pushed"] is False
        assert out["shipsagar_tracking_id"] == "SS-STUB-DTDC-D-STUB"
        assert s.tracking_status == "READY_TO_SHIP"
    finally:
        db.close()


def test_register_tracking_still_rejects_unsupported_courier(monkeypatch):
    from app.models.business import Business
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    mk = _mk()
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    s = Shipment(business_id=b.id, order_id="o1", parcel_id="p1",
                 carrier_code="MANUAL", awb_number="M-1", tracking_status="BOOKED")
    db.add(s)
    db.commit()
    db.refresh(s)
    try:
        ss.register_tracking(db, s)
        raise AssertionError("expected ShipsagarError")
    except ss.ShipsagarError as exc:
        assert exc.code == "UNSUPPORTED_COURIER"
    finally:
        db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "register_tracking"`
Expected: FAIL — `register_tracking` still posts to `/trackings` and returns only two keys.

- [ ] **Step 3: Rewrite `register_tracking`**

In `backend/app/services/shipsagar_service.py`, replace the existing `register_tracking` function with:

```python
def register_tracking(db, shipment, *, courier: str | None = None) -> dict:
    """Register a shipment with ShipSagar via PushShipment.

    Validates the courier, maps the shipment's Order onto the PushShipment
    body, and persists the resulting shipsagar_tracking_id. A provider-level
    ERROR is reported in the return value rather than raised, because the
    Shipment already exists; a transport failure queues a bounded retry job
    and raises so the retry queue picks it up.

    Returns {"shipsagar_tracking_id", "stubbed", "pushed", "message"}.
    """
    code = ((courier or getattr(shipment, "carrier_code", "")) or "").upper()
    if code not in SUPPORTED_COURIERS:
        raise ShipsagarError("UNSUPPORTED_COURIER",
                             f"ShipSagar supports {', '.join(SUPPORTED_COURIERS)}; got '{code}'.")
    awb = (getattr(shipment, "awb_number", "") or "").strip()
    if not awb:
        raise ShipsagarError("MISSING_TRACKING_NUMBER", "courier_tracking_number is required.")

    if (getattr(shipment, "tracking_status", "") or "") in ("", "NOT_CREATED", "BOOKED"):
        shipment.tracking_status = "READY_TO_SHIP"

    if not is_configured():
        tracking_id = f"SS-STUB-{code}-{awb}"
        shipment.shipsagar_tracking_id = tracking_id
        db.flush()
        return {"shipsagar_tracking_id": tracking_id, "stubbed": True,
                "pushed": False, "message": SHIPSAGAR_NOT_CONFIGURED_MESSAGE}

    from app.models.order import Order
    order = db.query(Order).filter_by(id=shipment.order_id).first()
    try:
        result = push_shipment(tracking_no=awb, courier_code=code, order=order)
    except ShipsagarError as exc:
        schedule_retry(db, business_id=getattr(shipment, "business_id", None),
                       operation="register_tracking", shipment_id=getattr(shipment, "id", None),
                       error=f"{exc.code}: {exc.message}",
                       payload={"courier": code, "tracking_number": awb})
        db.flush()
        raise
    tracking_id = f"SS-{awb}"
    shipment.shipsagar_tracking_id = tracking_id
    db.flush()
    return {"shipsagar_tracking_id": tracking_id, "stubbed": False,
            "pushed": bool(result.get("ok")), "message": result.get("message", "")}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q`
Expected: PASS — including `test_retry_drain_marks_done_and_dead_letters` and `test_retry_drain_endpoint_and_register_envelope`, which now exercise the real code path.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend; python -m pytest tests -q`
Expected: PASS (no failures)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/shipsagar_service.py backend/tests/test_shipsagar.py
git commit -m "feat: register tracking through the real ShipSagar PushShipment call"
```

---

### Task 6: `POST /api/v1/shipments/push` with parcel auto-creation

**Files:**
- Modify: `backend/app/api/shipments.py` (add `PushShipmentIn` + the `push_shipment` route)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: `ss.is_configured()`, `ss.push_shipment`, `ss.schedule_retry`, `ss.SHIPSAGAR_NOT_CONFIGURED_MESSAGE` (Task 2), `_sdict` (current form; enriched in Task 7), `_err` (existing).
- Produces: `POST /api/v1/shipments/push` accepting `{"order_id": str, "tracking_no": str, "courier_code": str}`. Success 200 → `{"success": true, "data": {**_sdict(s), "pushed": bool, "message": str}}`. Errors: `FORBIDDEN` 403, `ORDER_NOT_FOUND` 404, `SHIPMENT_EXISTS` 400, `DUPLICATE_TRACKING` 400, `SHIPSAGAR_API_ERROR` 502.

Route placement: insert directly after `create_shipment` (which ends at line 90) and before `list_shipments`. `POST /push` cannot be shadowed by `POST /{sid}/...`, so ordering is safe either way.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- POST /api/v1/shipments/push ---

def _authed_with_order(monkeypatch, mk, role="ADMIN", email="a@t.in"):
    """Business + user + one Order. Returns (client, headers, business_id, order_id)."""
    from app.models.business import Business
    from app.models.order import Order
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = Business(name="B", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    o = Order(business_id=b.id, internal_order_number="MAN-P1",
              shopify_order_id="MANUAL-P1",
              order_date=datetime.now(timezone.utc),
              receiver_name="Dileep Kumar", receiver_email="rahul@example.com",
              receiver_mobile="9963026645", receiver_company="Reshamgath",
              receiver_city="Nashik", receiver_pincode="422001")
    db.add(o)
    db.commit()
    db.refresh(o)
    u = User(business_id=b.id, name="A", email=email,
             password_hash=hash_password("x"), role=role)
    db.add(u)
    db.commit()
    bid, oid = b.id, o.id
    db.close()
    c = _client(monkeypatch, mk)
    tok = c.post("/api/v1/auth/login",
                 json={"email": email, "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}, bid, oid


def test_push_creates_parcel_and_shipment_and_calls_shipsagar(monkeypatch):
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    seen = {}

    def _fake_push(*, tracking_no, courier_code, order):
        seen["awb"] = tracking_no
        seen["courier"] = courier_code
        seen["order_no"] = order.internal_order_number
        return {"ok": True, "message": "Data has been recorded successfully"}

    monkeypatch.setattr(ss, "push_shipment", _fake_push)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960145IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is True
        assert data["awb_number"] == "EG080960145IN"
        assert data["carrier_code"] == "IP"
        assert data["tracking_status"] == "READY_TO_SHIP"
        assert data["shipsagar_tracking_id"] == "SS-EG080960145IN"
        assert seen == {"awb": "EG080960145IN", "courier": "IP", "order_no": "MAN-P1"}
        db = mk()
        try:
            p = db.query(Parcel).filter_by(business_id=bid).first()
            assert p is not None
            assert p.barcode_value == "EG080960145IN"
            assert p.order_id == oid
            s = db.query(Shipment).filter_by(business_id=bid).first()
            assert s.parcel_id == p.id
            assert s.order_id == oid
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_when_unconfigured_creates_records_with_stub_id(monkeypatch):
    from app import config
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(config.settings, "shipsagar_token", "")
    monkeypatch.setattr(config.settings, "shipsagar_client_code", "")
    monkeypatch.setattr(config.settings, "shipsagar_api_key", "")
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960999IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is False
        assert data["shipsagar_tracking_id"] == "SS-STUB-IP-EG080960999IN"
        assert "SHIPSAGAR_TOKEN" in data["message"]
    finally:
        app.dependency_overrides.clear()


def test_push_provider_error_still_persists_and_reports(monkeypatch):
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    monkeypatch.setattr(ss, "push_shipment", lambda **kw: {
        "ok": False, "message": "please try again later"})
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG080960777IN", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pushed"] is False
        assert data["message"] == "please try again later"
        db = mk()
        try:
            assert db.query(Shipment).filter_by(business_id=bid).count() == 1
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()


def test_push_validation_errors(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "   ", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "DUPLICATE_TRACKING"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG1", "courier_code": "  "})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "DUPLICATE_TRACKING"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": "nope", "tracking_no": "EG1", "courier_code": "IP"})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "ORDER_NOT_FOUND"

        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-FIRST", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-SECOND", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "SHIPMENT_EXISTS"
    finally:
        app.dependency_overrides.clear()


def test_push_rejects_awb_already_used_for_that_courier(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-DUP", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        db = mk()
        try:
            from app.models.order import Order
            o2 = Order(business_id=bid, internal_order_number="MAN-P2",
                       shopify_order_id="MANUAL-P2",
                       order_date=datetime.now(timezone.utc))
            db.add(o2)
            db.commit()
            db.refresh(o2)
            oid2 = o2.id
        finally:
            db.close()
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid2, "tracking_no": "EG-DUP", "courier_code": "IP"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "DUPLICATE_TRACKING"
    finally:
        app.dependency_overrides.clear()


def test_push_is_tenant_scoped(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-T1", "courier_code": "IP"})
        assert r.status_code == 200, r.text
        sid = r.json()["data"]["id"]
        c2, h2, _, _ = _authed(monkeypatch, mk, role="ADMIN", email="other@t.in")
        r = c2.get(f"/api/v1/shipments/{sid}", headers=h2)
        assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()


def test_push_forbidden_for_viewer(monkeypatch):
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk, role="VIEWER")
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-V1", "courier_code": "IP"})
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "FORBIDDEN"
    finally:
        app.dependency_overrides.clear()


def test_push_queues_retry_when_provider_transport_fails(monkeypatch):
    from app.models.shipment_event import ShipsagarRetryJob
    from app.services import shipsagar_service as ss
    _configured(monkeypatch)
    mk = _mk()
    c, h, bid, oid = _authed_with_order(monkeypatch, mk)

    def _boom(**kw):
        raise ss.ShipsagarError("SHIPSAGAR_API_ERROR", "connection reset")

    monkeypatch.setattr(ss, "push_shipment", _boom)
    try:
        r = c.post("/api/v1/shipments/push", headers=h, json={
            "order_id": oid, "tracking_no": "EG-BOOM", "courier_code": "IP"})
        assert r.status_code == 502, r.text
        assert r.json()["error"]["code"] == "SHIPSAGAR_API_ERROR"
        db = mk()
        try:
            job = db.query(ShipsagarRetryJob).filter_by(operation="push_shipment").first()
            assert job is not None
            assert job.status == "PENDING"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "push_creates or push_when or push_provider or push_validation or push_rejects_awb or push_is_tenant or push_forbidden or push_queues"`
Expected: FAIL — HTTP 404 `{"detail": "Not Found"}`, since the route does not exist.

- [ ] **Step 3: Add the route**

In `backend/app/api/shipments.py`, insert after `create_shipment` (which ends at line 90):

```python
class PushShipmentIn(BaseModel):
    order_id: str
    tracking_no: str
    courier_code: str


@router.post("/push")
def push_shipment(body: PushShipmentIn, db: Session = Depends(get_db),
                  u: dict = Depends(get_current_user)):
    """Create the Parcel + Shipment for an order and register it with ShipSagar.

    Tracking numbers come from the India Post worker and are typed in by the
    user. The Parcel is auto-created so the NOT NULL parcel_id FK is satisfied.
    A provider-level ERROR still persists both records and reports pushed=false;
    a transport failure queues a retry job and returns 502.
    """
    from datetime import datetime, timezone
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    from app.services import shipsagar_service as ss
    if u.get("role") not in ("ADMIN", "WAREHOUSE"):
        return _err(403, "FORBIDDEN", "Warehouse role required")
    bid = u.get("business_id")
    tracking_no = (body.tracking_no or "").strip()
    courier_code = (body.courier_code or "").strip().upper()
    if not tracking_no or not courier_code:
        return _err(400, "DUPLICATE_TRACKING",
                    "Tracking number and courier code are required.")
    order = db.query(Order).filter_by(id=body.order_id, business_id=bid).first()
    if order is None:
        return _err(404, "ORDER_NOT_FOUND", "Order not found in this business.")
    if db.query(Shipment).filter_by(order_id=order.id).first() is not None:
        return _err(400, "SHIPMENT_EXISTS", "This order already has a shipment.")
    if db.query(Shipment).filter_by(
            business_id=bid, carrier_code=courier_code,
            awb_number=tracking_no).first() is not None:
        return _err(400, "DUPLICATE_TRACKING",
                    f"Tracking number {tracking_no} is already used for {courier_code}.")

    parcel = Parcel(business_id=bid, order_id=order.id,
                    parcel_code=tracking_no[:32], barcode_value=tracking_no[:32],
                    status="CREATED")
    db.add(parcel)
    db.flush()
    shipment = Shipment(business_id=bid, order_id=order.id, parcel_id=parcel.id,
                        carrier_code=courier_code, awb_number=tracking_no,
                        tracking_status="READY_TO_SHIP",
                        shipped_at=datetime.now(timezone.utc))
    db.add(shipment)
    db.flush()

    if not ss.is_configured():
        shipment.shipsagar_tracking_id = f"SS-STUB-{courier_code}-{tracking_no}"
        db.commit()
        db.refresh(shipment)
        return {"success": True, "data": {**_sdict(shipment), "pushed": False,
                                          "message": ss.SHIPSAGAR_NOT_CONFIGURED_MESSAGE}}
    try:
        result = ss.push_shipment(tracking_no=tracking_no,
                                  courier_code=courier_code, order=order)
    except ss.ShipsagarError as exc:
        if exc.code == "SHIPSAGAR_NOT_CONFIGURED":
            shipment.shipsagar_tracking_id = f"SS-STUB-{courier_code}-{tracking_no}"
            db.commit()
            db.refresh(shipment)
            return {"success": True, "data": {**_sdict(shipment), "pushed": False,
                                              "message": exc.message}}
        ss.schedule_retry(db, business_id=bid, operation="push_shipment",
                          shipment_id=shipment.id,
                          error=f"{exc.code}: {exc.message}",
                          payload={"courier": courier_code, "tracking_number": tracking_no})
        db.commit()
        return _err(502, exc.code, exc.message)
    shipment.shipsagar_tracking_id = f"SS-{tracking_no}"
    db.commit()
    db.refresh(shipment)
    return {"success": True, "data": {**_sdict(shipment),
                                      "pushed": bool(result.get("ok")),
                                      "message": result.get("message", "")}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "push_creates or push_when or push_provider or push_validation or push_rejects_awb or push_is_tenant or push_forbidden or push_queues"`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend; python -m pytest tests -q`
Expected: PASS (no failures)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/shipments.py backend/tests/test_shipsagar.py
git commit -m "feat: push endpoint with parcel auto-creation and retry queueing"
```

---

### Task 7: List endpoint — date filters, facets, Order-joined display columns

**Files:**
- Modify: `backend/app/api/shipments.py:19-46` (`_sdict`), `:93-119` (`list_shipments`), `:122-128` (`get_shipment`)
- Test: `backend/tests/test_shipsagar.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `_order_fields(o) -> dict` — `order_no`, `customer_name`, `customer_email`, `customer_mobile`, `company_name`, all nullable-safe.
  - `_sdict(s, order=None) -> dict` — gains those five keys plus constants `shipment_type="Road"`, `country_name="India"`, and `entry_datetime`.
  - `_day_bounds(value, is_end)` helper.
  - `GET /api/v1/shipments` accepts `date_from`, `date_to`, `order_no` in addition to `status, carrier, order_id, q, page, page_size` and returns `{"items", "total", "page", "page_size", "facets": {"carriers": [{"code","count"}], "statuses": [{"code","count"}]}}`.
  - `GET /api/v1/shipments/{sid}` returns the enriched `_sdict`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_shipsagar.py`:

```python
# --- list: date filters, facets, joined display columns ---

def _seed_list_rows(mk, n=3, courier="IP", days=(0, 1, 2), email="l@t.in"):
    from datetime import timedelta
    from app.models.business import Business
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    db = mk()
    b = Business(name="L", email=email)
    db.add(b)
    db.commit()
    db.refresh(b)
    now = datetime.now(timezone.utc)
    for i in range(n):
        o = Order(business_id=b.id, internal_order_number=f"MAN-{i}",
                  shopify_order_id=f"MANUAL-{i}", order_date=now,
                  receiver_name=f"Customer {i}", receiver_email=f"c{i}@e.com",
                  receiver_mobile=f"99630266{i:02d}", receiver_company=f"Co {i}")
        db.add(o)
        db.commit()
        db.refresh(o)
        p = Parcel(business_id=b.id, order_id=o.id, parcel_code=f"P{i}",
                   barcode_value=f"EG{i}IN")
        db.add(p)
        db.commit()
        db.refresh(p)
        s = Shipment(business_id=b.id, order_id=o.id, parcel_id=p.id,
                     carrier_code=courier, awb_number=f"EG{i}IN",
                     tracking_status="DELIVERED" if i == 0 else "IN_TRANSIT",
                     shipsagar_tracking_id=f"SS-EG{i}IN",
                     created_at=now - timedelta(days=days[i]))
        db.add(s)
        db.commit()
    bid = b.id
    db.close()
    return bid


def _authed_for_list(monkeypatch, mk, email="l@t.in"):
    from app.models.business import Business
    from app.models.user import User
    from app.services.auth_service import hash_password
    db = mk()
    b = db.query(Business).filter_by(email=email).first()
    if b is None:
        b = Business(name="L", email=email)
        db.add(b)
        db.commit()
        db.refresh(b)
    u = User(business_id=b.id, name="L", email=email,
             password_hash=hash_password("x"), role="ADMIN")
    db.add(u)
    db.commit()
    bid = b.id
    db.close()
    c = _client(monkeypatch, mk)
    tok = c.post("/api/v1/auth/login",
                 json={"email": email, "password": "x"}).json()["data"]["token"]
    return c, {"Authorization": f"Bearer {tok}"}, bid


def test_list_returns_joined_display_columns(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=1)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments", headers=h)
        assert r.status_code == 200, r.text
        row = r.json()["data"]["items"][0]
        assert row["order_no"] == "MAN-0"
        assert row["customer_name"] == "Customer 0"
        assert row["customer_email"] == "c0@e.com"
        assert row["customer_mobile"] == "9963026600"
        assert row["company_name"] == "Co 0"
        assert row["shipment_type"] == "Road"
        assert row["country_name"] == "India"
        assert row["entry_datetime"] is not None
    finally:
        app.dependency_overrides.clear()


def test_list_returns_facets_over_the_filtered_set(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3, courier="IP")
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?page_size=1", headers=h)
        data = r.json()["data"]
        assert data["total"] == 3
        assert len(data["items"]) == 1
        assert data["page_size"] == 1
        carriers = {x["code"]: x["count"] for x in data["facets"]["carriers"]}
        statuses = {x["code"]: x["count"] for x in data["facets"]["statuses"]}
        assert carriers == {"IP": 3}
        assert statuses == {"DELIVERED": 1, "IN_TRANSIT": 2}
    finally:
        app.dependency_overrides.clear()


def test_list_date_filters_narrow_the_set_and_facets(monkeypatch):
    from datetime import timedelta
    mk = _mk()
    _seed_list_rows(mk, n=3, days=(0, 1, 2))
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        today = datetime.now(timezone.utc).date()
        r = c.get(f"/api/v1/shipments?date_from={(today - timedelta(days=1)).isoformat()}",
                  headers=h)
        data = r.json()["data"]
        assert data["total"] == 2
        assert sum(x["count"] for x in data["facets"]["statuses"]) == 2
        r = c.get(f"/api/v1/shipments?date_to={(today - timedelta(days=1)).isoformat()}",
                  headers=h)
        assert r.json()["data"]["total"] == 1
    finally:
        app.dependency_overrides.clear()


def test_list_order_no_filter_matches_order_numbers(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?order_no=MAN-1", headers=h)
        assert r.json()["data"]["total"] == 1
        assert r.json()["data"]["items"][0]["awb_number"] == "EG1IN"
    finally:
        app.dependency_overrides.clear()


def test_list_carrier_filter_drives_facets(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=2, courier="IP")
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        r = c.get("/api/v1/shipments?carrier=DELHIVERY", headers=h)
        data = r.json()["data"]
        assert data["total"] == 0
        assert data["facets"]["carriers"] == []
    finally:
        app.dependency_overrides.clear()


def test_list_q_still_matches_awb_and_barcode(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=3)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        assert c.get("/api/v1/shipments?q=EG1IN", headers=h).json()["data"]["total"] == 1
        assert c.get("/api/v1/shipments?q=MAN-2", headers=h).json()["data"]["total"] == 1
    finally:
        app.dependency_overrides.clear()


def test_shipment_detail_includes_display_columns(monkeypatch):
    mk = _mk()
    _seed_list_rows(mk, n=1)
    c, h, _ = _authed_for_list(monkeypatch, mk)
    try:
        sid = c.get("/api/v1/shipments", headers=h).json()["data"]["items"][0]["id"]
        r = c.get(f"/api/v1/shipments/{sid}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["customer_name"] == "Customer 0"
        assert r.json()["data"]["country_name"] == "India"
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "list_returns or list_date or list_order_no or list_carrier or list_q_still or shipment_detail_includes"`
Expected: FAIL — `KeyError: 'facets'` and `KeyError: 'customer_name'`

- [ ] **Step 3: Add the join helpers and enrich `_sdict`**

In `backend/app/api/shipments.py`, replace `_sdict` (lines 19-46) with:

```python
SHIPMENT_TYPE_DEFAULT = "Road"
COUNTRY_NAME_DEFAULT = "India"


def _order_fields(o) -> dict:
    """Display columns sourced from the Order. Nullable-safe."""
    if o is None:
        return {"order_no": None, "customer_name": None, "customer_email": None,
                "customer_mobile": None, "company_name": None}
    return {
        "order_no": o.internal_order_number or o.shopify_order_name or None,
        "customer_name": o.receiver_name or None,
        "customer_email": o.receiver_email or None,
        "customer_mobile": o.receiver_mobile or None,
        "company_name": o.receiver_company or None,
    }


def _sdict(s, order=None) -> dict:
    def iso(v):
        try:
            return v.isoformat() if v is not None else None
        except Exception:
            return None

    return {
        "id": s.id,
        "business_id": s.business_id,
        "order_id": s.order_id,
        "parcel_id": s.parcel_id,
        "carrier_code": s.carrier_code,
        "awb_number": s.awb_number,
        "shipsagar_tracking_id": getattr(s, "shipsagar_tracking_id", None),
        "tracking_status": s.tracking_status,
        "carrier_status_raw": s.carrier_status_raw,
        "current_location": s.current_location,
        "last_checkpoint_message": s.last_checkpoint_message,
        "last_checkpoint_at": iso(s.last_checkpoint_at),
        "tracking_url": s.tracking_url,
        "estimated_delivery_at": iso(s.estimated_delivery_at),
        "shipped_at": iso(s.shipped_at),
        "delivered_at": iso(s.delivered_at),
        "rto_at": iso(s.rto_at),
        "returned_at": iso(s.returned_at),
        "last_synced_at": iso(s.last_synced_at),
        "entry_datetime": iso(s.created_at),
        "shipment_type": SHIPMENT_TYPE_DEFAULT,
        "country_name": COUNTRY_NAME_DEFAULT,
        **_order_fields(order),
    }
```

- [ ] **Step 4: Add the date filters and facets to the list route**

In `backend/app/api/shipments.py`, replace `list_shipments` (lines 93-119) with:

```python
def _day_bounds(value: str, is_end: bool):
    from datetime import datetime, timedelta, timezone
    dt = datetime.fromisoformat(str(value)[:10])
    if is_end:
        dt = dt + timedelta(days=1)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


@router.get("")
def list_shipments(status: str | None = None, carrier: str | None = None,
                   order_id: str | None = None, q: str | None = None,
                   date_from: str | None = None, date_to: str | None = None,
                   order_no: str | None = None,
                   page: int = 1, page_size: int = 20,
                   db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from sqlalchemy import func, or_
    from app.models.order import Order
    from app.models.parcel import Parcel
    from app.models.shipment import Shipment
    qy = db.query(Shipment).filter_by(business_id=u.get("business_id"))
    if status:
        qy = qy.filter_by(tracking_status=status.upper())
    if carrier:
        qy = qy.filter_by(carrier_code=carrier.upper())
    if order_id:
        qy = qy.filter_by(order_id=order_id)
    if date_from:
        qy = qy.filter(Shipment.created_at >= _day_bounds(date_from, False))
    if date_to:
        qy = qy.filter(Shipment.created_at < _day_bounds(date_to, True))
    if order_no and order_no.strip():
        pattern = f"%{order_no.strip()}%"
        qy = (qy.outerjoin(Order, Order.id == Shipment.order_id)
              .filter(or_(Order.internal_order_number.ilike(pattern),
                          Order.shopify_order_name.ilike(pattern))))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        qy = (qy.outerjoin(Order, Order.id == Shipment.order_id)
              .outerjoin(Parcel, Parcel.id == Shipment.parcel_id)
              .filter(or_(Shipment.awb_number.ilike(pattern),
                          Order.shopify_order_name.ilike(pattern),
                          Parcel.barcode_value.ilike(pattern))))
    total = qy.count()

    facet_q = qy.with_entities(Shipment.id).subquery()
    carrier_rows = (db.query(Shipment.carrier_code, func.count(Shipment.id))
                    .join(facet_q, facet_q.c.id == Shipment.id)
                    .group_by(Shipment.carrier_code)
                    .order_by(func.count(Shipment.id).desc()).all())
    status_rows = (db.query(Shipment.tracking_status, func.count(Shipment.id))
                   .join(facet_q, facet_q.c.id == Shipment.id)
                   .group_by(Shipment.tracking_status)
                   .order_by(func.count(Shipment.id).desc()).all())

    size = max(min(int(page_size or 20), 200), 1)
    page_no = max(int(page or 1), 1)
    rows = (qy.add_columns(Order)
            .order_by(Shipment.created_at.desc())
            .offset((page_no - 1) * size).limit(size).all())
    return {"success": True, "data": {
        "items": [_sdict(s, o) for s, o in rows],
        "total": total, "page": page_no, "page_size": size,
        "facets": {
            "carriers": [{"code": c, "count": n} for c, n in carrier_rows],
            "statuses": [{"code": s_, "count": n} for s_, n in status_rows],
        }}}
```

Note on the facet subquery: `qy` may already carry outer joins by this point. `with_entities(Shipment.id).subquery()` selects only the id, so the join does not multiply rows and the `GROUP BY` counts stay correct.

- [ ] **Step 5: Join the Order in the detail route**

Replace `get_shipment` (lines 122-128) with:

```python
@router.get("/{sid}")
def get_shipment(sid: str, db: Session = Depends(get_db), u: dict = Depends(get_current_user)):
    from app.models.order import Order
    from app.models.shipment import Shipment
    row = (db.query(Shipment, Order)
           .outerjoin(Order, Order.id == Shipment.order_id)
           .filter(Shipment.id == sid, Shipment.business_id == u.get("business_id"))
           .first())
    if row is None:
        raise HTTPException(404, "Shipment not found")
    s, o = row
    return {"success": True, "data": _sdict(s, o)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_shipsagar.py -q -k "list_returns or list_date or list_order_no or list_carrier or list_q_still or shipment_detail_includes"`
Expected: PASS (7 tests)

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend; python -m pytest tests -q`
Expected: PASS (no failures)

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/shipments.py backend/tests/test_shipsagar.py
git commit -m "feat: shipment list date filters, facets and joined display columns"
```

---

### Task 8: Frontend shipment helpers and API client

**Files:**
- Create: `web/src/lib/shipments.ts`
- Modify: `web/src/lib/api.ts` (append after line 516)
- Create: `web/tests/shipments-client.test.tsx`

**Interfaces:**
- Consumes: the backend envelope shape from Tasks 6-7.
- Produces:
  - `web/src/lib/shipments.ts` exporting `SHIPMENT_STATUSES`, `TERMINAL_STATUSES`, `ShipmentStatus`, `Tone`, `COURIER_OPTIONS`, `statusTone(status)`, `carrierLabel(code)`, `formatEntryDate(iso)`, `isTerminal(status)`, `isPushable(order)`, `validatePush(form)`.
  - `web/src/lib/api.ts` exporting `ShipmentRow`, `ShipmentFacets`, `ShipmentListResult`, `PushShipmentResult`, `ShipmentSyncResult`, `PushOrderOption`, `listShipments(params, token?)`, `pushShipment(payload, token?)`, `syncShipment(id, token?)`, `listOrdersForPush(token?)`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/shipments-client.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  COURIER_OPTIONS,
  SHIPMENT_STATUSES,
  TERMINAL_STATUSES,
  carrierLabel,
  formatEntryDate,
  isPushable,
  isTerminal,
  statusTone,
  validatePush,
} from "../src/lib/shipments";
import { listOrdersForPush, listShipments, pushShipment, syncShipment } from "../src/lib/api";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

test("status tone covers the whole vocabulary", () => {
  expect(SHIPMENT_STATUSES).toContain("DELIVERED");
  expect(SHIPMENT_STATUSES).toContain("READY_TO_SHIP");
  for (const s of SHIPMENT_STATUSES) {
    expect(["success", "info", "warning", "danger", "neutral"]).toContain(statusTone(s));
  }
  expect(statusTone("DELIVERED")).toBe("success");
  expect(statusTone("RETURNED")).toBe("danger");
  expect(statusTone("FAILED_ATTEMPT")).toBe("warning");
  expect(statusTone("NOT_CREATED")).toBe("neutral");
  expect(statusTone(undefined)).toBe("neutral");
});

test("terminal statuses are the non-refreshing ones", () => {
  expect([...TERMINAL_STATUSES]).toEqual(["DELIVERED", "RETURNED", "RTO", "LOST"]);
  expect(isTerminal("DELIVERED")).toBe(true);
  expect(isTerminal("IN_TRANSIT")).toBe(false);
});

test("courier options include IP, DTDC and FEDEX", () => {
  const codes = COURIER_OPTIONS.map((o) => o.code);
  expect(codes).toContain("IP");
  expect(codes).toContain("DTDC");
  expect(codes).toContain("FEDEX");
  expect(carrierLabel("ip")).toBe("IP");
  expect(carrierLabel("")).toBe("—");
});

test("entry date formatting returns a date or an em dash", () => {
  expect(formatEntryDate("2026-10-03T15:16:05+00:00")).toMatch(/\d/);
  expect(formatEntryDate(null)).toBe("—");
  expect(formatEntryDate("")).toBe("—");
  expect(formatEntryDate("not-a-date")).toBe("—");
});

test("push validation requires a tracking number and a courier", () => {
  expect(validatePush({ tracking_no: "", courier_code: "" })).toEqual({
    tracking_no: "Tracking number is required.",
    courier_code: "Courier is required.",
  });
  expect(validatePush({ tracking_no: "  ", courier_code: "IP" })).toHaveProperty("tracking_no");
  expect(validatePush({ tracking_no: "EG1", courier_code: "IP" })).toEqual({});
});

test("isPushable blocks orders that already carry a shipment", () => {
  expect(isPushable({ shipment_id: null })).toBe(true);
  expect(isPushable({ shipment_id: "s1" })).toBe(false);
  expect(isPushable(null)).toBe(false);
});

test("listShipments unwraps items and facets", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      items: [{ id: "s1", awb_number: "EG1" }], total: 1, page: 1, page_size: 20,
      facets: {
        carriers: [{ code: "IP", count: 1 }],
        statuses: [{ code: "DELIVERED", count: 1 }],
      } } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listShipments({ status: "DELIVERED" });
  expect(out.total).toBe(1);
  expect(out.facets.carriers[0].code).toBe("IP");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments?status=DELIVERED");
});

test("pushShipment POSTs to /shipments/push", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: "s1", pushed: true, message: "ok" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await pushShipment({ order_id: "o1", tracking_no: "EG1", courier_code: "IP" });
  expect(out.pushed).toBe(true);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/api/v1/shipments/push");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    order_id: "o1", tracking_no: "EG1", courier_code: "IP",
  });
});

test("syncShipment POSTs to the shipment sync route", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { synced: true, new_events: 2 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await syncShipment("s1");
  expect(out.synced).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/s1/sync");
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});

test("listOrdersForPush tolerates both list and items shapes", async () => {
  const rows = [{ id: "o1", order_no: "MAN-1", customer_name: "D", receiver_city: "N",
                  receiver_pincode: "422001", shipment_id: null }];
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { items: rows, total: 1 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listOrdersForPush();
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe("o1");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/orders");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run tests/shipments-client.test.tsx`
Expected: FAIL — `Cannot find module '../src/lib/shipments'`

- [ ] **Step 3: Create `web/src/lib/shipments.ts`**

```ts
// web/src/lib/shipments.ts — shipment page helpers (pure, unit-tested).

export const SHIPMENT_STATUSES = [
  "NOT_CREATED",
  "READY_TO_SHIP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RTO",
  "RETURNED",
  "LOST",
  "EXCEPTION",
] as const;

export const TERMINAL_STATUSES = ["DELIVERED", "RETURNED", "RTO", "LOST"] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const COURIER_OPTIONS = [
  { code: "IP", label: "IP — India Post" },
  { code: "DTDC", label: "DTDC" },
  { code: "FEDEX", label: "FEDEX" },
  { code: "OTHER", label: "Other (type below)…" },
] as const;

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const TONES: Record<string, Tone> = {
  DELIVERED: "success",
  READY_TO_SHIP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "info",
  FAILED_ATTEMPT: "warning",
  EXCEPTION: "warning",
  RTO: "danger",
  RETURNED: "danger",
  LOST: "danger",
  NOT_CREATED: "neutral",
};

export function statusTone(status?: string | null): Tone {
  return TONES[(status ?? "").toUpperCase()] ?? "neutral";
}

export function carrierLabel(code?: string | null): string {
  return code?.trim() ? code.trim().toUpperCase() : "—";
}

export function formatEntryDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isTerminal(status?: string | null): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes((status ?? "").toUpperCase());
}

export function isPushable(
  order: { shipment_id?: string | null } | null | undefined,
): boolean {
  if (!order) return false;
  return !order.shipment_id;
}

export function validatePush(form: {
  tracking_no: string;
  courier_code: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.tracking_no.trim()) errors.tracking_no = "Tracking number is required.";
  if (!form.courier_code.trim()) errors.courier_code = "Courier is required.";
  return errors;
}
```

- [ ] **Step 4: Add the API client functions**

Append to `web/src/lib/api.ts`:

```ts
// --- Shipments: list, push, sync ---

export type ShipmentRow = {
  id: string;
  business_id: string;
  order_id: string;
  parcel_id: string;
  carrier_code: string;
  awb_number: string;
  shipsagar_tracking_id?: string | null;
  tracking_status: string;
  carrier_status_raw?: string | null;
  current_location?: string | null;
  last_checkpoint_message?: string | null;
  last_checkpoint_at?: string | null;
  last_synced_at?: string | null;
  entry_datetime?: string | null;
  shipment_type?: string | null;
  country_name?: string | null;
  order_no?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_mobile?: string | null;
  company_name?: string | null;
};

export type ShipmentFacets = {
  carriers: { code: string; count: number }[];
  statuses: { code: string; count: number }[];
};

export type ShipmentListResult = {
  items: ShipmentRow[];
  total: number;
  page: number;
  page_size: number;
  facets: ShipmentFacets;
};

export type PushShipmentResult = ShipmentRow & { pushed: boolean; message: string };

export type ShipmentSyncResult = {
  synced: boolean;
  new_events?: number;
  reason?: string;
};

export type PushOrderOption = {
  id: string;
  order_no?: string | null;
  customer_name?: string | null;
  receiver_city?: string | null;
  receiver_pincode?: string | null;
  shipment_id?: string | null;
};

export function listShipments(
  params: {
    date_from?: string;
    date_to?: string;
    q?: string;
    order_no?: string;
    status?: string;
    carrier?: string;
    page?: number;
    page_size?: number;
  } = {},
  token?: string,
): Promise<ShipmentListResult> {
  const p = new URLSearchParams();
  if (params.date_from) p.set("date_from", params.date_from);
  if (params.date_to) p.set("date_to", params.date_to);
  if (params.q?.trim()) p.set("q", params.q.trim());
  if (params.order_no?.trim()) p.set("order_no", params.order_no.trim());
  if (params.status) p.set("status", params.status.toUpperCase());
  if (params.carrier) p.set("carrier", params.carrier.toUpperCase());
  if (params.page && params.page > 1) p.set("page", String(params.page));
  if (params.page_size) p.set("page_size", String(params.page_size));
  const qs = p.toString();
  return api<ShipmentListResult>(`/api/v1/shipments${qs ? `?${qs}` : ""}`, {}, token);
}

export function pushShipment(
  payload: { order_id: string; tracking_no: string; courier_code: string },
  token?: string,
): Promise<PushShipmentResult> {
  return api<PushShipmentResult>(
    "/api/v1/shipments/push",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function syncShipment(id: string, token?: string): Promise<ShipmentSyncResult> {
  return api<ShipmentSyncResult>(`/api/v1/shipments/${id}/sync`, { method: "POST" }, token);
}

export function listOrdersForPush(token?: string): Promise<PushOrderOption[]> {
  return api<any>("/api/v1/orders?page_size=100", {}, token).then((data: any) =>
    Array.isArray(data) ? data : (data?.items ?? []));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web; npx vitest run tests/shipments-client.test.tsx`
Expected: PASS (11 tests)

- [ ] **Step 6: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/shipments.ts web/src/lib/api.ts web/tests/shipments-client.test.tsx
git commit -m "feat: shipment helpers and list, push and sync API clients"
```

---

### Task 9: Push Shipment dialog component

**Files:**
- Create: `web/src/components/PushShipmentDialog.tsx`
- Create: `web/tests/push-shipment-dialog.test.tsx`

**Interfaces:**
- Consumes: `COURIER_OPTIONS`, `validatePush` (Task 8); `listOrdersForPush`, `pushShipment`, `PushOrderOption`, `PushShipmentResult` (Task 8); `IconAlert`, `IconTruck` from `web/src/components/icons.tsx`.
- Produces: `PushShipmentDialog({ open, defaultOrderId?, onClose, onPushed }: Props)` where `onPushed(result: PushShipmentResult) => void`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/push-shipment-dialog.test.tsx`:

```tsx
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PushShipmentDialog from "../src/components/PushShipmentDialog";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const ORDERS = [
  { id: "o1", order_no: "MAN-1", customer_name: "Dileep Kumar",
    receiver_city: "Nashik", receiver_pincode: "422001", shipment_id: null },
  { id: "o2", order_no: "MAN-2", customer_name: "Rahul Sharma",
    receiver_city: "Pune", receiver_pincode: "411001", shipment_id: "s9" },
];

function stubFetch() {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      if (init?.method !== "POST") throw new Error("push must be POST");
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ success: true, data: {
          id: "s1", pushed: true, message: "Data has been recorded successfully",
          awb_number: body.tracking_no, carrier_code: body.courier_code,
          tracking_status: "READY_TO_SHIP",
          shipsagar_tracking_id: `SS-${body.tracking_no}` } }),
      };
    }
    return { ok: true, json: async () => ({ success: true, data: ORDERS }) };
  });
}

test("dialog renders every field group and refuses a blank tracking number", async () => {
  vi.stubGlobal("fetch", stubFetch());
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Order")).toBeTruthy());
  expect(screen.getByLabelText("Tracking No")).toBeTruthy();
  expect(screen.getByLabelText("Courier")).toBeTruthy();
  expect(screen.getByText("Customer")).toBeTruthy();
  expect(screen.getByText("Company Name")).toBeTruthy();
  expect(screen.getByText("Country")).toBeTruthy();
  expect(screen.getByText("Shipment Type")).toBeTruthy();

  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("Tracking number is required.")).toBeTruthy());
  expect(onPushed).not.toHaveBeenCalled();
});

test("pushing posts the typed tracking number and courier, then calls onPushed", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), {
    target: { value: "EG080960145IN" },
  });
  fireEvent.change(screen.getByLabelText("Courier"), { target: { value: "IP" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onPushed).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/push"));
  expect(JSON.parse((call?.[1] as any).body)).toEqual({
    order_id: "o1",
    tracking_no: "EG080960145IN",
    courier_code: "IP",
  });
});

test("orders that already have a shipment cannot be selected", async () => {
  vi.stubGlobal("fetch", stubFetch());
  render(<PushShipmentDialog open onClose={() => {}} onPushed={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Order")).toBeTruthy());
  const select = screen.getByLabelText("Order") as HTMLSelectElement;
  const values = Array.from(select.options).map((o) => o.value);
  expect(values).toContain("o1");
  expect(values).not.toContain("o2");
});

test("a provider rejection is surfaced as a banner, not a field error", async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipments/push")) {
      return {
        ok: true,
        json: async () => ({ success: true, data: {
          id: "s1", pushed: false, message: "please try again later" } }),
      };
    }
    return { ok: true, json: async () => ({ success: true, data: ORDERS }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
  expect(onPushed).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run tests/push-shipment-dialog.test.tsx`
Expected: FAIL — `Cannot find module '../src/components/PushShipmentDialog'`

- [ ] **Step 3: Create the dialog**

Create `web/src/components/PushShipmentDialog.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import {
  listOrdersForPush,
  pushShipment,
  PushOrderOption,
  PushShipmentResult,
} from "../lib/api";
import { COURIER_OPTIONS, validatePush } from "../lib/shipments";
import { IconAlert, IconTruck } from "./icons";

export type PushShipmentDialogProps = {
  open: boolean;
  defaultOrderId?: string | null;
  onClose: () => void;
  onPushed: (result: PushShipmentResult) => void;
};

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

export default function PushShipmentDialog({
  open,
  defaultOrderId,
  onClose,
  onPushed,
}: PushShipmentDialogProps) {
  const [orders, setOrders] = useState<PushOrderOption[]>([]);
  const [orderId, setOrderId] = useState(defaultOrderId ?? "");
  const [trackingNo, setTrackingNo] = useState("");
  const [courier, setCourier] = useState("IP");
  const [customCourier, setCustomCourier] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    listOrdersForPush()
      .then((rows) => {
        const pushable = rows.filter((r) => !r.shipment_id);
        setOrders(pushable);
        setOrderId((cur) => cur || pushable[0]?.id || "");
      })
      .catch(() => setOrders([]));
  }, [open]);

  if (!open) return null;

  const order = orders.find((o) => o.id === orderId) ?? null;
  const effectiveCourier = courier === "OTHER" ? customCourier.trim().toUpperCase() : courier;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitError(null);
    const found = validatePush({ tracking_no: trackingNo, courier_code: effectiveCourier });
    if (!orderId) found.order_id = "Choose an order.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !orderId) return;
    setSubmitting(true);
    try {
      const result = await pushShipment({
        order_id: orderId,
        tracking_no: trackingNo.trim(),
        courier_code: effectiveCourier,
      });
      setTrackingNo("");
      if (!result.pushed) {
        setNotice(result.message || "ShipSagar did not accept the shipment.");
      }
      onPushed(result);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to push shipment");
    } finally {
      setSubmitting(false);
    }
  };

  const renderError = (key: string) =>
    errors[key] ? (
      <span
        className="text-xs font-medium text-red-600 flex items-center gap-1 mt-1"
        role="alert"
      >
        <IconAlert size={12} /> {errors[key]}
      </span>
    ) : null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Push Shipment"
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <IconTruck size={20} /> Push Shipment
              <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                ShipSagar
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Register a tracking number with ShipSagar and start live tracking
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <form id="push-shipment-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
            {submitError && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3"
              >
                {submitError}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3"
              >
                {notice}
              </div>
            )}

            <div>
              <label htmlFor="push-order" className={labelClass}>
                Order
              </label>
              <select
                id="push-order"
                aria-label="Order"
                className={inputClass}
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Choose an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_no ?? o.id} — {o.customer_name ?? "No name"} (
                    {o.receiver_city ?? "—"}
                    {o.receiver_pincode ? ` ${o.receiver_pincode}` : ""})
                  </option>
                ))}
              </select>
              {renderError("order_id")}
            </div>

            <div>
              <label htmlFor="push-tracking" className={labelClass}>
                Tracking No
              </label>
              <input
                id="push-tracking"
                aria-label="Tracking No"
                className={inputClass}
                placeholder="e.g. EG080960145IN"
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
              {renderError("tracking_no")}
              <p className="text-xs text-slate-500 mt-1">
                Tracking number issued by the India Post worker. This becomes the parcel
                barcode and the AWB.
              </p>
            </div>

            <div>
              <label htmlFor="push-courier" className={labelClass}>
                Courier
              </label>
              <select
                id="push-courier"
                aria-label="Courier"
                className={inputClass}
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              >
                {COURIER_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              {courier === "OTHER" && (
                <input
                  aria-label="Custom courier code"
                  className={`${inputClass} mt-2`}
                  placeholder="ShipSagar courier code"
                  value={customCourier}
                  onChange={(e) => setCustomCourier(e.target.value)}
                />
              )}
              {renderError("courier_code")}
              <p className="text-xs text-slate-500 mt-1">
                ShipSagar courier code from the client profile page.
              </p>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col gap-3">
              <p className="text-sm font-bold text-slate-800">Payload preview</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-slate-500">Customer</dt>
                <dd className="text-slate-900">
                  {order?.customer_name || "—"}
                  {order?.receiver_city ? ` · ${order.receiver_city}` : ""}
                </dd>
                <dt className="text-slate-500">Company Name</dt>
                <dd className="text-slate-900">{order?.company_name || "(empty)"}</dd>
                <dt className="text-slate-500">Country</dt>
                <dd className="text-slate-900">India</dd>
                <dt className="text-slate-500">Shipment Type</dt>
                <dd className="text-slate-900">Road</dd>
              </dl>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="push-shipment-form"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition disabled:opacity-60"
          >
            {submitting ? "Pushing…" : "Push shipment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npx vitest run tests/push-shipment-dialog.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PushShipmentDialog.tsx web/tests/push-shipment-dialog.test.tsx
git commit -m "feat: push shipment dialog"
```

---

### Task 10: Rebuild the Shipments page

**Files:**
- Rewrite: `web/src/pages/Shipments.tsx`
- Create: `web/tests/shipments-page.test.tsx`
- Modify: `web/tests/fe5-reports-shipments.test.tsx` (adjust the two stale expectations)

**Interfaces:**
- Consumes: everything from Task 8 (`listShipments`, `syncShipment`, `ShipmentRow`, `ShipmentListResult`, `canDrainRetries`, `getShipsagarHealth`, `drainShipsagarRetries`, `shipmentProvider`), Task 9's `PushShipmentDialog`, and `lib/shipments.ts` helpers.
- Produces: the default-exported `ShipmentsPage` at the same path, so `web/src/App.tsx:64` and `web/src/lib/app-nav.ts:10` need no change.

**Strings that must survive** (asserted by `web/tests/fe5-reports-shipments.test.tsx`):
- health line: `` `ShipSagar health: ${failed_webhooks} failed webhooks · ${pending_jobs} pending retries` ``
- drain button label: `Retry drain`
- success line: `Retry drain complete: ${succeeded} drained, ${requeued} requeued, ${dead_lettered} dead-lettered (${checked} checked)`
- no element may hold the exact text `ShipSagar`; the provider label lives inside the combined tracking cell

- [ ] **Step 1: Write the failing test**

Create `web/tests/shipments-page.test.tsx`:

```tsx
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShipmentsPage from "../src/pages/Shipments";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const HEALTH = {
  provider: "SHIPSAGAR", configured: true, status: "warning",
  failed_webhooks: 2, failed_jobs: 0, pending_jobs: 3, unregistered_shipments: 1,
};

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `s${i}`, business_id: "b1", order_id: `o${i}`, parcel_id: `p${i}`,
    carrier_code: "IP", awb_number: `EG08096014${i}IN`,
    shipsagar_tracking_id: `SS-EG08096014${i}IN`,
    tracking_status: i === 0 ? "DELIVERED" : "IN_TRANSIT",
    order_no: `MAN-${i}`, customer_name: `Customer ${i}`,
    customer_email: `c${i}@e.com`, customer_mobile: `99630266${i}${i}`,
    company_name: `Co ${i}`, shipment_type: "Road", country_name: "India",
    entry_datetime: "2026-10-03T15:16:05+00:00",
    current_location: "New Delhi",
    ...over,
  };
}

function listPayload(items = [row(0), row(1), row(2)]) {
  const statuses: Record<string, number> = {};
  const carriers: Record<string, number> = {};
  for (const r of items) {
    statuses[r.tracking_status] = (statuses[r.tracking_status] ?? 0) + 1;
    carriers[r.carrier_code] = (carriers[r.carrier_code] ?? 0) + 1;
  }
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    facets: {
      carriers: Object.entries(carriers).map(([code, count]) => ({ code, count })),
      statuses: Object.entries(statuses).map(([code, count]) => ({ code, count })),
    },
  };
}

function stubPage(options: { items?: ReturnType<typeof row>[] } = {}) {
  const items = options.items ?? [row(0), row(1), row(2)];
  return vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: HEALTH }) };
    }
    if (u.includes("/shipsagar/retry-drain")) {
      return { ok: true, json: async () => ({ success: true, data: {
        checked: 4, succeeded: 3, requeued: 1, dead_lettered: 0 } }) };
    }
    if (u.includes("/api/v1/shipments?")) {
      return { ok: true, json: async () => ({ success: true, data: listPayload(items) }) };
    }
    if (u.includes("/api/v1/shipments/")) {
      return { ok: true, json: async () => ({ success: true, data: {
        synced: true, new_events: 1 } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShipmentsPage />
    </MemoryRouter>,
  );
}

test("renders the shipment table with the display columns", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  expect(screen.getByText("Total : 3 Shipments")).toBeTruthy();
  expect(screen.getByText("Order No")).toBeTruthy();
  expect(screen.getByText("Tracking Number")).toBeTruthy();
  expect(screen.getAllByText("Current Status").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Customer")).toBeTruthy();
  expect(screen.getByText("Shipment Type")).toBeTruthy();
  expect(screen.getByText("Country Name")).toBeTruthy();
  expect(screen.getByText("Company Name")).toBeTruthy();
  expect(screen.getByText("Entry Date & Time")).toBeTruthy();
  expect(screen.getByText("Customer 0")).toBeTruthy();
  expect(screen.getByText("c0@e.com")).toBeTruthy();
  expect(screen.getByText("Co 1")).toBeTruthy();
  expect(screen.getAllByText("India").length).toBe(3);
  expect(screen.getAllByText("Road").length).toBe(3);
});

test("carrier and status chips render with facet counts", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText(/IP\(3\)/)).toBeTruthy());
  expect(screen.getByText(/DELIVERED\(1\)/)).toBeTruthy();
  expect(screen.getByText(/IN_TRANSIT\(2\)/)).toBeTruthy();
  // "All Records" appears once per chip row.
  expect(screen.getAllByText(/All Records/).length).toBeGreaterThanOrEqual(2);
});

test("no element holds the exact text ShipSagar on the page", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  expect(screen.queryAllByText("ShipSagar", { exact: true })).toHaveLength(0);
  // The provider is still labelled, inside the combined tracking cell.
  expect(screen.getAllByText(/· ShipSagar$/).length).toBe(3);
});

test("the health banner sits below the table and keeps its exact wording", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(
      screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"),
    ).toBeTruthy(),
  );
});

test("ADMIN sees the retry-drain button and its completion line", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("Retry drain", { selector: "button" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Retry drain", { selector: "button" }));
  await waitFor(() =>
    expect(
      screen.getByText("Retry drain complete: 3 drained, 1 requeued, 0 dead-lettered (4 checked)"),
    ).toBeTruthy(),
  );
});

test("a non-ADMIN sees no retry-drain button", async () => {
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(
      screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Retry drain", { selector: "button" })).toBeNull();
});

test("changing the status filter re-queries the backend", async () => {
  const fetchMock = stubPage();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DELIVERED" } });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("status=DELIVERED")),
    ).toBe(true),
  );
});

test("auto refresh syncs non-terminal rows and skips terminal ones", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = stubPage();
  vi.stubGlobal("fetch", fetchMock);
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(26000);
    const syncCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/sync"));
    expect(syncCalls.some((u) => u.endsWith("/s1/sync"))).toBe(true);
    expect(syncCalls.some((u) => u.endsWith("/s2/sync"))).toBe(true);
    // s0 is DELIVERED — terminal, never re-fetched.
    expect(syncCalls.some((u) => u.endsWith("/s0/sync"))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("the push dialog opens from the page", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("Push Shipment")).toBeTruthy());
  fireEvent.click(screen.getByText("Push Shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Push Shipment" })).toBeTruthy(),
  );
});

test("a list error surfaces a retry affordance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 500,
    json: async () => ({ success: false, error: { code: "BOOM", message: "list boom" } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("list boom")).toBeTruthy());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run tests/shipments-page.test.tsx`
Expected: FAIL — the current page renders no `Push Shipment` button, no chips, and no `Total : 3 Shipments` line.

- [ ] **Step 3: Rewrite the page**

Replace `web/src/pages/Shipments.tsx` entirely with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  canDrainRetries,
  drainShipsagarRetries,
  getShipsagarHealth,
  listShipments,
  ShipmentListResult,
  ShipmentRow,
  shipmentProvider,
  syncShipment,
} from "../lib/api";
import {
  carrierLabel,
  formatEntryDate,
  isTerminal,
  SHIPMENT_STATUSES,
  statusTone,
  Tone,
} from "../lib/shipments";
import PushShipmentDialog from "../components/PushShipmentDialog";
import { IconAlert, IconTruck } from "../components/icons";

const REFRESH_MS = 25000;

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

const CHIP_ACTIVE = "px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-700 text-white shadow-xs";
const CHIP_IDLE =
  "px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition";

const inputClass =
  "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";
const labelClass =
  "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

function providerBadge(s: ShipmentRow): string {
  const p = shipmentProvider(s);
  if (p === "SHIPSAGAR") return "ShipSagar";
  if (p === "MANUAL") return "MANUAL";
  return "direct";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {status}
    </span>
  );
}

export default function ShipmentsPage() {
  const [data, setData] = useState<ShipmentListResult | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tracking, setTracking] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [status, setStatus] = useState("");
  const [carrier, setCarrier] = useState("");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    failed_webhooks: number;
    pending_jobs: number;
    configured: boolean;
  } | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);
  const [showPush, setShowPush] = useState(false);
  const reqRef = useRef(0);

  const fetchList = useCallback(
    (silent = false) => {
      const req = ++reqRef.current;
      if (!silent) setError(null);
      listShipments({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        q: tracking || undefined,
        order_no: orderNo || undefined,
        status: status || undefined,
        carrier: carrier || undefined,
        page_size: 20,
      })
        .then((res) => {
          if (reqRef.current !== req) return;
          setData(res);
        })
        .catch((err: unknown) => {
          if (reqRef.current !== req) return;
          if (!silent) {
            setError(err instanceof Error ? err.message : "Failed to load shipments");
          }
        });
    },
    [dateFrom, dateTo, tracking, orderNo, status, carrier],
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    getShipsagarHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const refreshHealth = useCallback(() => {
    getShipsagarHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!live || !data) return;
    const tick = async () => {
      const targets = data.items.filter((s) => !isTerminal(s.tracking_status));
      if (targets.length === 0) return;
      await Promise.allSettled(targets.map((s) => syncShipment(s.id)));
      fetchList(true);
    };
    const t = setInterval(() => void tick(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live, data, fetchList]);

  const handleDrain = async () => {
    if (!window.confirm("Drain due ShipSagar retries now?")) return;
    setDraining(true);
    setDrainMsg(null);
    try {
      const out = await drainShipsagarRetries(50);
      const checked = out.checked ?? 0;
      const succeeded = out.succeeded ?? out.drained ?? 0;
      const requeued = out.requeued ?? out.remaining ?? 0;
      const dead = out.dead_lettered ?? out.moved_to_dead_letter ?? 0;
      setDrainMsg(
        `Retry drain complete: ${succeeded} drained, ${requeued} requeued, ${dead} dead-lettered (${checked} checked)`,
      );
      refreshHealth();
      fetchList(true);
    } catch (err: unknown) {
      setDrainMsg(err instanceof Error ? err.message : "Retry drain failed");
    } finally {
      setDraining(false);
    }
  };

  const handleApply = () => fetchList();

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTracking("");
    setOrderNo("");
    setStatus("");
    setCarrier("");
  };

  const items = data?.items ?? [];
  const facets = data?.facets ?? { carriers: [], statuses: [] };
  const total = data?.total ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Shipments</h1>
        <p className="text-sm text-slate-500 mt-1">
          Push tracking numbers to ShipSagar and follow every parcel location live.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label htmlFor="f-date-from" className={labelClass}>Date From</label>
            <input id="f-date-from" aria-label="Date From" type="date"
              className={inputClass} value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-date-to" className={labelClass}>Date To</label>
            <input id="f-date-to" aria-label="Date To" type="date"
              className={inputClass} value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-tracking" className={labelClass}>Tracking No.</label>
            <input id="f-tracking" aria-label="Tracking No." className={inputClass}
              placeholder="Enter Tracking No." value={tracking}
              onChange={(e) => setTracking(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-order" className={labelClass}>Order No.</label>
            <input id="f-order" aria-label="Order No." className={inputClass}
              placeholder="Enter Order No." value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-status" className={labelClass}>Status</label>
            <select id="f-status" aria-label="Status" className={inputClass}
              value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-carrier" className={labelClass}>Courier</label>
            <select id="f-carrier" aria-label="Courier" className={inputClass}
              value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              <option value="">All Carriers</option>
              {facets.carriers.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={handleApply}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-xs transition">
            APPLY
          </button>
          <button type="button" onClick={clearFilters}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition">
            Clear filters
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            Auto refresh every 25s
          </label>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          Carrier
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={carrier ? CHIP_IDLE : CHIP_ACTIVE}
            onClick={() => setCarrier("")}>
            All Records
          </button>
          {facets.carriers.map((c) => (
            <button key={c.code} type="button"
              className={carrier === c.code ? CHIP_ACTIVE : CHIP_IDLE}
              onClick={() => setCarrier(carrier === c.code ? "" : c.code)}>
              {carrierLabel(c.code)}({c.count})
            </button>
          ))}
        </div>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-4 mb-2">
          Current Status
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={status ? CHIP_IDLE : CHIP_ACTIVE}
            onClick={() => setStatus("")}>
            All Records
          </button>
          {facets.statuses.map((s) => (
            <button key={s.code} type="button"
              className={status === s.code ? CHIP_ACTIVE : CHIP_IDLE}
              onClick={() => setStatus(status === s.code ? "" : s.code)}>
              {s.code}({s.count})
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert"
          className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <IconAlert size={16} /> {error}
          </span>
          <button type="button" onClick={() => fetchList()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-red-300 text-red-700 hover:bg-red-100 transition">
            Retry Connection
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-lg font-semibold text-slate-700">
          Total : {total} Shipment{total === 1 ? "" : "s"}
        </p>
        <button type="button" onClick={() => setShowPush(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition flex items-center gap-2">
          <IconTruck size={16} /> Push Shipment
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3">Order No</th>
              <th className="text-left px-4 py-3">Tracking Number</th>
              <th className="text-left px-4 py-3">Current Status</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Shipment Type</th>
              <th className="text-left px-4 py-3">Country Name</th>
              <th className="text-left px-4 py-3">Company Name</th>
              <th className="text-left px-4 py-3">Entry Date &amp; Time</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No shipments match these filters.
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-900">
                    {s.order_no ?? s.order_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-semibold text-slate-900">{s.awb_number}</span>
                    <span className="text-xs text-slate-500">
                      {carrierLabel(s.carrier_code)} · {providerBadge(s)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.tracking_status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="block text-slate-900">{s.customer_name ?? "—"}</span>
                    <span className="block text-xs text-slate-500">{s.customer_email ?? ""}</span>
                    <span className="block text-xs text-slate-500">{s.customer_mobile ?? ""}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{s.shipment_type ?? "Road"}</td>
                  <td className="px-4 py-3 text-slate-700">{s.country_name ?? "India"}</td>
                  <td className="px-4 py-3 text-slate-700">{s.company_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{formatEntryDate(s.entry_datetime)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600" data-testid="shipsagar-health">
          {health
            ? `ShipSagar health: ${health.failed_webhooks} failed webhooks · ${health.pending_jobs} pending retries`
            : "ShipSagar health: unavailable"}
        </p>
        <div className="flex items-center gap-3">
          {drainMsg && (
            <span role="status" className="text-sm text-slate-600">{drainMsg}</span>
          )}
          {canDrainRetries() && (
            <button type="button" onClick={handleDrain} disabled={draining}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 shadow-xs transition disabled:opacity-60">
              {draining ? "Draining…" : "Retry drain"}
            </button>
          )}
        </div>
      </div>

      <PushShipmentDialog
        open={showPush}
        onClose={() => setShowPush(false)}
        onPushed={() => {
          setShowPush(false);
          fetchList(true);
        }}
      />
    </div>
  );
}
```

Two deliberate choices that keep the existing tests green:
- The provider label is rendered inside the combined tracking cell (`IP · ShipSagar`), so no element holds the exact text `ShipSagar`. The health line starts with `ShipSagar health:` and the dialog badge only mounts when `showPush` is true; neither collides.
- The old `location` column is gone. The backend field is `current_location`, and the screenshot's column set does not include it, so the page reads `entry_datetime` and never a non-existent `location` key.

- [ ] **Step 4: Run the new page test**

Run: `cd web; npx vitest run tests/shipments-page.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Run the pre-existing FE5 shipment tests and fix their stale expectations**

Run: `cd web; npx vitest run tests/fe5-reports-shipments.test.tsx`
Expected: two failures — the old test expects `screen.getByText("ShipSagar")` and `"2 failed webhooks"` against a page that no longer renders the legacy markup.

In `web/tests/fe5-reports-shipments.test.tsx`, replace `test("shipments page shows provider badge, health line, ADMIN retry-drain with confirm", ...)` (lines 143-168) with:

```tsx
test("shipments page shows provider badge, health line, ADMIN retry-drain with confirm", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: { provider: "SHIPSAGAR", configured: true, status: "warning", failed_webhooks: 2, failed_jobs: 0, pending_jobs: 3, unregistered_shipments: 1 } }) };
    }
    if (String(url).includes("/shipsagar/retry-drain")) {
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ success: true, data: { checked: 4, succeeded: 3, requeued: 1, dead_lettered: 0 } }) };
    }
    if (String(url).includes("/api/v1/shipments?")) {
      return { ok: true, json: async () => ({ success: true, data: {
        items: [{ id: "s1", order_id: "o1", carrier_code: "IP", shipsagar_tracking_id: "ss-9",
                   awb_number: "AWB1", tracking_status: "IN_TRANSIT", order_no: "MAN-1",
                   customer_name: "Dileep Kumar", customer_email: "rahul@example.com",
                   customer_mobile: "9963026645", company_name: "Reshamgath",
                   shipment_type: "Road", country_name: "India",
                   entry_datetime: "2026-10-03T15:16:05+00:00" }],
        total: 1, page: 1, page_size: 20,
        facets: { carriers: [{ code: "IP", count: 1 }], statuses: [{ code: "IN_TRANSIT", count: 1 }] } } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: { synced: true, new_events: 1 } }) };
  }));
  renderShipments();
  await waitFor(() => expect(screen.getByText("AWB1")).toBeTruthy());
  expect(screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries")).toBeTruthy();
  const btn = screen.getByText("Retry drain", { selector: "button" });
  fireEvent.click(btn);
  await waitFor(() =>
    expect(screen.getByText("Retry drain complete: 3 drained, 1 requeued, 0 dead-lettered (4 checked)")).toBeTruthy(),
  );
  expect(drainShipsagarRetries).toBeDefined();
});
```

And replace `test("non-ADMIN sees no retry-drain button", ...)` (lines 170-181) with:

```tsx
test("non-ADMIN sees no retry-drain button", async () => {
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: { provider: "SHIPSAGAR", status: "healthy", failed_webhooks: 0, pending_jobs: 0 } }) };
    }
    if (String(url).includes("/api/v1/shipments?")) {
      return { ok: true, json: async () => ({ success: true, data: {
        items: [], total: 0, page: 1, page_size: 20,
        facets: { carriers: [], statuses: [] } } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  }));
  renderShipments();
  await waitFor(() =>
    expect(screen.getByText("ShipSagar health: 0 failed webhooks · 0 pending retries")).toBeTruthy(),
  );
  expect(screen.queryByText("Retry drain", { selector: "button" })).toBeNull();
});
```

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd web; npx vitest run`
Expected: PASS. If `web/tests/responsive.test.tsx` or `web/tests/shell.test.tsx` assert on the old Shipments markup, update only the assertions that reference removed strings; do not change unrelated tests.

- [ ] **Step 7: Typecheck and build**

Run: `cd web; npm run build`
Expected: `tsc --noEmit` clean and a successful Vite build.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Shipments.tsx web/tests/shipments-page.test.tsx web/tests/fe5-reports-shipments.test.tsx
git commit -m "feat: rebuild shipments page with filters, chips and 25s auto refresh"
```

---

### Task 11: End-to-end verification and docs

**Files:**
- Modify: `.env.example` (already done in Task 1 — verify nothing is missing)
- Modify: `README.md` (ShipSagar section, if one exists)

**Interfaces:**
- Consumes: every prior task.
- Produces: verified green suites and a documented env contract.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend; python -m pytest tests -q`
Expected: PASS with zero failures and zero errors.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd web; npx vitest run`
Expected: PASS.

- [ ] **Step 3: Verify the app boots and the new route responds**

Run: `cd backend; python -m uvicorn app.main:app --port 8000` in one shell, then in another:

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/docs
```

Expected: `200`

Shut the server down afterwards.

- [ ] **Step 4: Confirm the ShipSagar health endpoint reports configuration honestly**

With `SHIPSAGAR_TOKEN` and `SHIPSAGAR_CLIENT_CODE` unset, log in and call:

```powershell
curl.exe -s -H "Authorization: Bearer <token>" http://localhost:8000/api/v1/shipsagar/health
```

Expected: `"configured": false`. With both set in `.env`, restart and expect `"configured": true`.

- [ ] **Step 5: Document the env contract**

In `README.md`, find the ShipSagar or courier-integration section. If present, add:

```markdown
### ShipSagar

ShipSagar aggregates courier tracking. Two endpoints are integrated:
`PushShipment` (register a shipment) and `TrackShipment` (poll history).
Credentials come from the ShipSagar client profile page and are sent in the
request body:

- `SHIPSAGAR_API_BASE_URL` — defaults to `https://app.shipsagar.com/api/Web`
- `SHIPSAGAR_TOKEN` — the "api key" from the client profile page
- `SHIPSAGAR_CLIENT_CODE` — the "client code" from the client profile page
- `SHIPSAGAR_WEBHOOK_SECRET` — HMAC secret for the inbound webhook

With no credentials set, pushes fall back to a deterministic
`SS-STUB-<COURIER>-<AWB>` identifier and tracking stays offline, so local
development works without a ShipSagar account.
```

If no such section exists, append the block above under a new `## ShipSagar` heading.

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example
git commit -m "docs: ShipSagar environment contract"
```