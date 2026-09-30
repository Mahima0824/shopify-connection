# Courier Integration Implementation Plan — India Post + DTDC

## Project Context

This plan extends the existing **Shopify Connection / Order Reconciliation Platform**.

Current stack:

- Backend: FastAPI + SQLAlchemy 2.0 + Alembic
- Database: Supabase PostgreSQL with SQLite fallback
- Frontend: Next.js 14 App Router + TypeScript
- Authentication: JWT Bearer, roles `ADMIN`, `WAREHOUSE`, `ACCOUNTANT`, `VIEWER`
- Existing shipment/AWB module
- Existing append-only event/timeline architecture
- Existing barcode generation/scanning and dispatch/return/RTO workflows
- Existing exceptions queue and audit trail
- Existing reconciliation, statements, COD/settlement concepts, and Tally export
- Local development: backend `:8000`, frontend `:3000`
- Shopify webhook tunnel currently handled through ngrok

### Scope decision

This implementation supports **only two courier providers**:

1. India Post
2. DTDC

Do **not** add Shiprocket, Tirupati, Delhivery, or another intermediary/provider in this implementation.

---

# 1. Objective

Add a direct-courier layer that allows the platform to:

1. Select India Post or DTDC for a parcel.
2. Create/book a courier shipment after the internal parcel is ready.
3. Capture the courier's AWB/consignment number.
4. Associate the AWB with the internal parcel barcode and Shopify order.
5. Capture courier tracking events.
6. Receive courier webhook/callback events where the carrier contract supports them.
7. Use tracking-API polling as a fallback/reconciliation mechanism.
8. Normalize provider-specific statuses into the platform's common shipment lifecycle.
9. Detect NDR, delivery, RTO, delay, lost/damaged, and related states.
10. Detect a parcel that appears to be stuck at a hub/warehouse based on the last event and SLA.
11. Create exceptions and notifications automatically.
12. Show the full shipment timeline in the dashboard.
13. Preserve every tracking event as an immutable event record.
14. Keep courier delivery state separate from financial settlement state.
15. Connect delivered/RTO shipment outcomes to the existing reconciliation and Tally workflows.

---

# 2. Important Design Rule

## Internal barcode and courier AWB are different identifiers

Never use the courier AWB as the internal parcel identifier.

Example:

```text
Shopify Order:       #10542
Internal Parcel:     PCL-00018492
Internal Barcode:    PCL00018492
Courier:             DTDC
Courier AWB:         D123456789
```

Another shipment may be:

```text
Shopify Order:       #10543
Internal Parcel:     PCL-00018493
Internal Barcode:    PCL00018493
Courier:             India Post
Consignment No:      EX123456789IN
```

Relationship:

```text
Shopify Order
    |
    v
Internal Parcel
    |
    +---- Internal Barcode
    |
    v
Shipment
    |
    +---- Courier = INDIA_POST / DTDC
    |
    +---- AWB / Consignment Number
    |
    v
Tracking Events
```

The warehouse worker uses the **internal barcode**. The courier uses the **AWB/consignment number**.

---

# 3. Target End-to-End Workflow

```text
Shopify Order
      |
      v
Order imported / synchronized
      |
      v
Internal Parcel Created
      |
      v
Internal Barcode Generated
      |
      v
Parcel Packed / Ready
      |
      v
Worker scans internal barcode
      |
      v
Dispatch screen
      |
      v
Select India Post or DTDC
      |
      v
Create courier shipment
      |
      v
Courier returns AWB / Consignment No.
      |
      v
Save courier shipment mapping
      |
      v
Print courier label / attach AWB
      |
      v
Pickup / physical handover
      |
      v
Tracking begins
      |
      +-----------------------------+
      |                             |
      v                             v
Courier Webhook                 Tracking Poller
      |                             |
      +-------------+---------------+
                    |
                    v
          Courier Event Processor
                    |
          +---------+---------+
          |         |         |
          v         v         v
       Normalize  Deduplicate  Raw payload store
          |
          v
      Tracking Event
          |
          v
      Shipment State
          |
    +-----+---------+----------------+
    |               |                |
    v               v                v
 Delivered         NDR           Hub/warehouse delay
    |               |                |
    v               v                v
Financial         Reattempt       Exception case
reconciliation       |              |
                     v              |
                    RTO <-----------+
                     |
                     v
             Return reconciliation
```

---

# 4. Carrier Capability Model

Because India Post and DTDC will not necessarily expose identical APIs, the application must treat courier integrations as provider adapters.

The application should support these logical capabilities:

```text
CREATE_SHIPMENT
ASSIGN_AWB
GET_LABEL
REQUEST_PICKUP
TRACK_SHIPMENT
CANCEL_SHIPMENT
CREATE_RETURN
GET_NDR
GET_SETTLEMENT_DATA
REGISTER_WEBHOOK / CALLBACK
```

A carrier may support all, some, or differently named versions of these capabilities.

The adapter must report unsupported capabilities instead of silently failing.

Example:

```python
class CourierCapability(str, Enum):
    CREATE_SHIPMENT = "create_shipment"
    ASSIGN_AWB = "assign_awb"
    GET_LABEL = "get_label"
    REQUEST_PICKUP = "request_pickup"
    TRACK = "track"
    CANCEL = "cancel"
    CREATE_RETURN = "create_return"
    NDR = "ndr"
    SETTLEMENT = "settlement"
```

---

# 5. Provider Credential Strategy

## Never hard-code courier credentials

All provider credentials must stay server-side.

Do not expose them to the Next.js browser bundle.

Use encrypted storage or deployment secrets.

Recommended environment structure:

```env
# Common
COURIER_HTTP_TIMEOUT_SECONDS=20
COURIER_MAX_RETRIES=3
COURIER_WEBHOOK_MAX_SKEW_SECONDS=300
COURIER_EVENT_REPLAY_WINDOW_HOURS=72

# India Post
INDIA_POST_ENABLED=true
INDIA_POST_API_BASE_URL=...
INDIA_POST_CUSTOMER_ID=...
INDIA_POST_CONTRACT_ID=...
INDIA_POST_CLIENT_ID=...
INDIA_POST_CLIENT_SECRET=...
INDIA_POST_API_KEY=...
INDIA_POST_API_SECRET=...
INDIA_POST_WEBHOOK_SECRET=...

# DTDC
DTDC_ENABLED=true
DTDC_API_BASE_URL=...
DTDC_CLIENT_ID=...
DTDC_CLIENT_SECRET=...
DTDC_API_KEY=...
DTDC_ACCOUNT_CODE=...
DTDC_CUSTOMER_CODE=...
DTDC_WEBHOOK_SECRET=...
```

### Important

The names above are **application-level placeholders**, not a claim that every carrier will issue every field.

Do not build code around guessed credential names.

The actual production credential set must be taken from the official integration package/account onboarding provided by the carrier.

---

# 6. India Post Integration

India Post provides end-to-end tracking for parcels and documents and has documented API integration for bulk/contractual customers. Official India Post material also describes real-time tracking and API integration for parcel services. The current India Post Track & Trace service accepts consignment numbers, while business/bulk services include API integration options.

Official references:

- India Post Parcel Sales Manual: https://www.indiapost.gov.in/VAS/Pages/Tenders/Parcel_Sales_Manual_27.09.2021.pdf
- India Post Track & Trace: https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx
- India Post current parcel information: https://www.indiapost.gov.in/mailproducts/domesticservices/indiapostparcel
- India Post business/technology material: https://www.indiapost.gov.in/

## India Post onboarding checklist

Request an official business/API integration package containing, where applicable:

```text
1. Customer/bulk customer ID
2. Contract ID
3. API authentication credentials
4. API base URL(s)
5. Sandbox/test endpoint, if available
6. Shipment booking API specification
7. Consignment number generation procedure
8. Pickup API / pickup process
9. Label specification
10. Manifest specification
11. Tracking API specification
12. Webhook/callback specification, if supported for the account
13. Delivery-status event specification
14. NDR / delivery exception specification
15. Return/RTO specification
16. COD/remittance data interface
17. Rate/service catalog
18. Pincode/serviceability endpoint or file, if available
19. Rate limits
20. Error codes
21. Support/contact for integration failures
```

### India Post-specific implementation rule

Do not scrape the public Track & Trace webpage or automate CAPTCHA/protected web forms as a substitute for an authorized business API.

Use the official business/API interface supplied for your account.

---

# 7. DTDC Integration

DTDC currently advertises API-based integration with ERP, WMS, and e-commerce platforms, along with real-time shipment visibility, e-commerce/COD capabilities, and tracking through consignment/AWB numbers.

Official references:

- DTDC B2B Enterprise: https://www.dtdc.com/b2b-enterprise/
- DTDC features: https://www.dtdc.com/feature/
- DTDC Express Parcel: https://www.dtdc.com/express-parcel/
- DTDC official website: https://www.dtdc.com/

## DTDC onboarding checklist

Request the official integration package for your business account:

```text
1. Client/account identifier
2. API key/token if applicable
3. Client secret if applicable
4. Customer/account code if applicable
5. API base URL(s)
6. Sandbox credentials, if available
7. Shipment booking API
8. AWB/consignment allocation API
9. Pickup request API
10. Label API/file specification
11. Manifest API/file specification
12. Tracking API
13. Webhook/callback configuration, if supported
14. NDR API/data
15. RTO/return API/data
16. COD/remittance data
17. Service/rate information
18. Pincode/serviceability
19. Rate limits
20. Error/status-code documentation
21. Integration support contact
```

### Do not copy credentials or endpoints from random third-party tutorials

A third-party blog may show a field named `client_number`, `api_key`, or `secret`, but your actual DTDC business integration may use different credentials or endpoint versions.

Treat the official DTDC integration documentation for your account as authoritative.

---

# 8. Backend Directory Structure

Extend the existing FastAPI project as follows:

```text
backend/
├── api/
│   └── v1/
│       └── routers/
│           ├── shipments.py
│           ├── tracking.py
│           ├── courier.py
│           └── webhooks.py
│
├── integrations/
│   └── couriers/
│       ├── __init__.py
│       ├── base.py
│       ├── errors.py
│       ├── models.py
│       ├── registry.py
│       ├── india_post.py
│       └── dtdc.py
│
├── services/
│   ├── shipment_service.py
│   ├── courier_booking_service.py
│   ├── tracking_service.py
│   ├── courier_event_service.py
│   ├── warehouse_delay_service.py
│   ├── ndr_service.py
│   ├── rto_service.py
│   └── courier_reconciliation_service.py
│
├── workers/
│   ├── tracking_poll_worker.py
│   └── warehouse_sla_worker.py
│
├── models/
│   ├── shipment.py
│   ├── tracking_event.py
│   ├── courier_account.py
│   ├── courier_status_mapping.py
│   └── shipment_exception.py
│
└── schemas/
    ├── courier.py
    ├── shipment.py
    └── tracking.py
```

Use the naming conventions already present in the repository where they differ.

---

# 9. Courier Adapter Interface

Create a stable internal interface.

```python
from abc import ABC, abstractmethod

class CourierProvider(ABC):
    provider_name: str

    @abstractmethod
    async def create_shipment(self, request):
        ...

    @abstractmethod
    async def track_shipment(self, awb: str):
        ...

    async def get_label(self, shipment):
        raise NotImplementedError

    async def request_pickup(self, shipment):
        raise NotImplementedError

    async def cancel_shipment(self, awb: str):
        raise NotImplementedError

    async def create_return(self, shipment):
        raise NotImplementedError

    async def get_ndr(self, awb: str):
        raise NotImplementedError
```

Implement:

```text
IndiaPostProvider
DTDCCourierProvider
```

The provider classes must contain **API translation only**.

Business rules belong in services, not in provider classes.

---

# 10. Internal Courier Request/Response Models

Never allow provider-specific JSON to leak throughout your codebase.

Create normalized models.

## Create shipment request

```python
class CreateShipmentRequest:
    parcel_id: UUID
    order_id: UUID
    recipient_name: str
    mobile: str
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    pincode: str
    weight_grams: int
    payment_mode: str
    cod_amount: Decimal | None
    declared_value: Decimal | None
    pickup_address_id: UUID
```

## Create shipment response

```python
class CreateShipmentResult:
    provider: str
    provider_shipment_id: str | None
    awb_number: str
    label_reference: str | None
    raw_response: dict
```

## Tracking event

```python
class NormalizedTrackingEvent:
    provider: str
    awb_number: str
    provider_event_id: str | None
    raw_status: str
    normalized_status: str
    event_code: str | None
    description: str | None
    location: str | None
    event_time: datetime
    raw_payload: dict
```

---

# 11. Database Migration Plan

The existing project is at migration head `0011` according to the project overview.

Create new migration(s), starting from approximately `0012`, using the repository's actual Alembic naming convention.

Do not rewrite old migrations.

## 11.1 Extend `shipments`

Add fields similar to:

```text
courier_provider
courier_service
provider_shipment_id
awb_number
current_status
current_location
last_tracking_event_at
expected_delivery_at
picked_up_at
delivered_at
rto_at
warehouse_delay_state
warehouse_delay_since
last_provider_sync_at
provider_last_seen_status
provider_last_seen_location
```

Use nullable fields where the existing lifecycle allows shipments to exist before courier booking.

Add indexes:

```text
shipments.awb_number
shipments.courier_provider
shipments.current_status
shipments.last_tracking_event_at
shipments.warehouse_delay_state
```

Unique constraint recommendation:

```text
(courier_provider, awb_number)
```

provided the carrier contract guarantees AWBs are unique within the provider.

---

# 12. `tracking_events` Table

Create an append-only event table.

Suggested schema:

```text
id UUID / BIGINT
shipment_id FK
courier_provider
provider_event_id
awb_number
raw_status
normalized_status
event_code
description
location
facility_code
city
state
event_time
raw_payload JSONB
received_at
created_at
```

Indexes:

```text
shipment_id + event_time
awb_number + event_time
courier_provider + provider_event_id
normalized_status
location
```

## Duplicate prevention

If provider event IDs exist:

```text
UNIQUE(courier_provider, provider_event_id)
```

If provider event IDs do not exist, calculate a deterministic event fingerprint from stable fields, for example:

```text
provider + awb + event_time + raw_status + location + event_code
```

Hash the canonical representation and use the hash for idempotency.

---

# 13. `courier_accounts` Table

Use this if courier configuration is tenant/business-specific.

```text
id
tenant_id
provider
display_name
encrypted_credentials
is_active
sandbox_mode
base_url
timezone
created_at
updated_at
```

Do not put secrets into `shipments`.

Do not return `encrypted_credentials` through API responses.

---

# 14. `courier_status_mappings` Table

Create a provider-specific mapping layer.

```text
id
provider
provider_status_code
provider_status_name
normalized_status
is_terminal
is_delivered
is_ndr
is_rto
is_hub_event
is_customer_action_required
created_at
updated_at
```

Example normalized states:

```text
CREATED
AWB_ASSIGNED
PICKUP_SCHEDULED
PICKED_UP
IN_TRANSIT
REACHED_HUB
OUT_FOR_DELIVERY
DELIVERY_ATTEMPTED
DELIVERED
NDR
NDR_REATTEMPT
RTO_INITIATED
RTO_IN_TRANSIT
RTO_DELIVERED
DELAYED
LOST
DAMAGED
CANCELLED
UNKNOWN
```

Do not assume India Post and DTDC use identical status codes/names.

The adapters should convert their provider data into this internal vocabulary.

---

# 15. `shipment_exceptions` Integration

Reuse the existing exceptions queue.

Do not create a second exception system.

Add exception types such as:

```text
WAREHOUSE_DELAY
SHIPMENT_DELAY
NDR
DELIVERED_DISPUTED
RTO_INITIATED
RTO_PENDING
LOST
DAMAGED
TRACKING_STALE
COURIER_API_ERROR
WEBHOOK_FAILURE
AWB_MISMATCH
```

Every exception should retain:

```text
shipment_id
order_id
parcel_id
awb
courier
exception_type
severity
reason
detected_at
resolved_at
resolved_by
resolution_note
source_event_id
```

---

# 16. Shipment State Machine

Do not allow arbitrary status changes from the frontend.

The backend owns lifecycle transitions.

Recommended flow:

```text
PARCEL_READY
    ↓
BOOKING_PENDING
    ↓
AWB_ASSIGNED
    ↓
PICKUP_SCHEDULED
    ↓
PICKED_UP
    ↓
IN_TRANSIT
    ↓
REACHED_HUB
    ↓
OUT_FOR_DELIVERY
    ↓
DELIVERED
```

Alternative exception paths:

```text
OUT_FOR_DELIVERY
    ↓
DELIVERY_ATTEMPTED
    ↓
NDR
    ↓
NDR_REATTEMPT
    ↓
OUT_FOR_DELIVERY
```

or:

```text
NDR
   ↓
RTO_INITIATED
   ↓
RTO_IN_TRANSIT
   ↓
RTO_DELIVERED
```

Delay is generally better represented as an **exception/condition layered on top of the transport state**, rather than replacing the underlying transport state.

Example:

```text
current_status = REACHED_HUB
exception = WAREHOUSE_DELAY
```

rather than:

```text
current_status = WAREHOUSE_DELAY
```

This preserves the actual courier state.

---

# 17. Dispatch UI Workflow

## Step 1 — Scan internal parcel

Existing worker flow:

```text
Scan barcode
    ↓
PCL00018492
    ↓
Load parcel/order details
```

Show:

```text
Order
Customer
Mobile
Full address
Pincode
Items
Quantity
Weight
Payment mode
COD amount
Parcel status
```

## Step 2 — Select courier

```text
Courier
[ India Post ▼ ]
```

or:

```text
[ DTDC ▼ ]
```

## Step 3 — Select available service

Populate only services available for the selected provider/configuration.

Do not hard-code a generic service list if the carrier account provides an authoritative service list.

## Step 4 — Create shipment

Button:

```text
[ Create Shipment ]
```

## Step 5 — Display success

```text
Shipment Created ✓

Courier:
DTDC

AWB:
D123456789

Parcel:
PCL00018492

[ Print Label ]
[ View Tracking ]
```

---

# 18. Booking API Flow

```text
POST /api/v1/shipments/{parcel_id}/book
```

Request:

```json
{
  "courier": "DTDC",
  "service": "..."
}
```

Backend:

```text
1. Authenticate user
2. Check role = WAREHOUSE or ADMIN
3. Find parcel
4. Verify parcel is dispatchable
5. Verify no active courier shipment already exists
6. Validate customer address/mobile/pincode
7. Validate weight/dimensions
8. Validate payment/COD information
9. Load courier configuration
10. Call provider adapter
11. Validate provider response
12. Save shipment
13. Save AWB
14. Save raw provider response
15. Append BOOKED/AWB_ASSIGNED event
16. Generate/attach label if supported
17. Return normalized response
```

Use an idempotency key:

```http
Idempotency-Key: <UUID>
```

The same request must not create two courier shipments because of double-clicks or network retries.

---

# 19. Booking Failure Handling

Possible situations:

```text
Provider timeout
Invalid address
Pincode not serviceable
Invalid authentication
Insufficient courier account balance/credit
Duplicate shipment
Invalid service
Invalid COD amount
Weight mismatch
Provider 4xx/5xx
```

Store structured failure data:

```text
provider
http_status
provider_error_code
provider_error_message
request_id
occurred_at
```

Return a useful frontend message without leaking secrets.

Example:

```text
Shipment could not be created.

Courier: DTDC
Reason: Pincode/service validation failed.

[Edit Address]
[Retry]
```

---

# 20. Tracking Architecture

Use **webhooks/callbacks where the carrier contract supports them** and a polling reconciler as a fallback.

```text
                 +----------------+
                 | India Post API |
                 +-------+--------+
                         |
                         | tracking response / callback
                         v
+----------------+   +-----------+   +----------------+
| DTDC tracking  |-->| Tracking  |<--| India Post     |
| API / webhook  |   | Ingestion |   | webhook/callback|
+----------------+   +-----+-----+   +----------------+
                           |
                           v
                    Normalize event
                           |
                           v
                    Deduplicate event
                           |
                           v
                    Store raw event
                           |
                           v
                   Append tracking event
                           |
                           v
                    Update shipment
                           |
                           v
                    Run SLA rules
```

---

# 21. Webhook Endpoint

Use one provider-aware endpoint:

```http
POST /api/v1/webhooks/couriers/{provider}
```

Examples:

```text
/api/v1/webhooks/couriers/india_post
/api/v1/webhooks/couriers/dtdc
```

The actual carrier callback URLs should match the carrier's integration specification.

## Processing pipeline

```text
HTTP request
    ↓
Authenticate webhook
    ↓
Validate timestamp/signature/token where applicable
    ↓
Parse JSON/XML/form payload according to provider contract
    ↓
Find AWB
    ↓
Resolve shipment
    ↓
Build normalized event
    ↓
Check idempotency
    ↓
Store raw payload
    ↓
Append tracking event
    ↓
Update current state
    ↓
Run exception/SLA rules
    ↓
Return 200 quickly
```

The webhook handler should do minimal work synchronously.

For expensive processing:

```text
Webhook
  ↓
Persist inbound event
  ↓
Queue/background processing
  ↓
Return 200
```

Your project already uses FastAPI `BackgroundTasks`; reuse the project's existing async/background pattern or introduce a durable queue later if scale demands it.

---

# 22. Webhook Security

For each provider, implement exactly the authentication mechanism documented in that provider's contract.

Possible methods include:

```text
HMAC signature
API key
Bearer token
Shared secret
Timestamp + signature
IP allowlist
```

Do not invent an HMAC scheme if the provider does not send a signature.

For every webhook:

```text
1. Reject unauthenticated requests
2. Validate timestamp/replay window if applicable
3. Validate body/signature before parsing sensitive information
4. Generate event fingerprint
5. Reject duplicate processing
6. Persist raw event
7. Audit provider and outcome
```

Never log:

```text
API secret
client secret
authorization header
encrypted credential material
full customer payment secrets
```

---

# 23. Polling/Reconciliation Worker

Webhooks cannot be the only source of truth.

Create a scheduled tracking reconciler.

Suggested initial strategy:

```text
Every 6 hours:
  Track active shipments that are not terminal.

Every 12 hours:
  Track shipments with stale events.

Daily:
  Reconcile all recently active shipments.
```

Avoid polling thousands/millions of shipments every minute.

Use batches:

```text
SELECT active shipments
WHERE current_status NOT IN terminal_states
ORDER BY last_tracking_event_at ASC
LIMIT 100 / 500 / configurable
```

Use provider-specific rate limits and backoff.

---

# 24. Tracking Poller Algorithm

```python
for shipment in eligible_shipments:
    try:
        response = provider.track_shipment(shipment.awb_number)
        events = normalize_tracking_response(response)
        persist_new_events(events)
        update_current_state(shipment)
    except ProviderRateLimitError:
        schedule_with_backoff(shipment)
    except ProviderTimeoutError:
        record_sync_failure(shipment)
    except ProviderAuthenticationError:
        create_provider_configuration_alert()
```

Do not mark a shipment as failed merely because one tracking request timed out.

---

# 25. Tracking Event Normalization

Example provider event:

```text
Provider:
DTDC

Raw status:
<provider-specific value>

Location:
Ahmedabad Hub
```

Normalize to:

```text
provider = DTDC
raw_status = <original value>
normalized_status = REACHED_HUB
location = Ahmedabad Hub
```

Another provider may report a different string for the same logical state.

The UI should always use `normalized_status` for consistent display.

The raw value must still be retained for audit/debugging.

---

# 26. Current State vs Event History

These are two different things.

## Event history

Immutable:

```text
Sep 27 08:30 — Picked Up
Sep 27 18:10 — Surat Hub
Sep 28 10:20 — Ahmedabad Hub
Sep 29 09:00 — Reached Destination Hub
```

## Current state

Mutable projection:

```text
current_status = REACHED_HUB
current_location = Ahmedabad
last_tracking_event_at = Sep 29 09:00
```

If a new event arrives:

```text
current_status = OUT_FOR_DELIVERY
```

but the old event remains in `tracking_events`.

This matches your existing append-only event architecture.

---

# 27. Warehouse/Hub Delay Detection

This is the feature specifically required by the project.

## Important definition

A parcel being physically at a courier hub is **not automatically a problem**.

A hub scan can be a normal part of transit.

The application should flag a warehouse/hub delay only when the combination of:

```text
last known hub/facility state
+
time since last meaningful event
+
shipment SLA
+
current status
+
carrier/service configuration
```

crosses the configured threshold.

---

# 28. Delay Detection Example

Suppose:

```text
29 Sep 09:00
REACHED_HUB
Location: Ahmedabad
```

and no event arrives until:

```text
30 Sep 10:00
```

Elapsed:

```text
25 hours
```

If the configured threshold is:

```text
REACHED_HUB = 24 hours
```

create:

```text
Exception type:
WAREHOUSE_DELAY

Shipment:
D123456789

Last location:
Ahmedabad Hub

Last event:
29 Sep 09:00

Age:
25 hours
```

Do not call this a confirmed physical fact such as "parcel is definitely inside the warehouse" unless the carrier explicitly reports that condition. Use wording such as:

> Shipment appears stalled at Ahmedabad Hub based on the latest tracking event and the configured SLA.

---

# 29. SLA Configuration

Create configurable SLA rules.

Example:

```text
courier = DTDC
service = <service>
status = REACHED_HUB
threshold_hours = 24
```

Another:

```text
courier = INDIA_POST
service = <service>
status = IN_TRANSIT
threshold_hours = 48
```

Fields:

```text
courier_provider
service
from_zone / route (optional later)
status
threshold_hours
severity
active
```

Start simple with provider + service + status.

Add route-specific intelligence only after real operational data exists.

---

# 30. Warehouse Delay Worker

Run periodically.

Pseudo-code:

```python
active_shipments = get_active_shipments_for_sla_check()

for shipment in active_shipments:
    if shipment.current_status not in SLA_MONITORED_STATUSES:
        continue

    if not shipment.last_tracking_event_at:
        continue

    elapsed = now - shipment.last_tracking_event_at
    threshold = get_sla_threshold(shipment)

    if elapsed >= threshold:
        ensure_exception(
            type="WAREHOUSE_DELAY",
            shipment_id=shipment.id,
        )
```

Make `ensure_exception()` idempotent so the worker does not create 100 duplicate exceptions for the same shipment.

---

# 31. Escalation Levels

Use three levels initially:

```text
WATCH
```

Shipment is approaching SLA.

```text
DELAYED
```

SLA breached.

```text
CRITICAL
```

SLA breach is significantly extended or a courier status explicitly indicates a serious problem.

Example:

```text
0–18 hours: Normal
18–24 hours: Watch
24–48 hours: Delayed
>48 hours: Critical
```

These example times are placeholders. Configure actual values after observing each courier/service.

---

# 32. Notification System

Reuse the existing exceptions queue and dashboard notification pattern.

Notification types:

```text
SHIPMENT_BOOKED
AWB_ASSIGNED
PICKED_UP
SHIPMENT_DELAYED
WAREHOUSE_DELAY
NDR_CREATED
OUT_FOR_DELIVERY
DELIVERED
RTO_INITIATED
RTO_DELIVERED
TRACKING_STALE
COURIER_INTEGRATION_ERROR
```

Example notification:

```text
⚠ Shipment appears stalled

Order: #10542
Parcel: PCL00018492
Courier: DTDC
AWB: D123456789

Last event:
Reached Destination Hub

Location:
Ahmedabad Hub

Last update:
29 Sep 09:00

SLA age:
25h

[Open Shipment]
[Create Case]
[Acknowledge]
```

---

# 33. Shipment Tracking Page

Create a dedicated page:

```text
/shipments/tracking
```

## Summary cards

```text
Dispatched
In Transit
Out for Delivery
Delivered
NDR
Warehouse Delay
RTO
Tracking Stale
```

## Search

Support:

```text
Order ID
Parcel ID
Internal barcode
AWB/Consignment No.
Customer mobile
```

## Filters

```text
Courier
India Post
DTDC

Status
All
In Transit
Hub
OFD
Delivered
NDR
RTO

Exceptions
Warehouse Delay
Tracking Stale
Courier Error

Date
Dispatch date
Delivery date
```

---

# 34. Shipment Detail Page

Recommended layout:

```text
Shipment #SHP-000123

Order: #10542
Parcel: PCL00018492
Internal Barcode: PCL00018492

Courier: DTDC
AWB: D123456789

Current Status:
REACHED HUB

Current Location:
Ahmedabad Hub

Last Update:
29 Sep 09:00

Expected Delivery:
...
```

Then a lifecycle timeline:

```text
✓ Parcel Ready
  27 Sep 09:10

✓ AWB Assigned
  27 Sep 09:30

✓ Picked Up
  27 Sep 16:15

✓ Surat Hub
  27 Sep 21:40

✓ Ahmedabad Hub
  28 Sep 08:10

⚠ No movement beyond SLA
  29 Sep 09:00+

○ Out for Delivery

○ Delivered
```

Show the raw provider event in an expandable audit panel for ADMIN users.

---

# 35. Customer Delivery Problem Workflow

## Normal

```text
OUT_FOR_DELIVERY
    ↓
DELIVERED
```

## Customer unavailable

```text
OUT_FOR_DELIVERY
    ↓
DELIVERY_ATTEMPTED
    ↓
NDR
```

Then worker can see:

```text
NDR reason
Attempt date
Courier
AWB
Latest location
Next action
```

Possible actions:

```text
Request reattempt
Contact customer
Create case
Start return/RTO workflow
```

Only expose provider actions that are actually supported by the carrier API/account.

---

# 36. Delivered Status Must Be Auditable

When a carrier reports delivered:

```text
Webhook/API event
      ↓
Tracking Event: DELIVERED
      ↓
Shipment.current_status = DELIVERED
      ↓
Shipment.delivered_at = event time
      ↓
Append lifecycle event
      ↓
Close shipment-delay exceptions
      ↓
Trigger financial reconciliation eligibility
```

Do not directly mark the Shopify order as financially settled.

---

# 37. COD/Financial Separation

This project is a reconciliation platform, so preserve the distinction:

```text
Shipment delivered
        ≠
Courier has remitted COD money
```

Example:

```text
Shipment status:
DELIVERED

Financial status:
SETTLEMENT_PENDING
```

Later:

```text
Courier statement
      ↓
Match AWB/order
      ↓
COD amount matched
      ↓
Settlement confirmed
      ↓
Tally export
```

Likewise:

```text
RTO_DELIVERED
```

does not necessarily imply a settlement outcome without statement evidence.

---

# 38. Courier Tracking Reconciliation

Create a service:

```text
courier_reconciliation_service.py
```

It should compare:

```text
Your DB state
vs
Latest courier state
```

Examples:

```text
Your DB:
IN_TRANSIT

Courier:
DELIVERED
```

Action:

```text
Import missing event
Update projection
Audit correction
```

Another:

```text
Your DB:
DELIVERED

Courier:
IN_TRANSIT
```

Do not silently reverse a terminal state.

Create an inconsistency exception:

```text
TRACKING_STATE_CONFLICT
```

and preserve both observations.

---

# 39. API Endpoints

Recommended endpoints:

## Shipment booking

```http
POST /api/v1/shipments/{parcel_id}/book
```

## Shipment details

```http
GET /api/v1/shipments/{shipment_id}
```

## List shipments

```http
GET /api/v1/shipments
```

## Track shipment

```http
GET /api/v1/shipments/{shipment_id}/tracking
```

## Force tracking refresh

```http
POST /api/v1/shipments/{shipment_id}/tracking/refresh
```

Restrict manual refresh to appropriate roles and apply rate limits.

## Cancel shipment

```http
POST /api/v1/shipments/{shipment_id}/cancel
```

## Reprint label

```http
POST /api/v1/shipments/{shipment_id}/label/reprint
```

Reuse the project's existing reprint audit mechanism.

## Webhooks

```http
POST /api/v1/webhooks/couriers/{provider}
```

## Courier health

```http
GET /api/v1/couriers/health
```

## Courier configuration

ADMIN only:

```http
GET /api/v1/couriers
POST /api/v1/couriers/{provider}/test
```

Never expose secrets.

---

# 40. Role Permissions

Use your current RBAC system.

| Action | ADMIN | WAREHOUSE | ACCOUNTANT | VIEWER |
|---|---:|---:|---:|---:|
| View shipment | Yes | Yes | Yes | Yes |
| Book shipment | Yes | Yes | No | No |
| Print label | Yes | Yes | No | No |
| Manual tracking refresh | Yes | Yes | Optional | No |
| Resolve warehouse exception | Yes | Yes/depending policy | No | No |
| Resolve financial exception | Yes | No | Yes | No |
| Configure courier | Yes | No | No | No |
| View raw courier payload | Yes | No/limited | No | No |
| Reconciliation | Yes | No | Yes | View |
| Tally export | Yes | No | Yes | View |

Keep the project's existing authorization conventions where they differ.

---

# 41. Frontend Components

Add:

```text
frontend/
├── app/
│   ├── shipments/
│   │   ├── page.tsx
│   │   ├── [id]/
│   │   │   └── page.tsx
│   │   ├── dispatch/
│   │   │   └── page.tsx
│   │   └── exceptions/
│   │       └── page.tsx
│   │
│   └── settings/
│       └── couriers/
│           └── page.tsx
│
├── components/
│   ├── courier-selector.tsx
│   ├── shipment-status-badge.tsx
│   ├── shipment-timeline.tsx
│   ├── tracking-table.tsx
│   ├── warehouse-delay-card.tsx
│   ├── ndR-case-panel.tsx
│   ├── courier-health-card.tsx
│   └── awb-display.tsx
│
└── lib/
    ├── courier.ts
    └── tracking.ts
```

Adjust exact directories to your existing frontend structure.

---

# 42. Dispatch UI State Handling

Use an explicit state machine in the UI.

```text
IDLE
 ↓
SCANNING
 ↓
PARCEL_LOADED
 ↓
VALIDATING
 ↓
READY_TO_BOOK
 ↓
BOOKING
 ↓
BOOKED
```

Failure:

```text
BOOKING
 ↓
BOOKING_ERROR
```

Prevent duplicate button submissions by using:

```text
isSubmitting
Idempotency-Key
server-side duplicate protection
```

---

# 43. UX for Worker

Worker workflow should require as little typing as possible:

```text
Scan internal barcode
      ↓
Select courier
      ↓
Select service
      ↓
Confirm
      ↓
AWB generated
      ↓
Print label
```

Address/customer details should come from the order/parcel record.

Do not make workers manually re-enter customer information unless correction is necessary.

---

# 44. Courier Settings UI

Admin page:

```text
Settings > Couriers

India Post
[Enabled]
[Connected]

DTDC
[Enabled]
[Connected]
```

Connection test:

```text
[ Test India Post Connection ]
[ Test DTDC Connection ]
```

Result:

```text
✓ Authentication successful
✓ API reachable
✓ Account active
```

or:

```text
✗ Authentication failed
```

Never show the actual secret.

---

# 45. Provider Health Monitoring

Track:

```text
Last successful API call
Last failed API call
Failure count
Rate-limit count
Webhook last received
Tracking sync lag
```

Dashboard:

```text
India Post
API: Healthy
Last sync: 2 min ago

DTDC
API: Healthy
Last sync: 3 min ago
```

This will help distinguish:

```text
Shipment delay
```

from:

```text
Courier API outage
```

---

# 46. Error Classification

Create provider-neutral error categories:

```text
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
VALIDATION_ERROR
SERVICEABILITY_ERROR
RATE_LIMIT_ERROR
TIMEOUT_ERROR
NETWORK_ERROR
PROVIDER_SERVER_ERROR
DUPLICATE_REQUEST
NOT_FOUND
UNSUPPORTED_OPERATION
UNKNOWN_PROVIDER_ERROR
```

Map provider-specific errors into these categories.

Store the original provider error code/message separately.

---

# 47. Retry Strategy

Safe automatic retries:

```text
Timeout
Connection reset
HTTP 502/503/504
Temporary provider failure
```

Do not blindly retry:

```text
Invalid credentials
Invalid address
Invalid pincode
Invalid shipment data
Permanent validation errors
```

For shipment creation, retry only with the project's idempotency mechanism and only if the provider contract/API guarantees duplicate protection or you can safely determine whether the shipment was created.

The worst outcome is:

```text
Request timed out
 ↓
System retries
 ↓
Two real courier shipments created
```

---

# 48. Idempotency Requirements

Use idempotency at three levels.

## Booking

```text
tenant + parcel_id + booking_operation
```

## Webhook/event ingestion

```text
provider + provider_event_id
```

or deterministic fingerprint if provider event ID is absent.

## Manual refresh

Prevent several workers/users from refreshing the same AWB simultaneously.

---

# 49. Audit Trail

Every important action should append an audit event:

```text
COURIER_SELECTED
SHIPMENT_BOOKING_STARTED
SHIPMENT_BOOKED
AWB_ASSIGNED
LABEL_GENERATED
LABEL_REPRINTED
TRACKING_REFRESHED
TRACKING_EVENT_RECEIVED
NDR_CREATED
WAREHOUSE_DELAY_DETECTED
WAREHOUSE_DELAY_ACKNOWLEDGED
RTO_INITIATED
DELIVERED
SHIPMENT_CANCELLED
COURIER_CONFIGURATION_CHANGED
```

Audit fields:

```text
actor_user_id
actor_role
action
entity_type
entity_id
metadata
created_at
```

---

# 50. Raw Payload Retention

Store raw courier responses/events in JSONB or an equivalent object store strategy.

At minimum retain:

```text
raw shipment creation response
raw tracking response
raw webhook payload
raw provider error
```

Protect sensitive information.

If the provider includes unnecessary personal data in every event, consider redacting fields before long-term retention while retaining enough information for audit/debugging.

---

# 51. Polling Strategy by Shipment State

Use adaptive polling rather than a fixed aggressive interval.

Example:

```text
CREATED / AWB_ASSIGNED:
less frequent

PICKUP_SCHEDULED:
more frequent around expected pickup

PICKED_UP / IN_TRANSIT:
regular polling

OUT_FOR_DELIVERY:
high priority

DELIVERED / RTO_DELIVERED:
stop polling
```

After terminal states:

```text
DELIVERED
RTO_DELIVERED
CANCELLED
```

remove the shipment from active polling.

Keep historical data queryable.

---

# 52. Tracking Stale vs Warehouse Delay

Use different exception types.

## Tracking stale

No event has been received for a specified period.

```text
TRACKING_STALE
```

## Warehouse delay

Latest event indicates hub/facility/warehouse state and the shipment exceeds hub SLA.

```text
WAREHOUSE_DELAY
```

## Provider API problem

Your tracking call itself cannot succeed.

```text
COURIER_API_ERROR
```

This distinction prevents bad analytics.

---

# 53. Example Operational Cases

## Case A — Delivered normally

```text
Dispatch
 ↓
AWB
 ↓
Picked Up
 ↓
In Transit
 ↓
Out for Delivery
 ↓
Delivered
```

System result:

```text
shipment = DELIVERED
exceptions = none
finance = settlement pending
```

## Case B — Hub delay

```text
Dispatch
 ↓
Picked Up
 ↓
In Transit
 ↓
Reached Hub
 ↓
No update > SLA
```

System result:

```text
shipment.current_status = REACHED_HUB
exception = WAREHOUSE_DELAY
```

## Case C — NDR

```text
OFD
 ↓
Delivery Attempted
 ↓
NDR
```

System result:

```text
exception = NDR
customer_action_required = true
```

## Case D — RTO

```text
NDR
 ↓
RTO Initiated
 ↓
RTO In Transit
 ↓
RTO Delivered
```

System result:

```text
shipment.current_status = RTO_DELIVERED
exception = RTO / financial follow-up as applicable
```

---

# 54. API Contract Isolation

Use a provider adapter like this:

```python
provider = courier_registry.get("DTDC")
result = await provider.create_shipment(request)
```

Business service:

```python
result = await courier_service.book(
    parcel=parcel,
    provider_name=request.courier,
    service=request.service,
)
```

The service should not contain code such as:

```python
if courier == "DTDC":
    ...
elif courier == "INDIA_POST":
    ...
```

Repeated branching becomes hard to maintain.

Use adapters instead.

---

# 55. Configuration Registry

```python
COURIER_REGISTRY = {
    "INDIA_POST": IndiaPostProvider,
    "DTDC": DTDCCourierProvider,
}
```

Provider lookup:

```python
def get_provider(name: str) -> CourierProvider:
    provider_cls = COURIER_REGISTRY[name]
    return provider_cls(config=load_provider_config(name))
```

Add validation so unsupported providers fail cleanly.

---

# 56. Testing Strategy

The current project already has a healthy backend/frontend test suite. Extend it instead of creating a separate test strategy.

## Unit tests

Test:

```text
status normalization
status transition validation
event fingerprinting
idempotency
SLA calculations
warehouse delay detection
NDR classification
RTO classification
provider error mapping
```

## Provider adapter tests

Use mocked HTTP responses.

Do not call real courier APIs in ordinary unit tests.

Test:

```text
success
validation error
401/403
404
429
500
502/503/504
timeout
malformed payload
duplicate response
unknown status
```

## Integration tests

Use sandbox/test credentials where the carrier provides them.

Test:

```text
Create shipment
AWB received
Tracking fetched
Webhook/callback received
Duplicate webhook
Tracking refresh
Cancel
NDR/RTO if supported in test environment
```

## Frontend tests

Add tests for:

```text
Courier selector
Dispatch booking
Booking error
AWB display
Tracking timeline
Warehouse delay badge
NDR case
RTO case
Filter/search
Manual refresh
```

## End-to-end test

Minimum real-world drill:

```text
Order
 → Parcel
 → Barcode
 → Dispatch
 → Courier booking
 → AWB
 → Tracking event
 → Timeline
 → Delivered / NDR / RTO
 → Reconciliation eligibility
```

---

# 57. Contract Tests for Status Mappings

Provider statuses will change over time.

Create fixtures:

```text
fixtures/couriers/india_post/
fixtures/couriers/dtdc/
```

For every known provider status fixture:

```text
raw provider event
        ↓
normalizer
        ↓
expected normalized state
```

Example test shape:

```python
def test_dtdc_status_mapping():
    event = load_fixture("dtdc/in_transit.json")
    normalized = normalizer.normalize(event)
    assert normalized.normalized_status == "IN_TRANSIT"
```

This prevents future provider changes from silently breaking the system.

---

# 58. Security Requirements

Before using real courier credentials in production:

```text
1. Set strong JWT_SECRET
2. Set ENCRYPTION_KEY
3. Encrypt courier credentials at rest
4. Never send secrets to frontend
5. Redact secrets from logs
6. Validate webhook authentication
7. Rate-limit public/manual tracking endpoints
8. Restrict courier configuration to ADMIN
9. Use HTTPS in production
10. Restrict CORS to actual production origins
11. Validate webhook payload sizes
12. Add request timeouts
13. Add retry/backoff
14. Add audit logs
```

Your current project overview says `ENCRYPTION_KEY` is currently empty and tokens are plain. **Do not put live India Post or DTDC production credentials into this state.** Fix credential encryption first.

---

# 59. Secret Storage Architecture

Preferred hierarchy:

```text
Local development
    ↓
.env (gitignored)

Production
    ↓
platform secret manager/environment secrets
```

For database-stored multi-tenant credentials:

```text
plaintext credential
      ↓
application encryption key
      ↓
encrypted DB field
```

Never commit:

```text
.env
API key
client secret
webhook secret
JWT secret
ENCRYPTION_KEY
```

---

# 60. Logging Strategy

Good:

```text
courier=DTDC
operation=create_shipment
parcel_id=...
request_id=...
provider_status=success
latency_ms=450
```

Bad:

```text
Authorization: Bearer xxxxx
client_secret=xxxx
api_key=xxxx
```

For customer data, log only what is operationally useful.

---

# 61. Rate Limiting

There are two dimensions:

### Provider limits

The carrier contract may specify request limits.

Respect them.

### Your API

Protect endpoints such as:

```text
POST /tracking/refresh
POST /webhooks/...
```

from abuse/replay.

Use:

```text
per-user rate limit
per-IP rate limit
per-shipment refresh cooldown
provider-specific concurrency limits
```

---

# 62. Monitoring Metrics

Track:

```text
courier_booking_success_total
courier_booking_failure_total
courier_tracking_success_total
courier_tracking_failure_total
courier_webhook_received_total
courier_webhook_invalid_total
courier_webhook_duplicate_total
courier_tracking_events_total
warehouse_delay_detected_total
ndr_created_total
rto_created_total
delivery_events_total
provider_api_latency_ms
provider_api_429_total
provider_api_5xx_total
```

Useful business metrics:

```text
Delivered shipments
NDR rate
RTO rate
Average time in transit
Average hub dwell time
Tracking stale rate
Courier API failure rate
COD outstanding
COD settlement lag
```

---

# 63. Dashboard Enhancements

Add to the existing dashboard:

```text
Courier Overview

India Post
- Dispatches
- In transit
- Delivered
- NDR
- RTO
- Hub delay

DTDC
- Dispatches
- In transit
- Delivered
- NDR
- RTO
- Hub delay
```

Add a comparison view only as factual operational reporting, not a subjective ranking.

Example:

```text
Courier       Active       Delivered       NDR       RTO       Delay
India Post      420           760            18        11         7
DTDC            510           830            25        14         9
```

---

# 64. Search Strategy

Shipment search should be indexed and support:

```text
internal parcel ID
barcode
AWB
order ID
customer mobile
```

Search normalization:

```text
trim spaces
uppercase AWB/barcode
remove accidental hyphen/spacing only where safe
```

Do not alter the stored official AWB value.

---

# 65. Timeline Rendering Rules

Timeline should be built from immutable events.

Sort by:

```text
event_time ASC
received_at ASC
id ASC
```

If two events have identical timestamps, use deterministic ordering.

This matches the existing issue you previously fixed around deterministic exception ordering.

Display:

```text
29 Sep 09:30
09:30 AM
```

Store timestamps in UTC.

Render in the user's/business timezone.

---

# 66. Timezone Strategy

Database:

```text
UTC
```

Business configuration:

```text
Asia/Kolkata
```

UI:

```text
Asia/Kolkata
```

Do not compare naive datetimes for SLA calculations.

Use timezone-aware timestamps everywhere.

---

# 67. Expected Delivery Date

If the carrier provides EDD:

```text
expected_delivery_at = provider value
```

If it doesn't, you may calculate a separate internal estimate later.

Do not overwrite a carrier-provided EDD with an internal estimate.

Keep:

```text
provider_expected_delivery_at
internal_expected_delivery_at
```

if both are eventually required.

---

# 68. Warehouse Delay Rule Improvements for Production

The first implementation should use:

```text
status + time since event
```

After collecting enough real data, add:

```text
courier
service
origin pincode
origin zone
facility
destination pincode
weekend/holiday calendar
expected delivery date
```

Later, the rule can become:

```text
hub dwell > expected hub dwell SLA
```

rather than a global 24-hour threshold.

Do not build machine-learning delay prediction yet. It adds complexity before you have enough clean historical courier events.

---

# 69. Carrier Holiday/Weekend Handling

A 24-hour wall-clock threshold can generate false alerts across:

```text
Sunday
public holiday
courier non-operating periods
weather/event disruptions
```

Phase 1:

Use a configurable calendar/working-hour policy.

Phase 2:

Add carrier-specific working calendars where data/API supports them.

---

# 70. Manual Tracking Refresh

Shipment detail page:

```text
[ Refresh Tracking ]
```

After clicking:

```text
Request started
      ↓
Provider tracking API
      ↓
New events imported
      ↓
Timeline refreshes
```

Cooldown:

```text
Do not allow another refresh for N seconds/minutes per shipment.
```

This prevents workers from hammering the carrier API.

---

# 71. Webhook Drill Test

Create a local test script/fixture.

Example:

```text
scripts/test-courier-webhook.py
```

Flow:

```text
POST fake India Post event
        ↓
Webhook endpoint
        ↓
DB tracking event
        ↓
Shipment projection
        ↓
Exception evaluation
        ↓
API returns 200
```

Repeat for DTDC.

Then send the same event twice.

Expected:

```text
tracking_events = 1
```

not:

```text
tracking_events = 2
```

---

# 72. Provider Sandbox Strategy

Priority:

```text
Official sandbox
    ↓
Official test account
    ↓
Controlled production shipment
```

Never start by experimenting against random live customer shipments.

Create a dedicated test parcel/customer where permitted.

---

# 73. Production Pilot

Pilot with a small number of shipments.

Example:

```text
Day 1:
5 India Post shipments
5 DTDC shipments

Day 2:
20 + 20

Day 3:
50 + 50
```

Check:

```text
Booking success
AWB correctness
Label correctness
Tracking event arrival
Webhook reliability
Polling fallback
NDR detection
Hub delay logic
Delivery state
Settlement matching
```

Only increase volume after the complete chain works.

---

# 74. Rollout Flags

Add feature flags:

```text
ENABLE_INDIA_POST_BOOKING
ENABLE_INDIA_POST_TRACKING
ENABLE_INDIA_POST_WEBHOOK

ENABLE_DTDC_BOOKING
ENABLE_DTDC_TRACKING
ENABLE_DTDC_WEBHOOK

ENABLE_WAREHOUSE_DELAY_ALERTS
```

This allows tracking to be enabled before automated booking if needed.

---

# 75. Recommended Implementation Phases

## Phase 0 — Carrier onboarding

Before coding live provider requests:

```text
Get official India Post integration documentation
Get official India Post credentials/test access
Get official DTDC integration documentation
Get official DTDC credentials/test access
Confirm booking APIs
Confirm tracking APIs
Confirm webhook/callback capability
Confirm NDR/RTO interfaces
Confirm COD/settlement interface
```

Deliverable:

```text
carrier API contract matrix
```

---

## Phase 1 — Secure configuration

Tasks:

```text
Set strong JWT_SECRET
Set ENCRYPTION_KEY
Implement encrypted credential storage if needed
Add provider configuration model
Add secret redaction
Add admin-only configuration APIs
```

Deliverable:

```text
Secure courier settings
```

---

## Phase 2 — Common courier abstraction

Implement:

```text
CourierProvider
CourierRegistry
Common request/response models
Provider errors
Capability model
```

Deliverable:

```text
Core courier layer with zero provider-specific business logic
```

---

## Phase 3 — Database

Add:

```text
shipment fields
tracking_events
courier_accounts
status mappings
SLA configuration
shipment exceptions
```

Run Alembic migration.

Deliverable:

```text
DB at new migration head
```

---

## Phase 4 — DTDC adapter

Implement based on the official DTDC integration specification for your account.

Tasks:

```text
authentication
shipment creation
AWB mapping
label/pickup where supported
tracking
status normalization
provider error mapping
```

Deliverable:

```text
DTDC booking + tracking in sandbox/test mode
```

---

## Phase 5 — India Post adapter

Implement based on official India Post business/API documentation provided for your account.

Tasks:

```text
authentication
shipment booking
consignment mapping
label/manifest where supported
tracking
status normalization
provider error mapping
```

Deliverable:

```text
India Post booking + tracking in sandbox/test mode
```

---

## Phase 6 — Webhook ingestion

Implement:

```text
India Post callback/webhook if supported
DTDC callback/webhook if supported
signature/token validation
raw event persistence
idempotency
normalized event processing
```

Deliverable:

```text
real-time event ingestion
```

---

## Phase 7 — Tracking poller

Implement:

```text
active shipment selection
provider rate-limit handling
retry/backoff
tracking refresh
stale detection
sync health metrics
```

Deliverable:

```text
webhook + polling resilience
```

---

## Phase 8 — Warehouse delay engine

Implement:

```text
SLA table
SLA worker
warehouse/hub detection
tracking stale detection
exception creation
notifications
```

Deliverable:

```text
Automatic shipment delay detection
```

---

## Phase 9 — NDR/RTO

Implement:

```text
NDR event handling
NDR case creation
reattempt action where supported
RTO event handling
RTO timeline
```

Deliverable:

```text
Complete delivery failure workflow
```

---

## Phase 10 — Dashboard

Implement:

```text
shipment list
filters
search
shipment detail
timeline
warehouse-delay queue
NDR queue
RTO queue
courier health
manual refresh
```

Deliverable:

```text
Operational shipment control center
```

---

## Phase 11 — Financial integration

Connect:

```text
Delivered
RTO Delivered
COD/remittance data
Statement matching
Existing reconciliation rules
Tally export
```

Do not redesign your existing reconciliation engine unnecessarily.

Add shipment/AWB as another matching key.

Recommended matching keys:

```text
AWB
Internal Parcel ID
Order ID
Provider shipment ID
```

---

## Phase 12 — Testing and pilot

Run:

```text
Backend tests
Frontend tests
tsc
Alembic upgrade/downgrade validation
Provider adapter tests
Webhook tests
Idempotency tests
Load tests for tracking ingestion
Pilot shipments
```

Then enable production booking per provider.

---

# 76. Exact Implementation Order in Your Repository

Recommended commit sequence:

```text
1. feat(courier): add provider abstraction and common schemas

2. feat(courier): add shipment/tracking database models

3. feat(courier): add courier credential/configuration service

4. feat(dtdc): add DTDC provider adapter

5. feat(india-post): add India Post provider adapter

6. feat(tracking): add normalized tracking event pipeline

7. feat(webhooks): add courier callback ingestion

8. feat(tracking): add polling reconciliation worker

9. feat(sla): add warehouse delay detection

10. feat(exceptions): add courier/NDR/RTO exceptions

11. feat(frontend): add courier dispatch workflow

12. feat(frontend): add shipment tracking dashboard

13. feat(frontend): add warehouse delay/NDR/RTO views

14. feat(reconciliation): connect shipment outcomes to money reconciliation

15. test(courier): add provider, webhook, idempotency and SLA tests

16. chore(security): production secrets/CORS/credential hardening
```

Keep commits small enough to revert independently.

---

# 77. Definition of Done

The feature is not considered complete just because an AWB appears on screen.

## Booking

```text
[ ] User scans parcel
[ ] User selects India Post/DTDC
[ ] Backend validates parcel
[ ] Shipment is created
[ ] AWB/consignment number is stored
[ ] Duplicate booking prevented
[ ] Audit event created
[ ] Label handled
```

## Tracking

```text
[ ] Tracking API works
[ ] Webhook/callback works when supported
[ ] Polling fallback works
[ ] Events are immutable
[ ] Duplicate events are ignored
[ ] Raw payloads retained safely
[ ] Current shipment status is updated
[ ] Timeline is correct
```

## Exceptions

```text
[ ] NDR detection works
[ ] RTO detection works
[ ] Tracking stale detection works
[ ] Hub/warehouse delay detection works
[ ] Exception is idempotent
[ ] User can acknowledge/resolve as permitted
[ ] Audit trail exists
```

## Financial

```text
[ ] Delivered shipment becomes eligible for settlement matching
[ ] RTO shipment remains distinguishable
[ ] AWB is available to statement matching
[ ] Existing reconciliation continues to work
[ ] Tally export remains functional
```

## Security

```text
[ ] ENCRYPTION_KEY configured
[ ] JWT_SECRET strong
[ ] Courier secrets not committed
[ ] Secrets not sent to frontend
[ ] Webhooks authenticated
[ ] CORS production-safe
[ ] Logs redact secrets
```

---

# 78. Example Final Data Chain

A successful DTDC shipment should eventually look like:

```text
Shopify Order
#10542
     |
     v
Parcel
PCL-00018492
     |
     v
Internal Barcode
PCL00018492
     |
     v
Shipment
SHP-000123
     |
     +---- Courier = DTDC
     |
     +---- AWB = D123456789
     |
     v
Tracking Events
     |
     +---- PICKED_UP
     +---- SURAT_HUB
     +---- AHMEDABAD_HUB
     +---- OUT_FOR_DELIVERY
     +---- DELIVERED
     |
     v
Shipment State
DELIVERED
     |
     v
Financial State
SETTLEMENT_PENDING
     |
     v
Courier Statement
     |
     v
Matched
     |
     v
SETTLED
     |
     v
Tally Export
```

A delayed shipment:

```text
Shipment
D123456789
     |
     v
REACHED_HUB
     |
     v
No meaningful event for > configured SLA
     |
     v
WAREHOUSE_DELAY exception
     |
     v
Dashboard alert
     |
     v
Worker investigates
     |
     +---- New tracking event → close exception
     |
     +---- NDR → NDR workflow
     |
     +---- RTO → RTO workflow
```

---

# 79. What Not to Build

Do not build these shortcuts:

```text
❌ Scrape India Post CAPTCHA pages
❌ Scrape DTDC tracking HTML
❌ Store courier API secrets in frontend
❌ Put courier credentials in Git
❌ Use internal barcode as AWB
❌ Replace every old tracking event with the latest status
❌ Treat every hub scan as a problem
❌ Mark a shipment financially settled merely because it is delivered
❌ Poll every shipment every minute
❌ Retry shipment creation blindly after a timeout
❌ Hard-code provider status strings throughout business logic
❌ Create separate exception logic for each courier
❌ Depend on a third-party aggregator when the project requirement is direct India Post + DTDC integration
```

---

# 80. Final Target Architecture

```text
                         SHOPIFY
                            |
                            v
                         ORDERS
                            |
                            v
                         PARCELS
                            |
                            v
                    INTERNAL BARCODE
                            |
                            v
                         DISPATCH
                            |
                    +-------+-------+
                    |               |
                    v               v
               INDIA POST         DTDC
                  API               API
                    |               |
                    +-------+-------+
                            |
                            v
                      COURIER LAYER
                            |
                    +-------+-------+
                    |               |
              Booking Adapter   Tracking Adapter
                    |               |
                    +-------+-------+
                            |
                            v
                    AWB / CONSIGNMENT
                            |
              +-------------+-------------+
              |                           |
              v                           v
       WEBHOOK/CALLBACK                POLLING
              |                           |
              +-------------+-------------+
                            |
                            v
                  EVENT INGESTION SERVICE
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
         RAW EVENT      NORMALIZED       AUDIT
                          EVENT
                            |
                            v
                   SHIPMENT PROJECTION
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
         DELIVERED         NDR        HUB DELAY
             |              |              |
             |              v              v
             |            RTO          EXCEPTION QUEUE
             |              |              |
             +--------------+--------------+
                            |
                            v
                    RECONCILIATION
                            |
                       STATEMENTS
                            |
                            v
                          TALLY
```

---

# 81. Immediate Next Actions

Do these in this order:

```text
1. Obtain official India Post business/API documentation and credentials.

2. Obtain official DTDC API/integration documentation and credentials.

3. For each carrier, identify the exact:
   - booking endpoint
   - AWB/consignment process
   - tracking endpoint
   - callback/webhook mechanism
   - authentication scheme
   - NDR/RTO interface
   - COD/remittance interface
   - rate/serviceability interface

4. Fill a carrier contract matrix.

5. Set ENCRYPTION_KEY and secure courier secrets before using live credentials.

6. Implement common courier adapter.

7. Implement database migration.

8. Implement DTDC adapter.

9. Implement India Post adapter.

10. Implement tracking ingestion.

11. Implement polling fallback.

12. Implement warehouse-delay SLA engine.

13. Connect exceptions to your existing queue.

14. Add shipment tracking UI.

15. Test with controlled shipments.

16. Enable production gradually.
```

---

# 82. Carrier Contract Matrix Template

Fill this after receiving the official documents from India Post and DTDC.

| Capability | India Post | DTDC |
|---|---|---|
| Authentication | TBD from official contract | TBD from official contract |
| Base URL | TBD | TBD |
| Sandbox | TBD | TBD |
| Create shipment | TBD | TBD |
| AWB/Consignment generation | TBD | TBD |
| Pickup booking | TBD | TBD |
| Label | TBD | TBD |
| Manifest | TBD | TBD |
| Tracking API | TBD | TBD |
| Webhook/callback | TBD | TBD |
| NDR | TBD | TBD |
| Reattempt | TBD | TBD |
| RTO | TBD | TBD |
| COD | TBD | TBD |
| Settlement data | TBD | TBD |
| Pincode/serviceability | TBD | TBD |
| Rate API | TBD | TBD |
| Rate limits | TBD | TBD |
| Authentication expiry | TBD | TBD |
| Error codes | TBD | TBD |
| Support contact | TBD | TBD |

**Do not replace `TBD` with guessed values.** Populate this matrix only from the actual carrier integration specification for your account.

---

# 83. Official Reference Notes

The design decisions above are based on the currently published capabilities and official information available from the carriers, but the exact API endpoint names, authentication fields, schemas, limits, and webhook formats must be confirmed from the business/API package issued to your account.

### India Post

India Post officially publishes:

- End-to-end consignment tracking.
- Parcel services for bulk/contractual customers.
- API integration for bulk customers.
- Technology integration involving real-time tracking/status updates.
- Current postal services and track-and-trace facilities.

References:

- https://www.indiapost.gov.in/VAS/Pages/Tenders/Parcel_Sales_Manual_27.09.2021.pdf
- https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx
- https://www.indiapost.gov.in/mailproducts/domesticservices/indiapostparcel
- https://www.indiapost.gov.in/mailproducts/domesticservices/indiapostparcellastmile

### DTDC

DTDC officially publishes:

- API-based integration with ERP/WMS/e-commerce systems.
- Real-time shipment tracking.
- E-commerce and COD capabilities.
- Enterprise logistics and centralized live tracking.
- Shipment tracking using consignment/AWB numbers.

References:

- https://www.dtdc.com/b2b-enterprise/
- https://www.dtdc.com/feature/
- https://www.dtdc.com/express-parcel/

---

# Final Architecture Principle

The most important rule for this project is:

```text
Provider-specific API data
        ↓
Provider Adapter
        ↓
Normalized Courier Event
        ↓
Append-only Tracking Event
        ↓
Shipment State Projection
        ↓
SLA / NDR / RTO / Delay Rules
        ↓
Exceptions + Notifications
        ↓
Financial Reconciliation
```

That structure lets you integrate **India Post and DTDC directly** without contaminating your existing order, parcel, barcode, reconciliation, or Tally logic with provider-specific code.

The direct-courier implementation is therefore an extension of your existing platform, not a replacement of the current architecture.
