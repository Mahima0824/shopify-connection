# DTDC Courier Integration — Detailed Implementation Plan

## Project
ReconHub

## Target Courier
DTDC

## Integration Type
Direct DTDC API integration

## Architectural Principle
Extend the existing `CarrierProvider → Registry → Service → API → Frontend` architecture. Do not create a separate DTDC workflow.

> **Important:** The supplied DTDC material confirms a Sandbox/Production credential model using Entity, Entity Pin, Developer, and Developer Pin, and confirms DTDC supports API integrations. It does not provide a verified current public catalog of every DTDC REST route, exact endpoint URL, or complete request/response schema. Therefore exact URLs, methods, headers, payloads, and field mappings must be populated from the official DTDC API specification provided for your account.

---

# 1. Goal

Add DTDC as a first-class courier so ReconHub can support:

```text
Shopify Order
      ↓
ReconHub
      ↓
DTDC Serviceability
      ↓
Shipment Booking
      ↓
AWB / Consignment Number
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

The first production milestone should be:

```text
DTDC Connection
    ↓
Credential Validation
    ↓
Serviceability
    ↓
Shipment Creation
    ↓
AWB Handling
    ↓
Tracking
    ↓
Status Normalization
    ↓
ShipmentEvent Persistence
    ↓
Shipment Current-State Update
```

Later phases add label, pickup, cancellation, NDR, RTO, returns, rates, COD, POD, and advanced reconciliation.

---

# 2. Scope

## Phase 1 — Core

- DTDC credential connection.
- Sandbox/Production configuration.
- Credential validation.
- Serviceability.
- Shipment creation/booking.
- AWB/consignment number.
- Tracking.
- Status normalization.
- Tracking event persistence.
- Shipment current-state update.
- Carrier health.
- Timeout/error handling.
- Unit/integration tests.
- Frontend carrier selection and tracking.

## Phase 2 — Operations

- Label generation.
- Pickup registration.
- Pickup cancellation.
- Shipment update.
- Shipment cancellation.
- NDR.
- RTO.
- Returns.

## Phase 3 — Commercial/Reconciliation

- Shipping rates.
- COD.
- COD remittance/settlement.
- POD.
- EDD/TAT.
- GST/e-way-bill functionality where applicable.
- Advanced courier reconciliation.

---

# 3. Target Architecture

```text
                         Frontend
                            │
                            ▼
                       ReconHub API
                            │
                            ▼
                     Shipment Service
                            │
                            ▼
                    Carrier Provider
                       Registry
                            │
                  get_provider("DTDC")
                            │
                            ▼
                       DtdcProvider
                            │
                            ▼
                        DtdcClient
                            │
                            ▼
                       DTDC API
                            │
                            ▼
                    Raw API Response
                            │
                            ▼
                    Mapper / Normalizer
                       │          │
                       ▼          ▼
                 ShipmentEvent   Shipment
```

Keep courier-specific API logic inside:

```text
DtdcClient
DtdcProvider
DTDC mapper
```

Do not spread DTDC conditions through order/shipment business services.

---

# 4. Existing Project Structure to Preserve

Your current architecture includes:

```text
backend/app/carriers/
    base.py
    registry.py
    india_post.py
    dtdc.py
    tirupati.py
    manual.py
    shipsagar.py
```

and:

```text
backend/app/models/
    shipment.py
    courier_meta.py
```

and:

```text
backend/app/services/
    shipsagar_service.py
```

and:

```text
backend/app/api/
    carriers.py
    shipments.py
    carrier_webhooks.py
```

Frontend includes:

```text
CarriersSettings.tsx
AddShipmentDialog.tsx
Tracking.tsx
Shipments.tsx
ShipmentList.tsx
api.ts
```

The supplied DTDC material also recommends a separate integration/client layer containing modules such as client, auth, shipment, tracking, label, pickup, and serviceability. Use that separation only where it matches your existing project structure.

---

# 5. Phase 0 — Audit Existing DTDC Code

You already have:

```text
backend/app/carriers/dtdc.py
```

Do **not** create another DTDC adapter until you inspect this file.

Determine whether the existing implementation is:

- Placeholder.
- Partial.
- Tracking-only.
- Old direct API implementation.
- Already functional.
- Built around obsolete credentials/endpoints.

Audit:

```text
backend/app/carriers/base.py
backend/app/carriers/registry.py
backend/app/carriers/dtdc.py
backend/app/carriers/india_post.py
backend/app/carriers/shipsagar.py

backend/app/models/shipment.py
backend/app/models/courier_meta.py

backend/app/api/carriers.py
backend/app/api/shipments.py
backend/app/api/carrier_webhooks.py

frontend/src/.../CarriersSettings.tsx
frontend/src/.../AddShipmentDialog.tsx
frontend/src/.../Tracking.tsx
frontend/src/.../Shipments.tsx
frontend/src/.../ShipmentList.tsx
frontend/src/.../api.ts
```

Answer these before implementation:

```text
How are providers instantiated?
How are credentials loaded?
How are credentials encrypted?
How is tracking persisted?
How is Shipment updated?
How is health recorded?
Is carrier_code a string, enum, or check constraint?
Are carrier lists hard-coded in frontend?
Is tracking synchronous, background, or both?
Can ShipSagar currently track DTDC?
```

---

# 6. Phase 1 — DTDC Credential Onboarding

The supplied DTDC material indicates separate Sandbox and Production credentials:

| Credential | Sandbox | Production | Purpose |
|---|---|---|---|
| Entity | Yes | Yes | DTDC entity/account identifier |
| Entity Pin | Yes | Yes | Entity authentication |
| Developer | Yes | Yes | API/developer identifier |
| Developer Pin | Yes | Yes | API/developer authentication |

Do not design authentication as a single:

```text
DTDC_API_KEY
```

unless DTDC's official documentation for your account explicitly uses one.

## Request from DTDC

Obtain:

```text
Official API documentation
Sandbox base URL
Production base URL
Sandbox credentials
Production credentials
Authentication specification
Serviceability API
Shipment creation API
AWB/consignment process
Tracking API
Label API
Pickup API
Cancellation API
Update API
NDR API
RTO/Return API
Rate API
COD/settlement API
POD API
EDD/TAT API
Webhook/callback documentation
API limits
Error codes
Test AWBs / test data
```

---

# 7. Phase 2 — Environment Configuration

Recommended base configuration:

```env
# DTDC
DTDC_ENABLED=true

# sandbox | production
DTDC_ENVIRONMENT=sandbox

# URLs supplied by DTDC
DTDC_SANDBOX_BASE_URL=
DTDC_PRODUCTION_BASE_URL=

# Sandbox
DTDC_SANDBOX_ENTITY=
DTDC_SANDBOX_ENTITY_PIN=
DTDC_SANDBOX_DEVELOPER=
DTDC_SANDBOX_DEVELOPER_PIN=

# Production
DTDC_PRODUCTION_ENTITY=
DTDC_PRODUCTION_ENTITY_PIN=
DTDC_PRODUCTION_DEVELOPER=
DTDC_PRODUCTION_DEVELOPER_PIN=

# Optional only if DTDC provides webhook signing
DTDC_WEBHOOK_SECRET=

# HTTP timeout
DTDC_TIMEOUT=30
```

Do not hard-code actual URLs from blogs or third-party examples.

Ensure:

```text
Sandbox credentials → Sandbox URL
Production credentials → Production URL
```

Never mix environments.

---

# 8. Phase 3 — Credential Storage

Use the existing:

```text
CarrierConnection
```

instead of creating a DTDC-specific credential table unless DTDC requires unusual account data.

Conceptual model:

```text
CarrierConnection
-----------------
id
carrier_code
credentials_encrypted
is_active
last_success_at
last_error_message
created_at
updated_at
```

For DTDC:

```text
carrier_code = DTDC
```

Credentials must be encrypted at rest.

Never return decrypted credentials from API responses.

---

# 9. Phase 4 — DtdcClient

Recommended location:

```text
backend/app/integrations/dtdc/client.py
```

If your existing project has no `integrations/` layer, keep the client logic separated inside `dtdc.py` initially.

The client owns:

```text
Authentication
Headers
Base URL
Request construction
HTTP method
Query/body
Timeout
HTTP errors
JSON parsing
Response validation
Retry behavior
Safe logging
```

Conceptual interface:

```python
class DtdcClient:

    def validate_credentials(self):
        ...

    def check_serviceability(self, request):
        ...

    def create_shipment(self, request):
        ...

    def track_shipment(self, awb):
        ...

    def generate_label(self, shipment):
        ...

    def create_pickup(self, request):
        ...

    def cancel_pickup(self, pickup_id):
        ...

    def update_shipment(self, request):
        ...

    def cancel_shipment(self, shipment):
        ...

    def create_return(self, request):
        ...
```

The exact DTDC API paths and payloads come from the official DTDC documentation.

---

# 10. Phase 5 — DtdcProvider

Create/refactor:

```text
backend/app/carriers/dtdc.py
```

Recommended methods:

```python
class DtdcProvider(CarrierProvider):

    def capabilities(self):
        ...

    def validate_credentials(self, credentials):
        ...

    def check_serviceability(self, request, credentials):
        ...

    def create_shipment(self, request, credentials):
        ...

    def generate_label(self, shipment, credentials):
        ...

    def create_pickup(self, request, credentials):
        ...

    def cancel_pickup(self, pickup_id, credentials):
        ...

    def update_shipment(self, request, credentials):
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

Do not force unrelated providers to implement meaningless methods. Use capabilities where necessary.

---

# 11. Phase 6 — Capabilities

Start conservatively.

Initial:

```text
TRACKING
SERVICEABILITY
SHIPMENT
```

Then add after working/tested:

```text
LABEL
PICKUP
CANCEL
UPDATE
NDR
RTO
RETURN
RATE
COD
POD
WEBHOOK
```

Capability means:

> ReconHub can actually perform the operation through its DTDC implementation.

---

# 12. Phase 7 — Credential Validation

Existing route:

```http
POST /api/v1/carriers/{code}/connect
```

DTDC:

```http
POST /api/v1/carriers/DTDC/connect
```

Flow:

```text
Admin
  ↓
Enter DTDC credentials
  ↓
Backend validation
  ↓
DtdcProvider.validate_credentials()
  ↓
DTDC auth/verification
  ↓
Success
  ↓
Encrypt credentials
  ↓
CarrierConnection
```

Failure:

```text
Reject
↓
Do not store invalid credentials
↓
Return safe error
```

Never log Entity Pin or Developer Pin.

---

# 13. Phase 8 — Pincode Serviceability

Implement:

```python
check_serviceability(request, credentials)
```

Common input:

```text
Origin pincode
Destination pincode
Weight
Shipment type
Payment mode
```

Flow:

```text
ReconHub request
      ↓
DtdcProvider
      ↓
DtdcClient
      ↓
DTDC serviceability API
      ↓
Raw response
      ↓
Normalized response
```

Internal response should be courier-agnostic:

```json
{
  "serviceable": true,
  "origin_pincode": "395003",
  "destination_pincode": "400001",
  "estimated_transit_days": 2
}
```

Only return fields supported by DTDC.

---

# 14. Phase 9 — Transit Time / EDD

If DTDC provides TAT/EDD, normalize it.

Possible application-level outputs:

```json
{
  "estimated_transit_days": 2
}
```

or:

```json
{
  "estimated_delivery_date": "2026-10-12"
}
```

Do not infer an exact delivery date if the API does not provide enough information.

---

# 15. Phase 10 — Shipment Creation

Business flow:

```text
Shopify Order
      ↓
ReconHub Order
      ↓
Validate shipment
      ↓
Check serviceability
      ↓
Create DTDC shipment
      ↓
Receive AWB / Consignment Number
      ↓
Persist shipment
```

Common request fields may include:

```text
Order/reference number
Sender details
Receiver details
Phone
Address
Destination pincode
Weight
Length
Breadth
Height
Payment mode
COD amount
Declared value
Invoice information
```

Send only the fields required by DTDC's official API.

---

# 16. Phase 11 — AWB / Consignment Number

Keep the existing generic field:

```text
awb_number
```

Use:

```text
carrier_code = DTDC
awb_number = <DTDC consignment number>
```

Do not create:

```text
dtdc_awb
```

if the existing shipment model already handles generic AWBs.

Optional:

```text
courier_shipment_id
reference_number
```

can store DTDC's external IDs.

---

# 17. Phase 12 — Shipment Creation Idempotency

Prevent duplicate DTDC bookings.

Problem:

```text
Click Create
   ↓
DTDC creates shipment
   ↓
Response times out
   ↓
User retries
   ↓
Second DTDC shipment created
```

Solution:

```text
Stable ReconHub reference
       ↓
Check existing shipment/AWB
       ↓
Only create if not already booked
```

Use DTDC's official idempotency mechanism if documented. Otherwise enforce idempotency in ReconHub.

---

# 18. Phase 13 — Tracking

Implement:

```python
get_tracking(awb, credentials)
```

Flow:

```text
Frontend
   ↓
GET /api/v1/shipments/{id}/tracking
   ↓
Shipment Service
   ↓
get_provider("DTDC")
   ↓
DtdcProvider.get_tracking()
   ↓
DtdcClient.track_shipment()
   ↓
DTDC
   ↓
Raw response
   ↓
Mapper
   ↓
ShipmentEvent
   ↓
Shipment update
```

Do not allow browser → DTDC direct API calls.

---

# 19. Phase 14 — Common Tracking Contract

Return a standardized structure.

Example:

```json
{
  "awb": "D123456789",
  "status": "IN_TRANSIT",
  "current_location": "Ahmedabad",
  "events": [
    {
      "status_raw": "Picked Up",
      "status": "PICKED_UP",
      "location": "Surat",
      "event_time": "2026-10-08T15:20:00"
    },
    {
      "status_raw": "In Transit",
      "status": "IN_TRANSIT",
      "location": "Ahmedabad",
      "event_time": "2026-10-09T04:20:00"
    }
  ]
}
```

Use your existing project's actual response schema where one already exists.

---

# 20. Phase 15 — Status Normalization

Your application owns the canonical statuses.

Existing shipment statuses in the project include:

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

You can add detailed lifecycle states if the product needs them:

```text
CREATED
AWB_ASSIGNED
PICKUP_SCHEDULED
PICKED_UP
IN_TRANSIT
OUT_FOR_DELIVERY
DELIVERED
```

Exceptions:

```text
FAILED_ATTEMPT
NDR
RTO
RETURNED
LOST
EXCEPTION
CANCELLED
```

Do not rename existing statuses casually because existing reports/UI/database logic may depend on them.

---

# 21. Phase 16 — DTDC Status Mapper

Create:

```text
backend/app/integrations/dtdc/mapper.py
```

or equivalent within the provider layer.

Example:

```python
DTDC_STATUS_MAP = {
    # Populate from actual DTDC API responses.
}
```

Mapping concept:

```text
DTDC raw status
      ↓
Normalize case/spacing
      ↓
Exact/keyword mapping
      ↓
ReconHub canonical status
```

Illustrative examples:

```text
BOOKED
    → READY_TO_SHIP

PICKED UP
    → PICKED_UP

IN TRANSIT
    → IN_TRANSIT

OUT FOR DELIVERY
    → OUT_FOR_DELIVERY

DELIVERED
    → DELIVERED

RTO
    → RTO
```

These are conceptual examples. Verify exact DTDC strings before adding production mappings.

---

# 22. Phase 17 — Unknown Status Handling

Never allow an unknown carrier status to crash tracking.

Use:

```text
Unknown raw status
        ↓
Store raw status
        ↓
Map safely to EXCEPTION
        ↓
Log unknown status
```

This means a future DTDC status can be handled without losing the tracking event.

---

# 23. Phase 18 — ShipmentEvent Persistence

Reuse the existing event model if possible.

Minimum:

```text
shipment_id
carrier_status_raw
normalized_status
location
event_time
```

Useful optional fields:

```text
remarks
raw_event_id
raw_response
created_at
```

Always preserve:

```text
raw carrier status
+
normalized ReconHub status
```

---

# 24. Phase 19 — Event Deduplication

Repeated tracking requests must not create duplicate events.

Preferred key:

```text
DTDC event ID
```

if provided.

Fallback composite:

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
Event received
   ↓
Already stored?
 ├── YES → skip
 └── NO  → insert
```

---

# 25. Phase 20 — Shipment Current-State Update

After tracking:

```text
Shipment.tracking_status
Shipment.current_location
Shipment.shipped_at
Shipment.delivered_at
```

must be updated according to the latest reliable event.

Example:

```text
DTDC = DELIVERED
      ↓
tracking_status = DELIVERED
delivered_at = event_time
```

Do not fabricate timestamps.

---

# 26. Phase 21 — Label Generation

After shipment booking works:

```python
generate_label(shipment, credentials)
```

Flow:

```text
Shipment
   ↓
DTDC Label API
   ↓
Response
   ↓
Normalize document
   ↓
Return/store label
```

The API may return a PDF, URL, binary document, or another format. Implement the actual format defined by DTDC.

---

# 27. Phase 22 — Pickup

Implement:

```python
create_pickup(request, credentials)
```

Flow:

```text
Booked shipment
      ↓
Pickup request
      ↓
DTDC API
      ↓
Pickup confirmation
      ↓
Persist pickup reference
```

Do not store pickup IDs in `awb_number`.

---

# 28. Phase 23 — Pickup Cancellation

Implement:

```python
cancel_pickup(pickup_id, credentials)
```

Validate the current pickup state first.

Do not allow cancellation after a state where DTDC no longer permits it.

---

# 29. Phase 24 — Shipment Update

If DTDC supports update APIs, expose a common:

```python
update_shipment(request, credentials)
```

Use only supported mutable fields.

Do not permit arbitrary changes after dispatch/delivery.

---

# 30. Phase 25 — Shipment Cancellation

Use:

```python
cancel_shipment(shipment, credentials)
```

Flow:

```text
Check local shipment state
       ↓
Can cancel?
 ├── YES → DTDC cancellation
 └── NO  → business-state error
```

Never allow cancellation of already delivered shipments.

---

# 31. Phase 26 — NDR

Treat NDR separately from generic failed delivery.

Potential flow:

```text
OUT_FOR_DELIVERY
       ↓
Delivery failure
       ↓
NDR
       ↓
Customer action / retry
       ↓
Delivered OR RTO
```

Do not immediately convert every delivery failure into RTO.

---

# 32. Phase 27 — RTO / Returns

Support:

```text
RTO_INITIATED
RTO_IN_TRANSIT
RTO_DELIVERED
RETURNED
```

Keep the original forward-shipment information.

If DTDC creates a new return/RTO consignment, store that separately instead of overwriting the original AWB unless the official workflow requires otherwise.

---

# 33. Phase 28 — Rates

If available, normalize DTDC rate information:

```json
{
  "base_charge": 0,
  "fuel_surcharge": 0,
  "cod_fee": 0,
  "tax": 0,
  "total": 0,
  "currency": "INR"
}
```

For reconciliation keep:

```text
estimated_shipping_cost
actual_shipping_cost
```

separate.

---

# 34. Phase 29 — COD / Settlement

For ReconHub, eventually store:

```text
cod_amount
cod_fee
shipping_fee
tax
other_charges
settlement_amount
settlement_date
```

Then calculate:

```text
actual courier charge
-
expected courier charge
=
variance
```

Keep financial logic separate from tracking logic.

---

# 35. Phase 30 — POD

If DTDC exposes Proof of Delivery:

```text
Delivered
   ↓
POD available
   ↓
Store POD reference/link
```

Prefer document/object-storage references rather than huge binaries inside the Shipment row.

---

# 36. Phase 31 — Webhooks

Only implement after verifying DTDC officially supports callbacks/webhooks for your account.

Flow:

```text
DTDC webhook
    ↓
ReconHub endpoint
    ↓
Authentication/signature verification
    ↓
Parse event
    ↓
Normalize
    ↓
Deduplicate
    ↓
ShipmentEvent
    ↓
Shipment update
```

Do not advertise `WEBHOOK` capability until verified and working.

---

# 37. Phase 32 — Registry

Update:

```text
backend/app/carriers/registry.py
```

Ensure:

```python
"DTDC": DtdcProvider(),
```

Example:

```python
PROVIDERS = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
    "SHIPSAGAR": ShipsagarProvider(),
    "DELHIVERY": DelhiveryProvider(),
    "BLUEDART": BlueDartProvider(),
}
```

Do not rewrite unrelated providers.

---

# 38. Phase 33 — Carrier API

Existing:

```http
GET /api/v1/carriers
```

should include:

```json
{
  "code": "DTDC",
  "name": "DTDC",
  "connected": false,
  "capabilities": [
    "TRACKING"
  ]
}
```

Expand capabilities as features become functional.

---

# 39. Phase 34 — Connect/Disconnect API

Connect:

```http
POST /api/v1/carriers/DTDC/connect
```

Disconnect:

```http
DELETE /api/v1/carriers/DTDC/disconnect
```

Disconnect should:

- Disable the connection.
- Stop future API operations.
- Preserve shipments.
- Preserve tracking history.
- Preserve reconciliation data.

---

# 40. Phase 35 — Carrier Health

Existing:

```http
GET /api/v1/carriers/health
```

should return DTDC health.

Example:

```json
{
  "code": "DTDC",
  "status": "HEALTHY",
  "last_success_at": "2026-10-08T20:30:00",
  "last_error_message": null
}
```

Useful categories:

```text
AUTHENTICATION_ERROR
INVALID_REQUEST
INVALID_AWB
SERVICEABILITY_ERROR
TIMEOUT
RATE_LIMITED
UPSTREAM_ERROR
RESPONSE_PARSE_ERROR
UNKNOWN_ERROR
```

---

# 41. Phase 36 — Frontend Carrier Settings

If the current UI has:

```typescript
const KNOWN = [
    "DTDC",
    "TIRUPATI",
    "INDIA_POST",
    "MANUAL"
];
```

do not keep expanding hard-coded arrays.

Prefer:

```text
GET /api/v1/carriers
      ↓
Frontend
```

Backend becomes the source of truth.

---

# 42. `CarriersSettings.tsx`

DTDC UI:

```text
DTDC
────────────────────
Status: Not Connected

Capabilities:
✓ Tracking

[Connect]
```

Connected:

```text
DTDC
────────────────────
Status: Connected

Last successful request: ...

[Disconnect]
```

Failed:

```text
DTDC
────────────────────
Status: Error

Authentication failed

[Reconnect]
```

Never show stored secrets.

---

# 43. DTDC Connection Form

Use the actual credential fields supplied by DTDC.

Expected based on the supplied material:

```text
Entity
Entity Pin
Developer
Developer Pin
```

After submit:

```text
Validate
   ↓
Success → encrypt + save
Failure → show error
```

Do not expose stored credential values after successful connection.

---

# 44. `AddShipmentDialog.tsx`

Carrier options should include:

```text
India Post
DTDC
Delhivery
Blue Dart
Manual
```

Prefer API-driven carrier lists.

Shipment remains generic:

```text
carrier_code = DTDC
awb_number = <DTDC consignment>
```

---

# 45. Tracking UI

Example:

```text
Carrier
[DTDC ▼]

AWB
[______________]

[Track]
```

Timeline:

```text
DTDC
AWB: D123456789

● Shipment Booked
│
● Picked Up
│
● In Transit
│
● Out for Delivery
│
● Delivered
```

The frontend should render normalized statuses, not parse DTDC raw text.

---

# 46. API Contract Layer

Create reusable application schemas:

```text
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

CancellationRequest
ReturnRequest
```

Architecture:

```text
Frontend
    ↓
ReconHub schema
    ↓
DtdcProvider
    ↓
DTDC schema
```

This becomes the foundation for Delhivery, Blue Dart, and future couriers.

---

# 47. Database Design

Reuse generic shipment fields:

```text
Shipment
---------------------
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

Event:

```text
ShipmentEvent
---------------------
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

Connection:

```text
CarrierConnection
---------------------
id
carrier_code
credentials_encrypted
is_active
last_success_at
last_error_message
created_at
updated_at
```

Do not create:

```text
dtdc_awb
dtdc_status
dtdc_tracking_url
```

when generic fields already exist.

---

# 48. Database Migration Check

Check whether:

```text
carrier_code
```

is:

```text
VARCHAR/string
```

or:

```text
ENUM/check constraint
```

If generic string:

```text
No carrier-specific migration may be required.
```

If enum/check constrained:

```text
Add DTDC through Alembic.
```

Only add `tracking_provider` if you need direct-vs-aggregator routing:

```text
carrier_code = DTDC
tracking_provider = DTDC
```

Future:

```text
carrier_code = DTDC
tracking_provider = SHIPSAGAR
```

---

# 49. Error Handling

Handle at least:

### Authentication

```text
DTDC authentication failed.
```

### Invalid AWB

```text
The DTDC consignment could not be found.
```

### Serviceability

```text
DTDC does not support the requested route.
```

### Timeout

```text
DTDC request timed out.
```

### Upstream error

```text
DTDC service is temporarily unavailable.
```

### Parsing error

```text
DTDC returned an unexpected response.
```

Never expose raw traceback or secret-bearing upstream responses.

---

# 50. HTTP Reliability

Use finite timeouts.

Recommended behavior:

```text
Connect timeout
Read timeout
Total request timeout
```

Retry only transient failures:

```text
Network failure
Timeout
Temporary 5xx
```

Do not immediately retry:

```text
Invalid credentials
Invalid AWB
Invalid request
Business validation error
```

For rate limiting:

```text
Respect Retry-After when available
Backoff
Limit concurrency
```

Follow the DTDC API agreement for actual rate limits.

---

# 51. Bulk Tracking Architecture

Do not let the browser call DTDC for every shipment.

Preferred:

```text
Scheduler / Worker
      ↓
Find active DTDC shipments
      ↓
Queue tracking
      ↓
Concurrency-limited DTDC calls
      ↓
Normalize
      ↓
Save events
      ↓
Update Shipment
```

Frontend reads ReconHub's database/API.

---

# 52. Logging

Use structured logs:

```text
carrier=DTDC
action=TRACK
shipment_id=123
awb=********789
result=SUCCESS
duration_ms=420
```

Failure:

```text
carrier=DTDC
action=TRACK
shipment_id=123
awb=********789
result=ERROR
error_type=TIMEOUT
```

Never log:

```text
Entity Pin
Developer Pin
passwords
API secrets
authorization headers
decrypted credentials
```

---

# 53. Testing Strategy

Create:

```text
backend/tests/carriers/test_dtdc.py
```

Test:

```text
Provider registration
Capabilities
Credential validation
Serviceability
Shipment creation
AWB parsing
Tracking
Status normalization
Unknown status
Event deduplication
Timeout
Rate limit
Malformed response
Authentication failure
```

Use mocked API responses for unit tests.

---

# 54. API Integration Tests

Verify:

```http
POST /api/v1/carriers/DTDC/connect
GET /api/v1/carriers
GET /api/v1/carriers/health
POST /api/v1/shipments
GET /api/v1/shipments/{id}/tracking
```

Test:

```text
Valid credentials
Invalid credentials
Missing credentials
Serviceable pincode
Non-serviceable pincode
Valid shipment
Invalid shipment
Valid AWB
Invalid AWB
Timeout
5xx
Malformed response
Unknown status
Repeated tracking
```

---

# 55. Sandbox End-to-End Test

Use DTDC's official sandbox/test environment.

Run:

```text
1. Configure sandbox
        ↓
2. Connect DTDC
        ↓
3. Validate credentials
        ↓
4. Check serviceability
        ↓
5. Create shipment
        ↓
6. Receive AWB
        ↓
7. Generate label
        ↓
8. Register pickup
        ↓
9. Track shipment
        ↓
10. Normalize events
        ↓
11. Save ShipmentEvent
        ↓
12. Update Shipment
```

Do not move to production until this flow is stable.

---

# 56. Production Checklist

Before enabling production:

```text
[ ] Production credentials received
[ ] Production URL verified
[ ] Authentication tested
[ ] Serviceability tested
[ ] Shipment creation tested
[ ] AWB stored correctly
[ ] Label tested
[ ] Pickup tested
[ ] Tracking tested
[ ] Cancellation behavior tested
[ ] Error responses verified
[ ] API limits understood
[ ] Retry strategy verified
[ ] Logs contain no credentials
[ ] DB records verified
[ ] Frontend flow verified
[ ] Production smoke test planned
```

---

# 57. Exact File Plan

## New files, if your project supports a client/integration layer

```text
backend/app/integrations/dtdc/client.py
backend/app/integrations/dtdc/schemas.py
backend/app/integrations/dtdc/mapper.py
backend/app/integrations/dtdc/exceptions.py
backend/app/integrations/dtdc/constants.py

backend/tests/carriers/test_dtdc.py
```

## Existing adapter

```text
backend/app/carriers/dtdc.py
```

Refactor this rather than creating a duplicate.

## Likely modified

```text
backend/app/carriers/base.py
backend/app/carriers/registry.py

backend/app/models/shipment.py
backend/app/models/courier_meta.py

backend/app/api/carriers.py
backend/app/api/shipments.py
backend/app/api/carrier_webhooks.py

backend/app/services/<shipment/tracking service>

frontend/src/.../CarriersSettings.tsx
frontend/src/.../AddShipmentDialog.tsx
frontend/src/.../Tracking.tsx
frontend/src/.../Shipments.tsx
frontend/src/.../ShipmentList.tsx
frontend/src/.../api.ts
```

---

# 58. Recommended Implementation Sequence

```text
STEP 1
Audit current dtdc.py
        ↓
STEP 2
Get official DTDC API specification
        ↓
STEP 3
Confirm Sandbox/Production credentials
        ↓
STEP 4
Confirm authentication mechanism
        ↓
STEP 5
Confirm endpoint catalog and schemas
        ↓
STEP 6
Create/refactor DtdcClient
        ↓
STEP 7
Implement credential validation
        ↓
STEP 8
Implement DtdcProvider
        ↓
STEP 9
Register DTDC
        ↓
STEP 10
Implement serviceability
        ↓
STEP 11
Implement shipment creation
        ↓
STEP 12
Implement AWB handling
        ↓
STEP 13
Implement tracking
        ↓
STEP 14
Implement response mapper
        ↓
STEP 15
Persist ShipmentEvent
        ↓
STEP 16
Update Shipment
        ↓
STEP 17
Implement label
        ↓
STEP 18
Implement pickup
        ↓
STEP 19
Implement update/cancel
        ↓
STEP 20
Implement NDR/RTO/returns
        ↓
STEP 21
Implement rates/COD/POD
        ↓
STEP 22
Update frontend
        ↓
STEP 23
Unit/integration tests
        ↓
STEP 24
Sandbox E2E
        ↓
STEP 25
Production rollout
```

---

# 59. Priority Matrix

| Priority | Feature | Stage |
|---|---|---|
| P0 | Credentials/Auth | First |
| P0 | Provider/Registry | First |
| P0 | Serviceability | First |
| P0 | Shipment Creation | First |
| P0 | AWB | First |
| P0 | Tracking | First |
| P0 | Status Mapping | First |
| P0 | Shipment Events | First |
| P0 | Shipment State | First |
| P1 | Label | Next |
| P1 | Pickup | Next |
| P1 | Cancellation | Next |
| P1 | Update | Next |
| P1 | NDR | Next |
| P1 | RTO/Returns | Next |
| P2 | Rates | Later |
| P2 | COD Settlement | Later |
| P2 | POD | Later |
| P2 | EDD/TAT | Later |
| P2 | GST/E-way Bill | Later |
| P2 | Webhooks | After official verification |

---

# 60. Acceptance Criteria

DTDC Phase 1 is complete when:

## Registration

```http
GET /api/v1/carriers
```

returns:

```text
DTDC
```

## Connection

Admin can connect valid DTDC credentials.

Invalid credentials are rejected.

## Serviceability

A DTDC destination can be checked through ReconHub.

## Shipment

A shipment supports:

```text
carrier_code = DTDC
awb_number = <DTDC consignment number>
```

## Tracking

A valid DTDC AWB can be tracked.

## Status

DTDC statuses are normalized into ReconHub's standard statuses.

## Events

Tracking events are stored once.

## Current State

The Shipment is updated to the latest reliable state.

## Frontend

Users can:

```text
Connect DTDC
Select DTDC
Create/assign shipment
View AWB
Track shipment
View tracking history
```

## Failure Handling

These must not crash the app:

```text
Invalid credentials
Invalid AWB
Timeout
5xx
Rate limit
Malformed response
Unknown status
```

---

# 61. Production Definition of Done

The integration is not complete merely because:

```text
dtdc.py exists
```

It is complete when this entire flow works:

```text
DTDC API
    ↓
DtdcClient
    ↓
DtdcProvider
    ↓
Provider Registry
    ↓
Shipment Service
    ↓
ShipmentEvent + Shipment
    ↓
ReconHub API
    ↓
Frontend
```

The critical rule is:

> **DTDC-specific API behavior belongs inside `DtdcClient` / `DtdcProvider` / DTDC mapper. The rest of ReconHub should operate on generic carrier, shipment, tracking, and reconciliation contracts.**

---

# 62. Final Engineering Rule

Do not guess DTDC endpoint URLs or payloads from third-party examples.

Once DTDC provides the official API document, convert each endpoint into this mapping:

```text
Official DTDC endpoint
        ↓
DtdcClient method
        ↓
DtdcProvider method
        ↓
ReconHub service method
        ↓
Database mapping
        ↓
ReconHub API route
        ↓
Frontend action
        ↓
Automated test
```

This keeps DTDC isolated and makes the next courier integrations—Delhivery and Blue Dart—much easier.
