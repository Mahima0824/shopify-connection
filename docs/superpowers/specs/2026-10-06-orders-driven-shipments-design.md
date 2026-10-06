# Orders-Driven Shipment Flow + GetCourier — Design Spec
Date: 2026-10-06
Status: Draft (pending user review)
Supersedes: section 3 of `2026-10-03-shipsagar-push-track-design.md` (dedicated Shipments page)
Source API Doc: ShipSagar `PushShipment`, `TrackShipment`, `GetCourier`

## 1. Goal

Make the Orders page the single entry point for shipments. Remove the standalone Shipments page from the navigation. Every order carries a Shipment cell: an **Add Shipment** button when no tracking number exists, the tracking number plus a live status pill once it does. Manual orders (created via **New Order**) ask for the tracking number immediately after saving, so a manually created order becomes a tracked shipment in one step. Shopify orders get a shipment row automatically on sync and wait for a tracking number. Clicking a tracking number opens a tracking history page rendering every `TrackShipment` action as a timeline. Integrate the third ShipSagar endpoint, `GetCourier`, so the courier dropdown is populated from the carrier itself rather than hardcoded.

## 2. Evidence (verified)

- `PushShipment` (`https://app.shipsagar.com/api/Web/PushShipment`) takes `Token`, `ClientCode`, `CourierCode`, `TrackingNo`, `OrderNo`, `CustomerName`, `EmailID`, `ShipmentType`, `MobileNo`, `CountryName`, `CompanyName`. Success is `{"status": "success", "message": "..."}`; failure is `{"Status": "ERROR", "Message": "..."}`. Key casing is inconsistent between the two bodies.
- `TrackShipment` (`/TrackShipment`) takes `Token`, `ClientCode`, `TrackingNo`. Success returns `TrackingDetails[].TrackingHistory[]` where each entry is `{ActionDate: "16-May-2023", ActionTime: "12:27", ActionLocation, ActionDescription}`. No event id is supplied.
- `GetCourier` (`/GetCourier`) takes `Token`, `ClientCode`. Success returns `getCourier: [{courierName, courierCode}]`, message like `"48 Record Found"`.
- ShipSagar is documented as aggregating many carriers: DTDC, FedEx, DHL, UPS, Amazon Tracking Services (`ATS`), ARAMEX. `GetCourier` was excluded from the previous plan by user instruction; it is now in scope.
- The courier code for India Post is not stated in the docs. The reference screenshot shows `IP`. The existing `COURIER_ALIASES = {"IP": "INDIA_POST"}` in `backend/app/services/shipsagar_service.py` resolves `IP` to the India Post status matrix.
- `Order.internal_order_number` is `String(64)`, globally unique, and already present on every order — a natural home for the generated `OrderNo` with no migration.
- `Order.receiver_name`, `receiver_mobile`, `receiver_company` exist from migration `0019_india_post_order_fields` (uncommitted in the working tree). `shipments_service.build_push_payload` currently maps CustomerName/EmailID/MobileNo/CompanyName from the Order.
- `POST /api/v1/shipments/push` exists and accepts `{order_id, tracking_no, courier_code}`, auto-creating the Parcel and Shipment. This is the endpoint the new flow reuses.
- `web/src/lib/api.ts` ships `COURIER_OPTIONS` as a hardcoded four-entry list. That becomes a live fetch.
- `web/src/pages/Shipments.tsx` is a full standalone page (filters, facet chips, table, pagination, health banner). Its reusable parts are the status pill and the health banner; the page itself leaves the navigation.
- `web/src/pages/OrderTable.tsx` renders the orders list and has no Shipment column today. It is in the uncommitted India Post working set.
- Live database: 12 orders, 10 parcels, 0 shipments, 1 business. Alembic at `0019_india_post_order_fields`.

## 3. Decisions (from clarifications)

- The standalone Shipments page is removed from the navigation; the Orders page is the only entry point.
- Shopify orders auto-create a shipment row with status "awaiting tracking number" and are **not** pushed to ShipSagar until a tracking number is entered — `PushShipment` requires `TrackingNo` and would reject a blank.
- Manually created orders ask for the tracking number immediately after the New Order dialog saves, so the order becomes a shipment in one step.
- `OrderNo` is `YYYYMMDD-NNN`, e.g. `20261006-001`, with the sequence restarting each day. Generated when the shipment is created.
- `EmailID` is one constant for every shipment, from a new `SHIPSAGAR_EMAIL` setting.
- `CompanyName` is a constant from a new `SHIPSAGAR_COMPANY` setting.
- `CountryName` is the constant `"India"`. `ShipmentType` is the constant `"Road"`.
- `CustomerName` and `MobileNo` come from the order (`receiver_name`, `receiver_mobile`) — the only two fields that are not fixed.
- `GetCourier` is integrated and its result populates the courier dropdown, cached because the list rarely changes.
- Courier defaults to India Post but is changeable per shipment.
- Clicking a tracking number opens a dedicated tracking history page rendering the `TrackingHistory` as a timeline, newest first.

## 4. Approach Selected: A — Orders page owns shipments; Shipments page leaves the nav

The Orders page gains a Shipment cell per row and becomes the only place a tracking number is entered or a shipment is viewed. The existing `/shipments/:id` route is rebuilt as the tracking history page. `POST /api/v1/shipments/push` is reused rather than replaced.

Rejected B (keep the Shipments page and add an "Add Shipment" button there too). Two entry points for the same action drift, and the user asked for one.

Rejected C (inline expansion of history on the Orders page). A tracking history with dozens of scans is hard to read inside a table row, and the page would have to refetch on every expand.

## 5. Architecture

- Settings — `backend/app/config.py`:
  - `shipsagar_email: str = ""` — the constant `EmailID`.
  - `shipsagar_company: str = ""` — the constant `CompanyName`.
  - Both are read only server-side. Neither is ever returned to the browser.
- ShipSagar client — `backend/app/services/shipsagar_service.py`:
  - `get_couriers() -> list[dict]` — calls `GetCourier`, returns `[{courierCode, courierName}]` sorted by name, cached in-process for 1 hour. Raises `ShipsagarError` on transport or `status != success`.
  - `build_push_payload` reworked: `EmailID` from `settings.shipsagar_email`, `CompanyName` from `settings.shipsagar_company`, `CountryName`/`ShipmentType` constants, `CustomerName`/`MobileNo`/`OrderNo` from the Order. Falls back to the Order's own `receiver_email`/`receiver_company` when the constants are unset, so a misconfigured deploy still sends something useful.
- Order number — `backend/app/services/order_service.py`:
  - `next_shipment_order_no(db, business_id) -> str` — reads the highest existing `internal_order_number` matching `YYYYMMDD-NNN` for today and returns the next value. Falls back to `001` when none exists.
  - The value is written to `Order.internal_order_number` when the shipment is created. The uniqueness check happens inside the same transaction; a concurrent collision retries once.
- Push endpoint — `backend/app/api/shipments.py`:
  - `POST /api/v1/shipments/push` additionally assigns `OrderNo` and rejects a courier that `GetCourier` does not list (or that is not India Post) so an unusable courier is caught at entry rather than after four failed retries.
  - New `GET /api/v1/shipments/couriers` returns the cached list; ADMIN/WAREHOUSE only.
- Shopify sync — the existing sync path auto-creates a `Shipment` per order with `tracking_status = "AWAITING_TRACKING"`, `carrier_code = "IP"`, and no `awb_number`. It is **not** pushed. `shipments.parcel_id` is NOT NULL, so an auto-created shipment needs a Parcel: reuse the order's existing Parcel when one exists, otherwise create a `CREATED` Parcel whose `barcode_value` is empty-but-unique per shipment.
  - `AWAITING_TRACKING` is added to the status vocabulary and to `TERMINAL` on the backend (nothing to track yet, so nothing to poll). It is **not** terminal on the frontend — it is exactly the state that needs a tracking number, so the UI must keep prompting for it.
- Tracking history — `backend/app/api/shipments.py`:
  - `GET /api/v1/shipments/{sid}/history` calls `TrackShipment` live and returns the raw normalized history plus the derived normalized status, without ingesting. The existing `/sync` continues to ingest for roll-up; the history page reads, it does not write.
- Frontend:
  - `web/src/lib/app-nav.ts` — remove the top-level Shipments entry and the Orders-dropdown Shipments entry.
  - `web/src/components/OrderTable.tsx` — add a Shipment column rendering either **Add Shipment** or the tracking number plus a status pill.
  - `web/src/components/AddShipmentDialog.tsx` (new) — tracking number + courier dropdown from `GET /couriers`.
  - `web/src/components/NewOrderDialog.tsx` — after save, a second step asks for the tracking number.
  - `web/src/pages/ShipmentHistory.tsx` (replaces `ShipmentDetail.tsx`) — the timeline.
  - `web/src/lib/api.ts` — `getShipmentCouriers`, `pushShipment`, `getShipmentHistory`; remove `listShipments`-driven page helpers that become dead.
  - The status pill, the `SHIPMENT_STATUSES` vocabulary, and the health banner are reused rather than rewritten.

## 6. Shipment cell and dialogs (3 groups, help text each)

1. **Awaiting tracking** — an order with a shipment but no tracking number shows a highlighted **Add Shipment** button plus the text "Awaiting tracking number". This is the state every Shopify order starts in.
2. **Add Shipment dialog** — modal with tracking number (required, free text; help e.g. "Tracking number issued by the India Post worker, e.g. EG080960145IN") and a courier `<select>` populated from `GetCourier` (help e.g. "Loaded from ShipSagar. Defaults to India Post."), with India Post preselected. Submitting shows the ShipSagar response message.
3. **New Order second step** — after the existing manual-order form saves successfully, the dialog advances to a step asking only for the tracking number; submitting it creates the shipment and closes. A "skip for now" link closes the dialog and leaves the order awaiting tracking, because blocking order creation on a tracking number would block the whole workflow.

## 7. Data Flow

Shopify order arrives → sync creates Parcel (if needed) + Shipment at `AWAITING_TRACKING` → Orders page shows **Add Shipment** → user types tracking number + picks courier → `POST /api/v1/shipments/push` generates `OrderNo`, builds the eleven-field payload, calls `PushShipment` → on success the cell shows the tracking number and a status pill.

Manual order: **New Order** → form saves → dialog advances → tracking number → `POST /shipments/push` → same as above.

Tracking history: click tracking number → `GET /shipments/{id}/history` → `TrackShipment` → timeline newest-first. The page also refreshes on a 60s timer so a parcel moving while the page is open updates itself.

## 8. Error Handling

- Envelope errors `{"success": false, "error": {code, message}}` with `X-Error-Code`, matching the existing router.
- `FORBIDDEN` 403; `ORDER_NOT_FOUND` 404; `SHIPMENT_EXISTS` 400 (a second push for the same order); `DUPLICATE_TRACKING` 400; `MISSING_TRACKING_NUMBER` 400; `UNSUPPORTED_COURIER` 400 when the courier is not in the ShipSagar list and is not India Post.
- ShipSagar refusing (`status: ERROR`) still persists the Parcel and Shipment and returns `pushed: false` with its message, because the records already exist. The cell then shows the tracking number with a "not accepted by ShipSagar" state, and a retry job is queued.
- A transport failure queues a retry job and returns 502. The cell still shows the tracking number so the user is not left thinking the entry was lost.
- The tracking history page shows ShipSagar's own error message inline rather than a blank page.
- `SHIPSAGAR_EMAIL` and `SHIPSAGAR_COMPANY` are never echoed to the browser and never appear in a ShipSagar `raw_payload` audit row.
- `GetCourier` failing does not block a push: the dropdown falls back to the last cached list, then to a minimal built-in set, and the courier field accepts a typed code regardless.

## 9. Testing

- Backend, extend `backend/tests/test_shipsagar.py`:
  - `GetCourier` success parse, name-sorted, cached (a second call makes no second HTTP request), and the `status: ERROR` path.
  - `get_couriers` endpoint auth and the forbidden role.
  - `build_push_payload` with constants set: `EmailID` and `CompanyName` come from settings, `CountryName`/`ShipmentType` are the constants, `CustomerName`/`MobileNo` come from the order, `OrderNo` is `YYYYMMDD-NNN`.
  - The constant-unset fallback to the order's own email and company.
  - `next_shipment_order_no`: first call of the day yields `001`, the next yields `002`, a different day restarts at `001`, and an existing non-matching number is ignored.
  - Push assigns `OrderNo`, stores it on the order, and rejects an unsupported courier.
  - Shopify auto-create: an order gains a shipment at `AWAITING_TRACKING` with no `awb_number`, and nothing is pushed.
  - The history endpoint returns the timeline without ingesting events.
- Frontend, replace `web/tests/shipments-page.test.tsx` and add `web/tests/shipment-history.test.tsx`:
  - The Shipment cell renders **Add Shipment** when awaiting, and the tracking number when set.
  - The Add Shipment dialog lists couriers from `GET /couriers` and defaults to India Post.
  - Submitting posts the tracking number and courier.
  - New Order advances to the tracking step and skips cleanly.
  - The history page renders every `TrackingHistory` entry newest-first with description, location, date and time.
  - An empty `TrackingHistory` renders an explicit "no scans yet" rather than a blank page.
- Manual: push one Shopify order and one manual order end to end, confirm the payload reaches ShipSagar with the correct eleven fields, then open the history page and confirm the scans render.

## 10. Out of Scope

- Labels and label printing for ShipSagar parcels.
- Editing a tracking number after it is pushed — the existing `correct-awb` route covers AWB changes but is not wired into this flow.
- Bulk push of many orders at once.
- Persisting CustomerName, MobileNo, CompanyName, CountryName or ShipmentType on `shipments` — they are supplied at push time from the order and constants, with no snapshot of what ShipSagar actually received. Add columns only if an audit requirement appears.
- The facet chips, filters, pagination and health banner that existed on the old Shipments page. The health banner moves to the tracking history page; the chips and filters are dropped with the page.

## 11. Self-Review

- No TBD/TODO; every decision in §3 traces to a user clarification and every claim in §2 to a file path or a quoted doc string.
- Consistent: §5 removes the page that §4 retires and reuses `POST /shipments/push` rather than introducing a second push path; §3's "no dedicated Shipments page" and §10's dropped chips agree.
- Scoped to one backend service addition, one OrderNumber generator, one push-endpoint change, one sync-hook, and a frontend move from Shipments to Orders.
- Ambiguity resolved: `AWAITING_TRACKING` is terminal on the backend (nothing to poll) but not on the frontend (it is the state that prompts for input) — the two vocabularies deliberately differ, and both are pinned by tests so the divergence cannot drift.
- Ambiguity resolved: the shipment's required NOT NULL `parcel_id` is satisfied by reusing the order's Parcel where one exists and creating a placeholder otherwise; a shipment that is only ever "awaiting tracking" never needs its barcode.
- Known follow-up: `COURIER_ALIASES` maps `IP` to India Post, but `GetCourier` may return a different code for India Post in this account. The exact code must be read from the first live `GetCourier` response and the alias updated before relying on it.