# Blue Dart Courier Integration — Detailed Implementation Plan

**Project:** ReconHub  
**Current courier setup:** India Post via ShipSagar, plus the existing `CarrierProvider` architecture  
**New integration:** Blue Dart  
**Implementation goal:** Add Blue Dart as a first-class courier provider without breaking India Post, DTDC, Tirupati, Manual, or ShipSagar.

> **Important:** This plan treats “bluecart” as **Blue Dart**, based on the supplied project material. Blue Dart’s exact API endpoints, authentication mechanism, credential names, test URLs, and payloads must come from the official Blue Dart ShippingAPI documentation/account onboarding. Do not implement guessed endpoints from third-party examples.

---

## 1. Objective

Integrate Blue Dart into the existing architecture so ReconHub can support the following lifecycle:

```text
Order
  ↓
Serviceability
  ↓
Transit Time / Rate
  ↓
Shipment Creation
  ↓
AWB / Waybill
  ↓
Label
  ↓
Pickup
  ↓
Tracking
  ↓
Delivered / NDR / RTO / Return
  ↓
Reconciliation
```

### Phase-1 target

Start with a reliable minimum vertical slice:

```text
Blue Dart connection
        ↓
Credential validation
        ↓
Serviceability
        ↓
Shipment / AWB creation
        ↓
Tracking
        ↓
Status normalization
        ↓
ShipmentEvent persistence
        ↓
Shipment current-state update
```

Then add labels, pickup, cancellation, returns, pricing, and compliance capabilities incrementally.

---

# 2. Scope

## In scope

### Backend

- Blue Dart provider adapter.
- Blue Dart HTTP/API client.
- Credential validation.
- Secure credential storage through the existing `CarrierConnection` mechanism.
- Serviceability.
- Transit-time support where exposed.
- Shipment/AWB creation.
- Tracking.
- Tracking-event normalization.
- Status mapping to the existing internal status model.
- Shipment-event persistence.
- Event deduplication.
- Shipment current-state updates.
- Error handling, timeout, retry/backoff, and health reporting.
- Unit, API, mocked integration, and end-to-end tests.

### Frontend

- Blue Dart in carrier settings.
- Blue Dart connection flow.
- Blue Dart as a shipment carrier option.
- Blue Dart tracking UI.
- Carrier health/error states.
- Generic normalized-status rendering.

## Out of scope for the first tracking slice

Unless required by the Blue Dart account/API contract, defer:

- Label generation.
- Pickup scheduling/cancellation.
- Shipment/AWB cancellation.
- Returns/RTO requests.
- Rate calculation.
- GST/e-way bill workflows.
- Webhooks/callbacks.
- Automated financial reconciliation.

---

# 3. Blue Dart API Access Prerequisite

The supplied Blue Dart material indicates that integration onboarding is handled through Blue Dart’s **Business Integration Application** / ShippingAPI process rather than assuming a public developer-dashboard API-key flow.

Expected onboarding:

```text
Blue Dart business/customer account
          ↓
Business Integration request
          ↓
ShippingAPI access approved
          ↓
Official API documentation received
          ↓
Test/sandbox credentials received
          ↓
Integration testing
          ↓
Production credentials / approval
```

## Information to obtain from Blue Dart

Request:

1. API documentation.
2. Authentication mechanism.
3. Test/sandbox credentials.
4. Production credentials/process.
5. Test and production base URLs.
6. Shipment creation API.
7. AWB/waybill generation.
8. Tracking API.
9. Pickup registration API.
10. Pickup cancellation API.
11. Shipment cancellation API.
12. Label generation API.
13. Serviceability API.
14. Transit-time API.
15. Rate/price API.
16. Return/RTO API.
17. E-way bill/GST requirements.
18. Webhook/callback support.
19. API rate limits.
20. Error codes and error schemas.
21. Request/response schemas.
22. Sample requests/responses.
23. Test AWBs/test data.

**Do not begin production implementation with placeholder endpoints.** Put the official values into configuration only after Blue Dart supplies them.

---

# 4. Target Architecture

Keep the existing provider abstraction and add a Blue Dart implementation:

```text
CarrierProvider
      │
      ├── ManualProvider
      ├── IndiaPostProvider
      ├── DtdcProvider
      ├── TirupatiProvider
      ├── ShipsagarProvider
      └── BlueDartProvider
                       │
                       ▼
                BlueDartClient
                       │
                       ▼
              Blue Dart ShippingAPI
```

The complete application flow should be:

```text
Frontend
   ↓
ReconHub API
   ↓
Shipment / Carrier Service
   ↓
Provider Registry
   ↓
BlueDartProvider
   ↓
BlueDartClient
   ↓
Blue Dart API
   ↓
Raw response
   ↓
Mapper / Normalizer
   ↓
ShipmentEvent + Shipment
   ↓
Frontend
```

---

# 5. Carrier Code vs Tracking Provider

Your architecture should distinguish these two concepts.

## `carrier_code`

The courier physically transporting the shipment:

```text
BLUEDART
```

## `tracking_provider`

The API/provider used to obtain tracking data:

```text
BLUEDART
```

or, in a future aggregator fallback:

```text
SHIPSAGAR
```

This makes the following possible without redesign:

```text
carrier_code      = BLUEDART
tracking_provider = BLUEDART
```

and later:

```text
carrier_code      = BLUEDART
tracking_provider = SHIPSAGAR
```

If your current system does not yet have `tracking_provider`, adding it is recommended but can be treated as a separate migration from the initial Blue Dart tracking work.

---

# 6. Recommended Project Structure

Preserve the current structure under `backend/app/carriers/`.

```text
backend/
│
├── app/
│   ├── carriers/
│   │   ├── base.py
│   │   ├── registry.py
│   │   ├── india_post.py
│   │   ├── dtdc.py
│   │   ├── tirupati.py
│   │   ├── manual.py
│   │   ├── shipsagar.py
│   │   └── bluedart.py              # NEW
│   │
│   ├── integrations/
│   │   └── bluedart/                # NEW, if this layer fits current codebase
│   │       ├── client.py
│   │       ├── schemas.py
│   │       ├── mapper.py
│   │       ├── exceptions.py
│   │       └── constants.py
│   │
│   ├── models/
│   │   ├── shipment.py
│   │   └── courier_meta.py
│   │
│   ├── services/
│   │   └── ...
│   │
│   └── api/
│       ├── carriers.py
│       ├── shipments.py
│       └── carrier_webhooks.py
│
└── tests/
    └── carriers/
        └── test_bluedart.py         # NEW
```

If your existing project has no `integrations/` layer, do not force a large refactor just for Blue Dart. Put the HTTP-client logic in `bluedart.py` initially, or add a small `BlueDartClient` module only if that matches the existing style.

---

# 7. Phase 0 — Audit Existing Architecture

Before writing the Blue Dart adapter, inspect:

```text
backend/app/carriers/base.py
backend/app/carriers/registry.py
backend/app/carriers/dtdc.py
backend/app/carriers/india_post.py
backend/app/carriers/shipsagar.py

backend/app/models/shipment.py
backend/app/models/courier_meta.py

backend/app/services/shipsagar_service.py

backend/app/api/carriers.py
backend/app/api/shipments.py
```

Frontend:

```text
frontend/src/.../CarriersSettings.tsx
frontend/src/.../AddShipmentDialog.tsx
frontend/src/.../Tracking.tsx
frontend/src/.../Shipments.tsx
frontend/src/.../ShipmentList.tsx
frontend/src/.../api.ts
```

## Audit questions

Determine exactly:

- What methods `CarrierProvider` requires.
- What `get_tracking()` currently returns.
- How credentials are loaded.
- How credentials are encrypted/decrypted.
- How carrier health is stored.
- Where `ShipmentEvent` records are created.
- Where `Shipment` is updated after tracking.
- Whether `carrier_code` is a free-form string, enum, or constrained value.
- Whether the frontend has hard-coded carrier arrays.
- Whether background tracking already exists.
- Whether `CarrierConnection` is tenant/store scoped.

**Do not duplicate an existing mechanism.**

---

# 8. Phase 1 — Define `BlueDartProvider`

Create:

```text
backend/app/carriers/bluedart.py
```

Provider methods should align with the existing interface. Conceptually:

```python
class BlueDartProvider(CarrierProvider):

    def capabilities(self):
        ...

    def validate_credentials(self, credentials):
        ...

    def check_serviceability(self, request, credentials):
        ...

    def calculate_rate(self, request, credentials):
        ...

    def create_shipment(self, request, credentials):
        ...

    def generate_label(self, shipment, credentials):
        ...

    def schedule_pickup(self, request, credentials):
        ...

    def cancel_pickup(self, pickup_id, credentials):
        ...

    def cancel_shipment(self, shipment, credentials):
        ...

    def get_tracking(self, awb, credentials):
        ...

    def normalize_status(self, raw_status):
        ...

    def build_tracking_url(self, awb):
        ...
```

Do not add methods to the base class merely for Blue Dart if the existing architecture does not need them yet. Extend the common interface deliberately when the second/third carrier needs the same capability.

---

# 9. Phase 2 — Capability Model

Recommended priority:

| Priority | Capability | Purpose |
|---|---|---|
| P0 | Serviceability | Check whether destination is supported |
| P0 | Transit Time | Estimate movement/delivery |
| P0 | Shipment / AWB Creation | Create shipment |
| P0 | Tracking | Track current state/history |
| P1 | Label Generation | Print shipping label |
| P1 | Pickup Registration | Request pickup |
| P1 | Pickup Cancellation | Cancel pickup |
| P1 | Shipment/AWB Cancellation | Cancel shipment |
| P1 | Return/RTO | Reverse logistics |
| P2 | Rate/Pricing | Calculate shipping cost |
| P2 | GST/E-way Bill | Compliance |
| P2 | Webhook/Callback | Event-driven tracking |

Initially, return only capabilities that are actually implemented and tested.

Example phase-1 capability response:

```python
["TRACKING", "SERVICEABILITY"]
```

Add `LABEL`, `PICKUP`, `RETURN`, etc. only after those workflows are implemented.

---

# 10. Phase 3 — Blue Dart HTTP Client

Create:

```text
backend/app/integrations/bluedart/client.py
```

Responsibilities:

```text
Authentication
Request construction
Headers
Query parameters
Payload serialization
Timeouts
HTTP status handling
Response parsing
Response validation
Retry/backoff
Structured logging
```

Conceptual interface:

```python
class BlueDartClient:

    def __init__(self, credentials, base_url, timeout=30):
        ...

    def serviceability(self, request):
        ...

    def create_shipment(self, request):
        ...

    def track_shipment(self, awb):
        ...

    def generate_label(self, shipment):
        ...

    def register_pickup(self, request):
        ...

    def cancel_pickup(self, pickup_id):
        ...

    def cancel_shipment(self, request):
        ...

    def create_return(self, request):
        ...
```

The exact Blue Dart paths, methods, headers, query/body fields, and response structures must be filled from the official API documentation received for the account.

---

# 11. Phase 4 — Configuration

Keep configuration flexible until Blue Dart provides the credential specification.

Conceptual environment configuration:

```env
BLUEDART_ENABLED=true
BLUEDART_BASE_URL=
BLUEDART_TIMEOUT=30
```

Do not blindly create and use every possible field such as:

```env
BLUEDART_API_KEY=
BLUEDART_API_SECRET=
BLUEDART_USERNAME=
BLUEDART_PASSWORD=
BLUEDART_CUSTOMER_CODE=
BLUEDART_ACCOUNT_CODE=
```

Only add variables that the actual Blue Dart contract requires.

For account-specific credentials, prefer the existing encrypted `CarrierConnection` mechanism instead of hard-coding one global courier account into application settings.

---

# 12. Phase 5 — Credential Storage and Validation

Use the existing model:

```text
CarrierConnection
```

Conceptual fields:

```text
id
carrier_code
credentials_encrypted
is_active
last_success_at
last_error_message
created_at
updated_at
```

For Blue Dart:

```text
carrier_code = BLUEDART
```

## Connection flow

```text
Admin enters Blue Dart credentials
        ↓
POST /api/v1/carriers/BLUEDART/connect
        ↓
Load BlueDartProvider
        ↓
validate_credentials()
        ↓
Official Blue Dart auth/verification call
        ↓
Success
   ↓
Encrypt + save credentials
```

Failure:

```text
Validation fails
        ↓
Return controlled error
        ↓
Do not persist invalid credentials
```

Never return decrypted credentials in API responses.

---

# 13. Phase 6 — Serviceability

Create a common application-level request rather than exposing Blue Dart's raw request format to the frontend.

Conceptual input:

```text
origin pincode
destination pincode
weight
shipment type
payment mode
```

Flow:

```text
ReconHub request
      ↓
BlueDartProvider.check_serviceability()
      ↓
BlueDartClient
      ↓
Blue Dart API
      ↓
Raw response
      ↓
Mapper
      ↓
Common response
```

Conceptual response:

```json
{
  "serviceable": true,
  "origin": "395003",
  "destination": "400001",
  "estimated_transit_days": 2
}
```

Do not invent response fields if the official API does not return them.

---

# 14. Phase 7 — Transit Time

Normalize Blue Dart transit-time data into the common ReconHub model.

Example:

```json
{
  "serviceable": true,
  "estimated_transit_days": 2
}
```

The frontend should consume this common contract instead of Blue Dart field names.

---

# 15. Phase 8 — Shipment Creation

Target flow:

```text
Shopify Order
      ↓
ReconHub Order
      ↓
Validate shipment data
      ↓
Check Blue Dart serviceability
      ↓
Create Blue Dart shipment
      ↓
Receive AWB/Waybill
      ↓
Persist shipment
```

The common request should contain, as applicable:

```text
order/reference ID
sender details
receiver name
receiver phone
receiver address
receiver pincode
weight
dimensions
payment mode
COD amount
declared value
invoice information
```

Only send fields supported/required by the Blue Dart contract.

---

# 16. AWB / Waybill Handling

Keep the shipment model generic:

```text
carrier_code = BLUEDART
awb_number   = <Blue Dart waybill>
```

Do **not** create:

```text
bluedart_awb
delhivery_awb
dtdc_awb
```

If Blue Dart gives an external shipment/reference ID, store it in a generic field such as:

```text
courier_shipment_id
reference_number
```

---

# 17. Shipment Creation Idempotency

Shipment creation is a high-risk operation because a timeout can happen after Blue Dart successfully creates the shipment.

Bad flow:

```text
Create shipment
   ↓
Timeout
   ↓
User retries
   ↓
Second shipment created
```

Required behavior:

```text
Stable ReconHub shipment/reference
        ↓
Check existing carrier shipment/AWB
        ↓
If already created → return existing record
        ↓
Otherwise create once
```

Use an official Blue Dart idempotency mechanism if one is available. Otherwise enforce idempotency inside ReconHub.

---

# 18. Phase 9 — Tracking

Implement:

```python
get_tracking(awb, credentials)
```

Flow:

```text
AWB
 ↓
BlueDartProvider
 ↓
BlueDartClient.track_shipment()
 ↓
Blue Dart Tracking API
 ↓
Raw response
 ↓
Parse events
 ↓
Normalize statuses
 ↓
Return common tracking response
```

Conceptual common response:

```json
{
  "awb": "123456789",
  "status": "IN_TRANSIT",
  "current_location": "Ahmedabad",
  "events": [
    {
      "status_raw": "Arrived at Ahmedabad Hub",
      "status": "IN_TRANSIT",
      "location": "Ahmedabad",
      "event_time": "2026-10-08T10:30:00"
    }
  ]
}
```

The actual mapper must use the real Blue Dart response schema.

---

# 19. Phase 10 — Status Normalization

Your application owns the canonical status model.

Current model from your architecture includes:

```text
READY_TO_SHIP
IN_TRANSIT
OUT_FOR_DELIVERY
DELIVERED
FAILED_ATTEMPT
RTO
RETURNED
LOST
EXCEPTION
```

If you choose to support a richer lifecycle, you can extend with:

```text
CREATED
AWB_ASSIGNED
PICKUP_SCHEDULED
PICKED_UP
CANCELLED
NDR
RTO_INITIATED
RTO_IN_TRANSIT
RTO_DELIVERED
DAMAGED
```

Do not introduce new statuses just because another courier uses different names. Add one only when there is a clear product/business requirement.

---

# 20. Blue Dart Status Mapper

Create:

```text
backend/app/integrations/bluedart/mapper.py
```

Example structure:

```python
BLUEDART_STATUS_MAP = {
    # Populate only from actual Blue Dart status values.
}
```

Normalization pipeline:

```text
Raw Blue Dart status
       ↓
Trim/normalize case
       ↓
Exact match / controlled keyword mapping
       ↓
ReconHub canonical status
```

Keep the raw value in the database for debugging and reconciliation.

---

# 21. Unknown Status Handling

Unknown carrier statuses must never crash tracking.

Required behavior:

```text
Unknown Blue Dart status
       ↓
Store raw value
       ↓
Map to safe fallback such as EXCEPTION
       ↓
Log unknown value
```

Avoid:

```python
STATUS_MAP[raw_status]
```

when it can raise `KeyError` and take down a tracking request.

---

# 22. Phase 11 — Shipment Event Persistence

Reuse the existing `ShipmentEvent` model if it already supports:

```text
shipment_id
carrier_status_raw
normalized_status
location
event_time
```

Optionally add if required by your architecture:

```text
remarks
raw_event_id
raw_response
```

Every successful tracking response should update history, not just overwrite the current shipment status.

---

# 23. Tracking Event Deduplication

Polling the same shipment repeatedly can return the same history.

Preferred event identity:

```text
Blue Dart event ID
```

if the API provides one.

Otherwise use a stable composite such as:

```text
shipment_id
+
event_time
+
raw status
+
location
```

Flow:

```text
Tracking event
      ↓
Generate event identity
      ↓
Already stored?
   ├── YES → skip
   └── NO  → insert
```

---

# 24. Shipment Current-State Update

After tracking, update the generic shipment state:

```text
Shipment.tracking_status
Shipment.current_location
Shipment.shipped_at
Shipment.delivered_at
```

only when the corresponding information is actually supported by the carrier response.

Example:

```text
Blue Dart raw state = Delivered
        ↓
tracking_status = DELIVERED
delivered_at = delivery event time
```

Do not fabricate timestamps.

---

# 25. Phase 12 — Label Generation

Implement after connection, shipment creation, and tracking are stable.

Flow:

```text
Shipment
   ↓
generate_label()
   ↓
Blue Dart API
   ↓
Label response
   ↓
Normalize to ReconHub label response
```

Depending on the official API, Blue Dart may return a URL, PDF, binary content, or another representation. Do not bake one assumption into the frontend.

---

# 26. Phase 13 — Pickup Registration

After shipment creation is stable:

```text
Shipment created
      ↓
Pickup request
      ↓
Blue Dart API
      ↓
Pickup confirmation
      ↓
Store pickup reference/status
```

Keep pickup identifiers separate from AWB.

---

# 27. Phase 14 — Pickup Cancellation

Implement only when the API contract and shipment lifecycle permit it.

Validate current shipment/pickup state before making the external call.

Do not expose a generic “Cancel Pickup” button for states where cancellation is not valid.

---

# 28. Phase 15 — Shipment / AWB Cancellation

The application should validate its own business state before calling Blue Dart.

Example:

```text
Shipment state
      ↓
Can cancel?
  ├── YES → Blue Dart cancellation API
  └── NO  → business-state error
```

Do not assume a shipped or delivered parcel can be cancelled just because a cancellation endpoint exists.

---

# 29. Phase 16 — Returns / RTO

Eventually support the reverse-logistics lifecycle:

```text
RTO_INITIATED
RTO_IN_TRANSIT
RTO_DELIVERED
RETURNED
```

Preserve the distinction between customer return and courier RTO when the Blue Dart data allows it.

Do not collapse all reverse logistics into one status if the reconciliation business process needs the distinction.

---

# 30. Phase 17 — Rates and Pricing

When the rate API is implemented, normalize to a common contract.

Conceptual:

```json
{
  "base_charge": 0,
  "fuel_surcharge": 0,
  "cod_fee": 0,
  "tax": 0,
  "other_charges": 0,
  "total": 0,
  "currency": "INR"
}
```

The actual fields depend on the Blue Dart API.

For ReconHub reconciliation, distinguish:

```text
quoted/estimated cost
actual invoiced cost
COD charges
settlement amount
variance
```

Do not mix rate calculation with shipment tracking state.

---

# 31. Phase 18 — Reconciliation Data

Because ReconHub is a reconciliation platform, eventually support generic financial fields such as:

```text
shipment_cost_estimated
shipment_cost_actual
cod_amount
cod_fee
tax
other_charges
settled_amount
variance
```

Tracking answers:

```text
Where is the parcel?
```

Reconciliation answers:

```text
What did the courier charge and settle?
```

Keep these concerns separated in the service/data model.

---

# 32. Phase 19 — Carrier Registry

Update:

```text
backend/app/carriers/registry.py
```

Add:

```python
"BLUEDART": BlueDartProvider(),
```

Conceptual registry:

```python
PROVIDERS = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
    "SHIPSAGAR": ShipsagarProvider(),
    "BLUEDART": BlueDartProvider(),
}
```

Verify:

```python
get_provider("BLUEDART")
```

returns the correct implementation.

---

# 33. Phase 20 — Carrier API

Existing:

```http
GET /api/v1/carriers
```

must expose Blue Dart.

Conceptual response:

```json
{
  "code": "BLUEDART",
  "name": "Blue Dart",
  "connected": false,
  "capabilities": [
    "TRACKING"
  ]
}
```

Use backend carrier metadata as the source of truth.

---

# 34. Connect API

Existing route:

```http
POST /api/v1/carriers/{code}/connect
```

should support:

```http
POST /api/v1/carriers/BLUEDART/connect
```

Flow:

```text
Request
 ↓
Validate carrier code
 ↓
Validate credential payload
 ↓
BlueDartProvider.validate_credentials()
 ↓
Encrypt credentials
 ↓
Save CarrierConnection
```

Only authorized roles should be allowed to connect/disconnect carriers.

---

# 35. Disconnect API

Existing route:

```http
DELETE /api/v1/carriers/BLUEDART/disconnect
```

should:

- Disable future Blue Dart API operations.
- Preserve shipment history.
- Preserve tracking events.
- Preserve reconciliation history.
- Avoid deleting shipments.

Disconnecting a carrier should not destroy historical business data.

---

# 36. Phase 21 — Generic Tracking API

Keep the existing application-level endpoint:

```http
GET /api/v1/shipments/{id}/tracking
```

Backend flow:

```text
Shipment
 ↓
carrier_code = BLUEDART
 ↓
get_provider("BLUEDART")
 ↓
BlueDartProvider.get_tracking()
 ↓
Blue Dart API
 ↓
normalize
 ↓
persist events
 ↓
update Shipment
 ↓
return common tracking response
```

Do not expose a Blue Dart-only frontend API unless there is a real product reason.

---

# 37. Phase 22 — Frontend Carrier Settings

Current frontend code has hard-coded carrier lists such as:

```typescript
const KNOWN = [
    "DTDC",
    "TIRUPATI",
    "INDIA_POST",
    "MANUAL"
];
```

Do not simply append:

```typescript
"BLUEDART"
```

in every component.

Prefer:

```text
GET /api/v1/carriers
        ↓
Frontend carrier list
```

This makes the backend registry the single source of truth.

---

# 38. `CarriersSettings.tsx`

Blue Dart should display approximately:

```text
Blue Dart
──────────────
Status: Not Connected
Capabilities:
✓ Tracking

[Connect]
```

Connected:

```text
Blue Dart
──────────────
Status: Connected
Last successful request: ...

[Disconnect]
```

Error:

```text
Blue Dart
──────────────
Status: Error
Last error: Authentication failed

[Reconnect]
```

Do not expose saved credential secrets.

---

# 39. Blue Dart Connection Form

Build the form according to the credential specification supplied by Blue Dart.

For example, if Blue Dart provisions:

```text
API Key
API Secret
Customer Code
```

show those fields.

If the provisioned contract instead uses:

```text
Username
Password
Customer Code
```

show those fields.

Do not hard-code a credential model before the official documentation is available.

---

# 40. `AddShipmentDialog.tsx`

Blue Dart should be selectable through the carrier API:

```text
India Post
DTDC
Blue Dart
Manual
```

When selected:

```text
carrier_code = BLUEDART
```

and the generic AWB field remains:

```text
awb_number
```

Do not create a Blue Dart-specific AWB field.

---

# 41. Tracking UI

Recommended experience:

```text
Carrier
[ Blue Dart ▼ ]

AWB Number
[______________]

[Track]
```

Display normalized lifecycle:

```text
● Shipment Created
│
● Picked Up
│
● In Transit
│
● Out for Delivery
│
● Delivered
```

The frontend should render canonical application statuses, not parse Blue Dart's raw strings.

---

# 42. Frontend Status Rendering

Use the existing internal status enum:

```text
READY_TO_SHIP
IN_TRANSIT
OUT_FOR_DELIVERY
DELIVERED
FAILED_ATTEMPT
RTO
RETURNED
LOST
EXCEPTION
```

Blue Dart-specific text remains inside the backend integration/mapping layer.

---

# 43. Phase 23 — Health Monitoring

Existing endpoint:

```http
GET /api/v1/carriers/health
```

must include Blue Dart.

Example healthy response:

```json
{
  "code": "BLUEDART",
  "status": "HEALTHY",
  "last_success_at": "2026-10-08T18:30:00",
  "last_error_message": null
}
```

Suggested failure categories:

```text
AUTHENTICATION_ERROR
INVALID_REQUEST
INVALID_AWB
TIMEOUT
RATE_LIMITED
UPSTREAM_ERROR
RESPONSE_PARSE_ERROR
UNKNOWN_ERROR
```

---

# 44. Phase 24 — Background Tracking

For bulk shipment tracking, do not have the browser make one direct carrier request per row.

Preferred architecture:

```text
Scheduler / Worker
        ↓
Find active Blue Dart shipments
        ↓
Fetch tracking
        ↓
Normalize
        ↓
Persist events
        ↓
Update Shipment
        ↓
Frontend reads application DB
```

The polling interval must be chosen based on shipment volume, desired freshness, and Blue Dart API/rate-limit rules.

---

# 45. Retry and Rate-Limit Strategy

Retry only transient failures.

## Usually retryable

```text
Network failure
Timeout
Temporary 5xx
```

## Do not blindly retry

```text
Invalid credentials
Invalid request
Invalid AWB
Business-rule failure
```

For rate limiting:

```text
Respect Retry-After when provided
Use exponential backoff
Limit concurrency
Avoid duplicate requests
```

The precise limits must come from Blue Dart's account/API documentation.

---

# 46. Phase 25 — Database Compatibility Check

Inspect how `carrier_code` is stored.

## If VARCHAR/free-form

If no constraint prevents new codes, no carrier-specific migration may be necessary.

## If enum/check constraint

Add:

```text
BLUEDART
```

through an Alembic migration.

Do not create a Blue Dart-only table merely to store an AWB or current status.

---

# 47. Recommended Generic Shipment Model

Use generic fields:

```text
Shipment
--------
id
order_id
carrier_code
tracking_provider
awb_number
courier_shipment_id
reference_number

tracking_status
current_location

shipped_at
picked_up_at
delivered_at

created_at
updated_at
```

The existing shipment model may already contain most of this; add only missing fields required by the architecture.

---

# 48. Recommended Tracking Event Model

```text
ShipmentEvent
-------------
id
shipment_id
carrier_status_raw
normalized_status
location
remarks
event_time
raw_event_id
raw_response
created_at
```

Again, reuse the existing `ShipmentEvent` model where possible.

---

# 49. Common API Schemas

Create common application contracts so carrier-specific formats do not leak through ReconHub.

Examples:

```python
ServiceabilityRequest
ServiceabilityResponse

ShipmentCreateRequest
ShipmentCreateResponse

TrackingResponse
TrackingEvent

LabelResponse
PickupRequest
PickupResponse

RateRequest
RateResponse
```

Architecture:

```text
Frontend
    ↓
ReconHub schema
    ↓
BlueDartProvider
    ↓
Blue Dart request/response schema
```

This becomes the reusable foundation for Delhivery, DTDC, and future carriers.

---

# 50. Error Handling Requirements

Implement controlled errors for:

### Authentication

```text
Blue Dart authentication failed.
```

### Invalid AWB

```text
Blue Dart could not find the requested AWB.
```

### Serviceability

```text
Blue Dart does not support this origin/destination.
```

### Timeout

```text
Blue Dart tracking request timed out.
```

### Upstream failure

```text
Blue Dart service is temporarily unavailable.
```

### Malformed response

```text
Blue Dart returned an unexpected response.
```

Avoid exposing raw upstream responses directly to end users.

---

# 51. Logging Requirements

Use structured logs.

Success:

```text
carrier=BLUEDART
action=TRACK
shipment_id=123
awb=********789
result=SUCCESS
duration_ms=430
```

Failure:

```text
carrier=BLUEDART
action=TRACK
shipment_id=123
awb=********789
result=ERROR
error_type=TIMEOUT
```

Never log:

```text
API secret
password
authorization headers
decrypted credentials
full credential payload
```

---

# 52. Phase 26 — Unit Tests

Create:

```text
backend/tests/carriers/test_bluedart.py
```

Minimum tests:

```text
Provider registration
Capabilities
Credential validation
Serviceability mapping
Shipment request mapping
Tracking response parsing
Status normalization
Unknown status handling
Timeout handling
API error handling
Event deduplication
```

Use mocked API responses for ordinary unit tests.

Do not make the whole unit test suite depend on the live Blue Dart service.

---

# 53. Status Mapping Test Matrix

After obtaining the official Blue Dart status list, create a table like:

| Blue Dart raw status | ReconHub status |
|---|---|
| `<official value>` | `READY_TO_SHIP` |
| `<official value>` | `PICKED_UP` / `IN_TRANSIT` |
| `<official value>` | `OUT_FOR_DELIVERY` |
| `<official value>` | `DELIVERED` |
| `<official value>` | `FAILED_ATTEMPT` / `NDR` |
| `<official value>` | `RTO` |
| `<official value>` | `RETURNED` |
| `<official value>` | `LOST` |
| `<unknown>` | `EXCEPTION` |

Do not populate the left column from guesses; use the actual API response/documentation.

---

# 54. API Integration Tests

Test:

```http
POST /api/v1/carriers/BLUEDART/connect
```

with:

```text
Valid credentials
Invalid credentials
Missing required credentials
```

Test:

```http
GET /api/v1/carriers
```

and verify:

```text
BLUEDART
```

Test:

```http
GET /api/v1/carriers/health
```

and verify Blue Dart health data.

Test:

```http
GET /api/v1/shipments/{id}/tracking
```

for a Blue Dart shipment.

---

# 55. End-to-End Test

Use Blue Dart's supplied test environment/test data when available.

Acceptance flow:

```text
1. Connect Blue Dart
        ↓
2. Credentials validated
        ↓
3. CarrierConnection saved
        ↓
4. Create a shipment
        ↓
5. Blue Dart returns AWB
        ↓
6. AWB stored in Shipment
        ↓
7. Tracking request
        ↓
8. Blue Dart response received
        ↓
9. Status/events normalized
        ↓
10. ShipmentEvent persisted
        ↓
11. Shipment updated
        ↓
12. Frontend displays tracking
```

For production, run the same sequence with a controlled real shipment after business/API approval.

---

# 56. Security Requirements

Before production:

- Encrypt carrier credentials at rest.
- Use HTTPS.
- Never log secrets.
- Restrict connect/disconnect to authorized roles.
- Validate all request inputs.
- Sanitize upstream error messages.
- Set HTTP timeouts.
- Avoid user-controlled arbitrary URLs.
- Do not expose decrypted credentials through API responses.
- Scope credentials to the correct tenant/store/account.

---

# 57. Performance Requirements

For user-triggered tracking:

```text
Frontend
   ↓
ReconHub API
   ↓
Blue Dart API
   ↓
Normalized response
```

For bulk tracking:

```text
Scheduler
   ↓
Queue/background worker
   ↓
Controlled concurrency
   ↓
Blue Dart API
```

Do not let a page containing hundreds of shipments trigger hundreds of synchronous requests from one browser action.

---

# 58. Frontend Source of Truth

The current hard-coded carrier arrays should eventually disappear.

Preferred:

```text
Backend registry
      ↓
GET /api/v1/carriers
      ↓
Frontend carrier options
```

This means adding the next courier becomes primarily a backend/provider task rather than a search for multiple frontend constants.

---

# 59. ShipSagar Compatibility

Do not remove or replace ShipSagar because Blue Dart is being added.

Existing:

```text
ShipSagarProvider
```

continues to support its existing aggregator workflow.

If Blue Dart later becomes available through ShipSagar:

```text
carrier_code      = BLUEDART
tracking_provider = SHIPSAGAR
```

Direct integration:

```text
carrier_code      = BLUEDART
tracking_provider = BLUEDART
```

This is why provider identity and physical carrier identity should be separate.

---

# 60. Exact File Change Checklist

## New files

```text
backend/app/carriers/bluedart.py
backend/tests/carriers/test_bluedart.py
```

Potentially, if the project architecture supports it:

```text
backend/app/integrations/bluedart/client.py
backend/app/integrations/bluedart/schemas.py
backend/app/integrations/bluedart/mapper.py
backend/app/integrations/bluedart/exceptions.py
backend/app/integrations/bluedart/constants.py
```

## Modify

```text
backend/app/carriers/registry.py
backend/app/api/carriers.py
backend/app/api/shipments.py
backend/app/models/shipment.py
backend/app/models/courier_meta.py
backend/app/services/<shipment or tracking service>

frontend/src/.../CarriersSettings.tsx
frontend/src/.../AddShipmentDialog.tsx
frontend/src/.../Tracking.tsx
frontend/src/.../Shipments.tsx
frontend/src/.../ShipmentList.tsx
frontend/src/.../api.ts
```

Modify only the files that own the corresponding behavior.

---

# 61. What NOT to Do

## 1. Do not invent Blue Dart endpoints

Do not copy an old blog/GitHub request into production.

Use the official Blue Dart account-specific documentation.

## 2. Do not create carrier-specific AWB columns

Avoid:

```text
bluedart_awb
delhivery_awb
dtdc_awb
```

Use:

```text
carrier_code
awb_number
```

## 3. Do not mix Blue Dart HTTP calls with business logic

Avoid:

```text
OrderService
    ↓
Blue Dart HTTP request
```

Prefer:

```text
OrderService
    ↓
CarrierProvider
    ↓
BlueDartClient
```

## 4. Do not let the frontend call Blue Dart directly

Use:

```text
Frontend
   ↓
ReconHub API
   ↓
Blue Dart
```

## 5. Do not store credentials in plain text

Use the encrypted `CarrierConnection` path.

## 6. Do not rewrite India Post/ShipSagar unnecessarily

Blue Dart should be additive unless the architecture audit exposes a genuine shared issue.

---

# 62. Development Phases

## Phase A — Access and discovery

```text
[ ] Blue Dart business/integration access confirmed
[ ] Official ShippingAPI documentation received
[ ] Authentication mechanism confirmed
[ ] Test credentials/environment received
[ ] Rate limits confirmed
[ ] Error codes confirmed
[ ] Webhook/callback capability confirmed
```

## Phase B — Backend foundation

```text
[ ] Audit CarrierProvider
[ ] Audit registry
[ ] Audit credential handling
[ ] Audit tracking persistence
[ ] Confirm canonical tracking response
[ ] Confirm carrier-code DB constraints
```

## Phase C — Blue Dart connectivity

```text
[ ] Create BlueDartClient
[ ] Add configuration
[ ] Implement authentication
[ ] Implement timeout handling
[ ] Implement credential validation
```

## Phase D — Tracking vertical slice

```text
[ ] Create BlueDartProvider
[ ] Implement tracking
[ ] Parse raw response
[ ] Implement mapper
[ ] Implement status normalization
[ ] Persist events
[ ] Deduplicate events
[ ] Update Shipment
```

## Phase E — Shipment creation

```text
[ ] Serviceability
[ ] Transit time
[ ] Shipment creation
[ ] AWB extraction
[ ] Idempotency
[ ] Shipment persistence
```

## Phase F — Fulfillment

```text
[ ] Label generation
[ ] Pickup registration
[ ] Pickup cancellation
[ ] Shipment cancellation
```

## Phase G — Reverse logistics / finance

```text
[ ] RTO
[ ] Returns
[ ] Rate calculation
[ ] Courier cost storage
[ ] COD charges
[ ] Taxes
[ ] Settlement amount
[ ] Variance
```

## Phase H — Production hardening

```text
[ ] Health monitoring
[ ] Metrics
[ ] Retry/backoff
[ ] Rate limiting
[ ] Structured logs
[ ] Alerts
[ ] Full test suite
[ ] Production rollout
[ ] Rollback plan
```

---

# 63. Recommended Execution Order

Implement the work in this sequence:

```text
STEP 1
Obtain official Blue Dart ShippingAPI documentation
        ↓
STEP 2
Obtain test credentials/environment
        ↓
STEP 3
Audit CarrierProvider and existing shipment/tracking flow
        ↓
STEP 4
Confirm database carrier-code constraints
        ↓
STEP 5
Create BlueDartClient
        ↓
STEP 6
Implement authentication + credential validation
        ↓
STEP 7
Create BlueDartProvider
        ↓
STEP 8
Implement tracking
        ↓
STEP 9
Implement response/event normalization
        ↓
STEP 10
Persist ShipmentEvent
        ↓
STEP 11
Update Shipment current state
        ↓
STEP 12
Register BLUEDART provider
        ↓
STEP 13
Expose BLUEDART via /api/v1/carriers
        ↓
STEP 14
Implement connect/disconnect/health
        ↓
STEP 15
Update Carrier Settings frontend
        ↓
STEP 16
Update Add Shipment carrier selector
        ↓
STEP 17
Update Tracking UI
        ↓
STEP 18
Implement serviceability
        ↓
STEP 19
Implement shipment/AWB creation
        ↓
STEP 20
Implement label generation
        ↓
STEP 21
Implement pickup
        ↓
STEP 22
Implement cancellation / returns
        ↓
STEP 23
Implement rate/reconciliation features
        ↓
STEP 24
Run end-to-end tests
        ↓
STEP 25
Production rollout
```

---

# 64. Definition of Done — Phase 1

The first production-ready Blue Dart slice is complete when:

### Carrier registration

```http
GET /api/v1/carriers
```

returns `BLUEDART` with the capabilities actually implemented.

### Connection

An authorized administrator can connect valid Blue Dart credentials and the backend validates them before persistence.

### Shipment

A shipment supports:

```text
carrier_code = BLUEDART
awb_number   = <Blue Dart waybill>
```

### Tracking

A valid Blue Dart AWB can be tracked using the existing generic shipment-tracking endpoint.

### Normalization

Blue Dart raw statuses are converted to ReconHub canonical statuses.

### History

Tracking checkpoints are saved to `ShipmentEvent` without duplication.

### Current state

The shipment's current status/location/timestamps are updated correctly.

### Frontend

Users can:

```text
Connect Blue Dart
Select Blue Dart
Use/enter a Blue Dart AWB
Track shipment
View tracking history
```

### Failure handling

The following are handled without crashing the application:

```text
Invalid credentials
Invalid AWB
Timeout
Rate limit
5xx/upstream error
Malformed response
Unknown status
```

---

# 65. Final Architecture After Blue Dart Integration

```text
                         ┌──────────────────────┐
                         │       Frontend       │
                         │                      │
                         │ Carrier Settings     │
                         │ Add Shipment         │
                         │ Tracking             │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     ReconHub API     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Shipment Service   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Carrier Registry   │
                         └──────────┬───────────┘
                                    │
                           BLUEDART provider
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   BlueDartProvider   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    BlueDartClient    │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Blue Dart ShippingAPI│
                         └──────────┬───────────┘
                                    │
                                    ▼
                              Raw API response
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Mapper / Normalizer  │
                         └──────────┬───────────┘
                                    │
                         ┌──────────┴───────────┐
                         ▼                      ▼
                  ShipmentEvent              Shipment
                  history                    current state
```

---

# 66. Core Design Rule

> **All Blue Dart-specific HTTP, authentication, payload, status, and response parsing logic stays inside the Blue Dart integration layer. The rest of ReconHub works with generic courier, shipment, tracking, and reconciliation contracts.**

That is what allows the next integrations—Delhivery, improved DTDC, and future couriers—to use the same architecture rather than creating another custom system.

---

# 67. Source Basis

This implementation plan is based on the supplied Blue Dart project material. That material states that Blue Dart onboarding is through a Business Integration Application, that ShippingAPI provides major capabilities such as airway-bill operations and pickup/return functionality, and that exact endpoint/authentication details should be obtained from Blue Dart rather than guessed. It also distinguishes this onboarding model from Delhivery's token-generation flow.

## Official references mentioned in the supplied material

- Blue Dart Business Integration Application
- Blue Dart API / Business Portal
- Blue Dart ShippingAPI material

