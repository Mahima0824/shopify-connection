# ShipSagar Push + Track, Shipments Page Rebuild — Design Spec
Date: 2026-10-03
Status: Draft (pending user review)
Source API Doc: ShipSagar `PushShipment` + `TrackShipment` (GetCourier deliberately excluded)

## 1. Goal

Replace the speculative ShipSagar HTTP seam with the two real ShipSagar endpoints — `POST https://app.shipsagar.com/api/Web/PushShipment` and `POST https://app.shipsagar.com/api/Web/TrackShipment` — and rebuild the `/shipments` page so a warehouse user can select an order from the Orders route, type the tracking number issued by the India Post worker, choose a courier, push the shipment to ShipSagar, and then watch every parcel's live location update on a ~25 second auto-refresh. The page carries the filter bar, carrier chips, status chips, shipment count, and the column set from the reference screenshot: Order No, Tracking Number, Current Status, Customer, Shipment Type, Country Name, Company Name, Entry Date & Time.

## 2. Evidence (verified)

- Current ShipSagar client is a stub: `backend/app/services/shipsagar_service.py::`_post posts `base + "/trackings"` with an `Authorization: Bearer` header and a `{courier, tracking_number}` body. Neither the path nor the auth scheme nor the body shape exists in the real ShipSagar API, which authenticates via `Token` + `ClientCode` inside the JSON body.
- `shipsagar_service.py:11` states outright: "Real API spec/creds are ABSENT, so the HTTP client is a stub with a clean seam".
- `is_configured()` (`shipsagar_service.py:225`) checks `shipsagar_api_base_url and shipsagar_api_key`; both are `""` by default (`backend/app/config.py:40-41`), and `.env.example` has no `SHIPSAGAR_*` entries at all.
- The stub fallback `tracking_id = f"SS-STUB-{code}-{awb}"` (`shipsagar_service.py:295`) is what 13 passing tests in `backend/tests/test_shipsagar.py` currently assert against.
- `Shipment` (`backend/app/models/shipment.py:13-36`) has no `customer_name`, `email`, `mobile`, `country`, `company_name`, `shipment_type`, or `entry_datetime` column. Nearest fields: `current_location`, `last_checkpoint_at`, `created_at`, `shipped_at`.
- `shipments.order_id` and `shipments.parcel_id` are both `NOT NULL` FKs (`shipment.py:15-16`), but `order_service.create_manual_order` (`backend/app/services/order_service.py:13`) creates an `Order` only — no `Parcel` row. Every existing `Shipment` creation path resolves a `Parcel` first (`backend/app/api/shipments.py:69-72`, `shipments.py:413`, `backend/app/api/scanning.py:59`).
- `Order` (`backend/app/models/order.py:42-50`) already carries `receiver_name`, `receiver_company`, `receiver_mobile`, `receiver_email` from migration `0019_india_post_order_fields`. No `country` column exists anywhere in the codebase.
- `backend/app/api/orders.py:20-61` `_to_dict()` exposes only `receiver_name, receiver_city, receiver_pincode, receiver_mobile, cod_mode, cod_value, weight_grams, barcode_no` — email, company, state and address lines are not returned to the frontend today.
- `GET /api/v1/shipments` (`backend/app/api/shipments.py:93-119`) supports `status, carrier, order_id, q, page, page_size`. It has **no** date range filter, and `?q=` only matches AWB / `shopify_order_name` / `barcode_value`. No facet counts are returned.
- `_sdict` (`shipments.py:19-46`) returns the location field as `current_location`.
- `web/src/pages/Shipments.tsx:132` renders `s.location ?? "-"`, a field the backend never returns — the Location column is permanently `-` today.
- The carrier provider contract already exists and is the correct integration seam: `backend/app/carriers/india_post.py:59-94` implements `get_tracking(awb) -> {"awb", "events": [...]}` and is consumed by `POST /{sid}/sync` (`shipments.py:235`) and `POST /poll-sweep` (`shipments.py:299`). `get_provider` lives in `backend/app/carriers/registry.py`.
- `shipment_service.ingest_event` (`backend/app/services/shipment_service.py:19`) dedupes on `carrier_event_id`, normalizes via `db_normalize` then the provider's `normalize_status`, and rolls up `current_location` / `last_checkpoint_at` / `delivered_at` / `rto_at` / `returned_at`.
- `POST /{sid}/sync` (`shipments.py:218-232`) enforces a 60-second per-shipment cooldown and returns HTTP 429 with code `REFRESH_COOLDOWN`.
- `shipsagar_service.SUPPORTED_COURIERS = ("INDIA_POST", "DTDC")` and `_MATRIX` (`shipsagar_service.py:57-108`) only carry keyword rows for those two couriers. `normalize_shipsagar_status` returns `EXCEPTION` for anything unmatched, and `backend/tests/test_shipsagar.py:123` pins `("UNKNOWN_COURIER", "delivered", "EXCEPTION")`.
- The reference screenshot shows carriers `FEDEX` and `IP`, and raw ShipSagar statuses `FRESH` and `Item bagged` — neither is in the normalized 10-state vocabulary (`shipsagar_service.py:28-39`).
- `ShipSagar`'s `TrackShipment` returns `TrackingDetails[].TrackingHistory[]` entries of `{ActionDate: "16-May-2023", ActionTime: "12:27", ActionLocation, ActionDescription}` — two separate non-ISO fields, and no event identifier of any kind.
- `web/src/App.tsx:64` routes `/shipments` to `web/src/pages/Shipments.tsx`; `web/src/lib/app-nav.ts:10` links it under the Orders nav group.
- Two page dialects coexist: legacy `var(--*)` inline styles (`Shipments.tsx`) and Tailwind utilities with emerald accents (`Orders.tsx:114`, `NewOrderDialog.tsx`). The newer India Post work uses the Tailwind dialect.
- `web/tests/shipments.test.tsx` is an 11-line misnomer that only asserts `slaTone()` and never renders the page.
- Backend tests have **no** `conftest.py`; each file hand-rolls `_mk()` / `_client()` / `_authed()` helpers (`test_shipsagar.py:24-92`) and asserts on the envelope, e.g. `assert r.json()["error"]["code"] == "INVALID_SIGNATURE"`.
- `ShipSagar` documents the success body as lowercase `{"status": "success", "message": "..."}` but the failure body as `{"Status": "ERROR", "Message": "..."}`. Key casing is inconsistent within the same document, so status comparison must be case-insensitive.

## 3. Decisions (from clarifications)

- Tracking numbers are supplied by the India Post worker and typed by the user into the push dialog; never generated, never taken from `order.barcode_no`.
- Auto-create one `Parcel` per order at push time (`barcode_value = tracking_no`) so the NOT NULL `parcel_id` FK is satisfied without a migration.
- Courier is chosen per order in the push dialog; default India Post.
- CustomerName / EmailID / MobileNo / CompanyName map from the Order; `CountryName` is the constant `"India"` and `ShipmentType` the constant `"Road"`. Missing email or company sends as empty string.
- Push happens immediately on submit — one action creates the Parcel, the Shipment, and the ShipSagar record, then tracking starts on the auto-refresh. No separate "create then push" step, no bulk multi-select.
- Tracking refresh runs every ~25 seconds across all non-terminal rows on the current page, but the existing 60-second per-shipment cooldown means each AWB is really only re-fetched once a minute.
- The page replaces the existing `/shipments` page rather than sitting beside it.
- The Current Status column and the status chips use the normalized 10-state vocabulary, not ShipSagar's raw text.
- The Customer / Shipment Type / Country Name / Company Name columns are produced by outer-joining `Order` in the list query — no new columns, no migration.
- Filtering is server-side; carrier and status chip counts are facet counts computed over the full filtered result set, not the current page.
- The ShipSagar health banner and Retry drain button stay on the page, moved below the table.
- Status normalization gains a generic English fallback matrix for couriers outside India Post and DTDC, so a FedEx parcel does not normalize to `EXCEPTION` forever.

## 4. Approach Selected: A — real ShipSagar client behind the existing provider seam

ShipSagar becomes a first-class carrier provider (`ShipsagarProvider`) that speaks the real PushShipment / TrackShipment protocol, and the existing sync + poll-sweep machinery drives it unchanged. The push action is a new endpoint on the shipments router.

Rejected B (a bespoke `/api/v1/shipsagar/push` + `/api/v1/shipsagar/track` pair bypassing the carrier registry). It would work, but it forks the tracking path: `/poll-sweep`, the 60s cooldown, `ingest_event` dedupe, and terminal-state guards would all need duplicating, and ShipSagar parcels would be second-class citizens next to India Post and DTDC ones.

Rejected C (keep everything inside `shipsagar_service` and skip the registry). Fewer files, but the page would need its own sync endpoint and the two tracking pipelines would drift apart.

## 5. Architecture

- Config — `backend/app/config.py`:
  - `shipsagar_api_base_url: str = "https://app.shipsagar.com/api/Web"` (default filled in; the stub behaviour keys off token presence, not base URL).
  - `shipsagar_token: str = ""` (new; ShipSagar "api key" from the client profile page).
  - `shipsagar_client_code: str = ""` (new; ShipSagar "client code" from the client profile page).
  - Keep `shipsagar_webhook_secret`. Keep `shipsagar_api_key` as a deprecated alias that, if set, is used as `shipsagar_token` so existing `.env` files do not silently break.
  - Add `SHIPSAGAR_*` entries to `.env.example`.
  - `is_configured()` becomes `bool(shipsagar_token and shipsagar_client_code)`.
- ShipSagar client — `backend/app/services/shipsagar_service.py`:
  - Replace `_post()` with `_post(path, payload)` that injects `Token` and `ClientCode` into the JSON body and sends no auth header. Raises `ShipsagarError` with codes `SHIPSAGAR_NOT_CONFIGURED`, `SHIPSAGAR_CLIENT_MISSING`, `SHIPSAGAR_API_ERROR`, `SHIPSAGAR_BAD_RESPONSE`.
  - `_is_ok(data)` compares `str(data.get("status") or data.get("Status") or "").strip().lower()` against `"success"`, and pulls the message from `message` or `Message`.
  - `push_shipment(*, token_free payload) -> dict` → `POST /PushShipment`. Returns `{"ok": bool, "message": str}`; never raises for a provider-level ERROR, only for transport and configuration failures.
  - `track_shipment(tracking_no) -> dict` → `POST /TrackShipment`. Flattens `TrackingDetails[]` (first entry only — ShipSagar keys on one TrackingNo per call) into `{"awb", "events": [...]}`, each event `{"event_id", "status_raw", "normalized_status", "message", "location", "event_time"}`. `event_id` is synthesized as `ss-{tracking_no}-{ActionDate}-{ActionTime}-{index}` since ShipSagar supplies none — this is what makes `ingest_event` dedupe repeated polls correctly. `event_time` parses `f"{ActionDate} {ActionTime}"` with `%d-%b-%Y %H:%M`, falling back to now on failure.
  - `register_tracking()` is reworked onto `push_shipment` and keeps its retry-queue contract. The `SS-STUB-*` placeholder id is retained only for the not-configured path so local dev and the existing 13 tests keep working; when credentials are present the id is `SS-{tracking_no}`.
- Carrier provider — `backend/app/carriers/shipsagar.py` (new), registered in `registry.py` under `"SHIPSAGAR"`:
  - `code = "SHIPSAGAR"`, `normalize_status(raw)` delegates to `shipsagar_service.normalize_shipsagar_status(self.courier, raw)`, `get_tracking(awb)` returns `track_shipment(awb)` unchanged.
  - Because the courier varies per shipment while the registry key does not, `ShipsagarProvider` reads the courier from the shipment at call time via the `get_tracking` call path; `sync` and `poll-sweep` pass `s.carrier_code` through.
- Status normalization — `shipsagar_service.py`:
  - `_MATRIX` gains a third `_GENERIC_MATRIX` consulted only when the courier is not `INDIA_POST` or `DTDC`, carrying the union of English keywords (booked, picked up, manifest, out for delivery / OFD, in transit / shipped / arrived / reached, delivered, undelivered / delivery failed / attempt, returned, RTO, lost, damaged, exception, on hold) in the same negative-before-positive order.
  - Unmatched still yields `EXCEPTION`. `("UNKNOWN_COURIER", "delivered", "EXCEPTION")` in `test_shipsagar.py:123` is updated to expect `DELIVERED`, since that is the point of the fallback.
- Endpoints — `backend/app/api/shipments.py`:
  - `POST /api/v1/shipments/push`, body `{order_id, tracking_no, courier_code}`, ADMIN/WAREHOUSE. Resolves the Order within `u["business_id"]`, rejects a second shipment for the order, creates the `Parcel` (`parcel_code = tracking_no[:32]`, `barcode_value = tracking_no[:32]`), creates the `Shipment` (`tracking_status = "READY_TO_SHIP"`, `shipsagar_tracking_id = f"SS-{tracking_no}"`, `shipped_at = now`), calls `push_shipment`, and commits regardless. Returns `{**_sdict(s), pushed: bool, message: str}`.
  - `GET ""` gains `date_from`, `date_to`, `order_no` params and returns `facets: {"carriers": [{"code","count"}], "statuses": [{"code","count"}]}` computed with two `GROUP BY` counts over the same filtered query, alongside the existing paginated `items`.
  - `_sdict` gains `order_no`, `customer_name`, `customer_email`, `customer_mobile`, `company_name` (from the outer-joined Order, all nullable-safe), plus constants `shipment_type = "Road"` and `country_name = "India"`.
- Frontend — `web/src/pages/Shipments.tsx` (rewrite), `web/src/lib/api.ts` (types + `pushShipmentShipment`), `web/src/lib/app-nav.ts` (unchanged — `/shipments` already linked).
- Migration: none.

## 6. Components / Dialog (7 groups, help text each)

1. **Order** — select from the tenant's orders, defaulting to the order the user navigated from; shows `#name`, receiver name, city and pincode so the wrong order is obvious before pushing.
2. **Tracking No** — required, free text, no pattern constraint; help e.g. "Tracking number issued by the India Post worker (e.g. EG080960145IN). This becomes the parcel barcode and the AWB."
3. **Courier** — select with `IP` (India Post, default), `DTDC`, and `FEDEX`, plus a free-text option for any other ShipSagar courier code; help e.g. "ShipSagar courier code from the client profile. Confirm India's exact code before the first live push."
4. **Customer** — read-only preview of `receiver_name`, `receiver_email`, `receiver_mobile` as they will be sent.
5. **Company Name** — read-only preview of `receiver_company`; empty renders as "(empty)" so the user knows ShipSagar will receive a blank.
6. **Country / Shipment Type** — read-only, always `India` and `Road`.
7. **Validation** — Tracking No non-blank and unique for the chosen courier within the tenant; the order must not already have a shipment; role must be ADMIN or WAREHOUSE. Errors render inline per field with `role="alert"`; provider errors render as a single banner above the footer buttons because they are not field-specific.

## 7. Data Flow

Push: pick order → type Tracking No → choose courier → POST `/api/v1/shipments/push` → backend creates Parcel + Shipment → calls `POST /PushShipment` with the mapped body → commits → table shows the new row at `READY_TO_SHIP`.

Track: 25s timer → for each non-terminal row on the page, `POST /{sid}/sync` → 60s cooldown gate → `ShipsagarProvider.get_tracking` → `POST /TrackShipment` → `ingest_event` per history entry (dedupe on the synthesized event id) → roll-up of `tracking_status` / `current_location` / `last_checkpoint_at` and the terminal timestamp fields → list refetch → chips and counts update.

Filters: `date_from` / `date_to` → `Shipment.created_at` bounds; `q` → AWB / order name / barcode; `order_no` → `Order.shopify_order_name` or `internal_order_number`; `status` / `carrier` → exact match, AND-combined. Facets are computed after all filters are applied, so chip counts reflect the filtered set.

## 8. Error Handling

- Envelope errors `{"success": false, "error": {code, message}}` with `X-Error-Code`, matching the existing shipments router.
- `FORBIDDEN` 403 (not ADMIN/WAREHOUSE); `ORDER_NOT_FOUND` 404 (order missing or another tenant's); `SHIPMENT_EXISTS` 400; `DUPLICATE_TRACKING` 400 (blank tracking no, or AWB already used for this courier — the `uq_ship_biz_carrier_awb` constraint); `SHIPSAGAR_NOT_CONFIGURED` 400; `SHIPSAGAR_API_ERROR` 502 for transport and non-JSON failures.
- Provider-level ERROR responses never reject the request: the Parcel and Shipment are already committed, a `ShipsagarRetryJob` is queued on the existing 30s / 2min / 10min / dead-letter backoff, and the response carries `pushed: false` with ShipSagar's own message.
- `ingest_event`'s terminal guard and forward-only status rank still apply, so an out-of-order or stale ShipSagar history entry cannot regress a delivered parcel.
- Token and client code are read from settings only and never returned by any endpoint or echoed into the ShipmentEvent `raw_payload`.
- ShipSagar's inconsistent `status` / `Status` casing is handled by case-insensitive comparison rather than by trusting either form.
- ShipSagar's undocumented rate limit is respected by the existing 60s per-shipment cooldown; the 25s UI timer cannot outrun it.

## 9. Testing

- Backend: extend `backend/tests/test_shipsagar.py`. Cases — PushShipment success and ERROR response with the transport monkeypatched; `Token`/`ClientCode` present in the outbound body; TrackShipment history flattening including the `16-May-2023` + `12:27` parse and the synthesized `event_id`; repeated TrackShipment polls producing zero duplicate events; the generic courier fallback matrix including the updated `UNKNOWN_COURIER` expectation; parcel auto-creation and duplicate-order rejection on push; `facets` counts; `date_from` / `date_to` filtering; the 60s cooldown 429 on the new provider path. Also update `test_final_fixes.py` if it pins the old Bearer-header or `/trackings` behaviour.
- Frontend: rewrite `web/tests/shipments.test.tsx` (today it only tests `slaTone()`). Cases — chips render with facet counts, the push dialog submits the typed Tracking No and courier, the 25s timer issues syncs for non-terminal rows only, and the 429 cooldown is swallowed rather than surfaced as an error.
- Manual: with real `SHIPSAGAR_TOKEN` and `SHIPSAGAR_CLIENT_CODE` set, push one India Post order end to end, confirm the row appears, then confirm a location change shows up within roughly 60 seconds.

## 10. Out of Scope

- The `GetCourier` API (`POST /api/Web/GetCourier`) — excluded by request, so the courier code is a select plus free text rather than a fetched list. Reconsider if the ShipSagar account carries codes this project does not recognise.
- The ShipSagar webhook receiver at `POST /api/webhooks/shipsagar` — already built and already covered by tests; unchanged. It coexists with polling by design, since `ingest_event` dedupes on event id either way.
- Bulk multi-select push of many orders in one submit — the push action is per order.
- Persisting customer name, email, mobile, company, country or shipment type on `shipments` — supplied by an Order join, so there is no snapshot of what ShipSagar actually received. Add columns later only if an audit requirement appears.
- Label generation and label printing for ShipSagar parcels — out of scope for this document.

## 11. Self-Review

- No TBD/TODO; every decision in §3 traces to a user clarification and every claim in §2 to a file path or a quoted doc string.
- Consistent: §5 stores nothing new in the database, §3's "no migration" and §4's provider-registry rationale agree, and the normalized-status choice in §3 matches the fallback matrix in §5.
- Scoped to one backend client change, one new provider, two endpoint changes and one page rewrite; the webhook, retry queue and poll-sweep are reused rather than duplicated.
- Ambiguity resolved: the ShipSagar courier code for India Post is not documented anywhere in the provided API doc, so the courier control offers `IP`, `DTDC` and `FEDEX` plus free text, and the exact India Post code is confirmed against the ShipSagar client profile before the first live push rather than guessed in code.
- Ambiguity resolved: `ShipSagar`'s `TrackShipment` returns a `TrackingDetails` array for a single requested `TrackingNo`, so only the first entry is flattened; a multi-detail response for one AWB is not expected.
- Known follow-up: `Shipments.tsx:132` currently reads `s.location` against a backend field named `current_location`; the rewrite drops the field rather than aliasing it, and the Location column is replaced by the Current Status and Customer columns from the screenshot.