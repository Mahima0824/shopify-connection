# Delhivery Courier Integration --- Detailed Implementation Plan

**Project:** Courier / Shipment Management Platform\
**Current primary tracking provider:** India Post via ShipSagar\
**New integration:** Delhivery\
**Implementation approach:** Add Delhivery as a first-class carrier
while preserving the existing `CarrierProvider` abstraction and keeping
ShipSagar available as an aggregator/provider.

------------------------------------------------------------------------

## 1. Objective

Add **Delhivery** to the existing courier architecture so that the
platform can:

1.  Store Delhivery as a shipment carrier.
2.  Connect and validate Delhivery credentials.
3.  Track a Delhivery AWB using the Delhivery API.
4.  Convert Delhivery's carrier-specific statuses into the platform's
    standard shipment statuses.
5.  Store normalized tracking events in `ShipmentEvent`.
6.  Update the parent `Shipment` record with the latest
    status/location/timestamps.
7.  Expose Delhivery through the existing carrier APIs.
8.  Display Delhivery in the frontend carrier settings, shipment
    creation, and tracking UI.
9.  Handle authentication failures, timeouts, invalid AWBs, API errors,
    and malformed responses safely.
10. Keep the implementation extensible so Blue Dart and other carriers
    can later use the same architecture.

------------------------------------------------------------------------

# 2. Scope

## In scope

### Backend

-   Delhivery carrier adapter.
-   Provider registration.
-   Credential configuration/storage.
-   Delhivery API client logic.
-   Tracking response normalization.
-   Standard status mapping.
-   Tracking event persistence.
-   Carrier health/error reporting.
-   API integration with existing shipment endpoints.
-   Unit/integration tests.
-   Logging and error handling.

### Frontend

-   Delhivery carrier listing.
-   Delhivery connection UI.
-   Delhivery selection while assigning an AWB.
-   Delhivery tracking.
-   Carrier health/status display.
-   User-friendly error states.

## Out of scope for phase 1

Do **not** implement these unless the Delhivery account/API contract
requires them:

-   Shipment creation with Delhivery.
-   Pickup scheduling.
-   Label generation.
-   Cancellation.
-   NDR management.
-   COD reconciliation.
-   Rate calculation.
-   Return shipment creation.
-   Automatic Delhivery order creation.

Phase 1 should focus on **reliable tracking integration**.

------------------------------------------------------------------------

# 3. Important Architecture Decision

The system should distinguish between:

``` text
carrier_code
```

and:

``` text
tracking_provider
```

These represent two different things.

### carrier_code

The actual courier carrying the parcel.

Example:

``` text
DELHIVERY
```

### tracking_provider

The API/provider used by the application to obtain tracking information.

Example:

``` text
DELHIVERY
```

or potentially:

``` text
SHIPSAGAR
```

Therefore a future shipment could support:

``` text
carrier_code      = DELHIVERY
tracking_provider = DELHIVERY
```

or:

``` text
carrier_code      = DELHIVERY
tracking_provider = SHIPSAGAR
```

This prevents a future architecture problem where Delhivery tracking
through ShipSagar cannot be represented cleanly.

------------------------------------------------------------------------

# 4. Target Architecture

``` text
                         ┌─────────────────────┐
                         │      Frontend       │
                         │                     │
                         │ Carrier Settings    │
                         │ Add Shipment        │
                         │ Tracking            │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Carrier APIs      │
                         │                     │
                         │ /carriers           │
                         │ /carriers/connect   │
                         │ /shipments/tracking │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Shipment Service    │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Provider Registry  │
                         └──────────┬──────────┘
                                    │
                         get_provider("DELHIVERY")
                                    │
                                    ▼
                    ┌────────────────────────────┐
                    │    DelhiveryProvider       │
                    │                            │
                    │ validate_credentials()     │
                    │ get_tracking()             │
                    │ normalize_status()         │
                    │ build_tracking_url()       │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                         ┌─────────────────────┐
                         │ Delhivery API       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         Raw Delhivery Response
                                    │
                                    ▼
                         Normalization Layer
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
              ShipmentEvent                  Shipment
              History                         Current State
```

------------------------------------------------------------------------

# 5. Existing Architecture to Preserve

The existing project already contains:

``` text
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

``` text
backend/app/models/
    shipment.py
    courier_meta.py
```

and:

``` text
backend/app/services/
    shipsagar_service.py
```

and API routers:

``` text
backend/app/api/
    carriers.py
    shipments.py
    carrier_webhooks.py
```

The Delhivery implementation should fit into this structure rather than
creating a parallel architecture.

------------------------------------------------------------------------

# 6. Phase 0 --- Audit Existing Implementation

Before writing Delhivery code, inspect the following files.

## Backend

``` text
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

## Frontend

``` text
frontend/src/
    .../CarriersSettings.tsx
    .../AddShipmentDialog.tsx
    .../Tracking.tsx
    .../Shipments.tsx
    .../ShipmentList.tsx
    .../api.ts
```

### Audit checklist

Verify:

-   How `CarrierProvider` is instantiated.
-   What arguments `get_tracking()` receives.
-   How credentials are loaded.
-   How credentials are encrypted/decrypted.
-   How API errors are represented.
-   How tracking events are persisted.
-   How current shipment status is updated.
-   How carrier lists are currently generated.
-   Whether the frontend has hard-coded carrier lists.
-   Whether carrier capabilities come from backend or frontend
    constants.
-   Whether tracking is synchronous or background/polled.
-   Whether `CarrierConnection` is per organization/store or globally
    configured.

Do not start implementing until these flows are understood.

------------------------------------------------------------------------

# 7. Phase 1 --- Define Delhivery Provider Contract

Create:

``` text
backend/app/carriers/delhivery.py
```

The provider should implement the same interface as existing providers.

Expected responsibilities:

``` python
class DelhiveryProvider(CarrierProvider):

    capabilities()
    validate_credentials(credentials)
    get_tracking(awb, credentials)
    normalize_status(raw_status)
    build_tracking_url(awb)
```

The provider should **not** contain database business logic.

Bad:

``` text
DelhiveryProvider
    ├── query Shipment
    ├── save ShipmentEvent
    └── call API
```

Better:

``` text
Shipment Service
    ├── gets shipment
    ├── gets credentials
    ├── calls provider
    ├── persists normalized events
    └── updates shipment
```

The provider's job is primarily:

``` text
Delhivery API
      ↓
Provider adapter
      ↓
Common tracking response
```

------------------------------------------------------------------------

# 8. Phase 2 --- Delhivery API Client

The implementation must use the **official Delhivery API documentation
and credentials supplied for the account**.

Do not hard-code an API URL, authentication mechanism, or payload based
on an unofficial example.

Create either:

``` text
backend/app/carriers/delhivery.py
```

or, preferably if the project uses separate HTTP clients:

``` text
backend/app/integrations/delhivery_client.py
```

Recommended separation:

``` text
DelhiveryProvider
        ↓
DelhiveryClient
        ↓
HTTP API
```

This makes unit testing easier.

------------------------------------------------------------------------

# 9. Delhivery Client Responsibilities

The client should handle:

-   Base URL.
-   Authentication headers.
-   Request construction.
-   Query parameters.
-   Timeout.
-   HTTP status handling.
-   JSON parsing.
-   API-specific error extraction.
-   Response validation.

Example conceptual interface:

``` python
class DelhiveryClient:

    def __init__(self, credentials):
        self.credentials = credentials

    def get_tracking(self, awb: str):
        ...
```

The exact request structure must come from the official Delhivery API
contract available to your account.

------------------------------------------------------------------------

# 10. Credential Model

The platform already has:

``` text
CarrierConnection
```

Use it rather than creating a Delhivery-specific credential table.

Expected conceptual data:

``` text
carrier_code
credentials_encrypted
is_active
last_success_at
last_error_message
```

For example:

``` text
carrier_code = DELHIVERY
credentials_encrypted = <encrypted JSON>
is_active = true
```

Credentials might conceptually contain:

``` json
{
  "api_key": "...",
  "client_id": "...",
  "username": "...",
  "password": "..."
}
```

Only store the fields actually required by the official Delhivery API
contract.

Do not assume all Delhivery accounts use the same authentication model.

------------------------------------------------------------------------

# 11. Credential Security

Never store:

``` text
DELHIVERY_API_KEY
```

in plain text inside the database.

Do not log:

``` text
Authorization: ...
API-Key: ...
Password: ...
```

Use the existing credential encryption mechanism.

Logs should contain:

``` text
carrier = DELHIVERY
action = TRACK
awb = ********789
status = SUCCESS
```

rather than secrets.

AWBs may also be partially masked in production logs if they are
considered sensitive business data.

------------------------------------------------------------------------

# 12. Phase 3 --- Implement `capabilities()`

Initial capability should be conservative.

Example:

``` python
def capabilities(self):
    return [
        "TRACKING"
    ]
```

Do not claim:

``` text
LABEL
PICKUP
WEBHOOK
```

until those functions are actually implemented and tested.

Later:

``` python
[
    "TRACKING",
    "LABEL",
    "PICKUP",
    "WEBHOOK"
]
```

can be added independently.

------------------------------------------------------------------------

# 13. Phase 4 --- Implement Credential Validation

Implement:

``` python
validate_credentials(credentials)
```

Goal:

``` text
User enters credentials
        ↓
Backend validates credentials
        ↓
Successful API/authentication check
        ↓
Save encrypted credentials
```

Failure:

``` text
Invalid credentials
        ↓
Return controlled error
        ↓
Do not save invalid connection
```

Do not implement validation as:

``` python
return True
```

The endpoint should perform a real, safe validation according to the
Delhivery API's authentication mechanism.

------------------------------------------------------------------------

# 14. Phase 5 --- Implement Tracking

Implement:

``` python
get_tracking(awb, credentials)
```

Flow:

``` text
AWB
 ↓
Validate AWB input
 ↓
Build Delhivery request
 ↓
Authenticate
 ↓
Call tracking endpoint
 ↓
Check HTTP status
 ↓
Parse response
 ↓
Validate response structure
 ↓
Convert to common format
```

The provider should return a normalized internal structure.

Example:

``` json
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

The actual field names should match the project's existing internal
tracking response contract.

------------------------------------------------------------------------

# 15. Phase 6 --- Status Normalization

Your platform already has standard statuses:

``` text
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

Delhivery statuses must be mapped into these values.

Example mapping concept:

  Delhivery raw status      Internal status
  ------------------------- ------------------------------
  Delivered                 `DELIVERED`
  Out for Delivery          `OUT_FOR_DELIVERY`
  In Transit                `IN_TRANSIT`
  Manifested                `READY_TO_SHIP`
  Pickup Pending            `READY_TO_SHIP`
  RTO / Return to Origin    `RTO`
  Returned                  `RETURNED`
  Lost                      `LOST`
  Delivery Attempt Failed   `FAILED_ATTEMPT`
  Unknown/ambiguous         `EXCEPTION` or safe fallback

Do not use only:

``` python
if "DELIVERED" in raw_status:
```

without considering status precedence.

For example, a status containing both `RETURN` and another keyword must
be classified intentionally.

Create a dedicated mapping/matrix.

------------------------------------------------------------------------

# 16. Recommended Normalization Strategy

Use normalized uppercase values internally:

``` python
DELIVERED
OUT_FOR_DELIVERY
IN_TRANSIT
RTO
RETURNED
FAILED_ATTEMPT
LOST
EXCEPTION
READY_TO_SHIP
```

Keep the original value:

``` text
carrier_status_raw
```

in `ShipmentEvent`.

This gives you:

``` text
raw carrier status
        +
normalized application status
```

instead of destroying the original carrier information.

------------------------------------------------------------------------

# 17. Unknown Status Handling

This is critical.

Never crash because Delhivery introduces a new status.

Bad:

``` python
return STATUS_MAP[raw_status]
```

if it can raise `KeyError`.

Better:

``` python
return STATUS_MAP.get(
    normalized_raw_status,
    "EXCEPTION"
)
```

Also log the unknown value.

Example:

``` text
Unknown Delhivery status:
"Shipment held at processing center"
```

This allows you to update the mapping later.

------------------------------------------------------------------------

# 18. Phase 7 --- Register Provider

Update:

``` text
backend/app/carriers/registry.py
```

Add:

``` python
"DELHIVERY": DelhiveryProvider(),
```

Final concept:

``` python
PROVIDERS = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
    "SHIPSAGAR": ShipsagarProvider(),
    "DELHIVERY": DelhiveryProvider(),
}
```

Do not add Blue Dart or other future carriers yet.

------------------------------------------------------------------------

# 19. Phase 8 --- Update Carrier API

Existing endpoint:

``` http
GET /api/v1/carriers
```

must return Delhivery.

Expected conceptual response:

``` json
{
  "code": "DELHIVERY",
  "name": "Delhivery",
  "connected": false,
  "capabilities": [
    "TRACKING"
  ]
}
```

The frontend should ideally consume this endpoint instead of maintaining
a second hard-coded carrier registry.

------------------------------------------------------------------------

# 20. Connect Endpoint

Existing endpoint:

``` http
POST /api/v1/carriers/{code}/connect
```

For:

``` text
POST /api/v1/carriers/DELHIVERY/connect
```

the flow should be:

``` text
Validate code
      ↓
Get credentials from request
      ↓
Get Delhivery provider
      ↓
validate_credentials()
      ↓
If valid:
    encrypt credentials
    save CarrierConnection
    set is_active = true
      ↓
Return success
```

Failure:

``` text
validate_credentials()
      ↓
Failure
      ↓
Return useful error
      ↓
Do not persist invalid credentials
```

------------------------------------------------------------------------

# 21. Disconnect Endpoint

Existing:

``` http
DELETE /api/v1/carriers/{code}/disconnect
```

For Delhivery:

``` http
DELETE /api/v1/carriers/DELHIVERY/disconnect
```

should:

-   Deactivate the connection.
-   Remove/rotate credentials according to existing security policy.
-   Preserve historical shipment records.
-   Preserve shipment events.
-   Not delete historical shipments.

Disconnecting a carrier should **not destroy shipment history**.

------------------------------------------------------------------------

# 22. Phase 9 --- Tracking Service Integration

The shipment tracking service should not know Delhivery-specific HTTP
details.

Use:

``` python
provider = get_provider(shipment.carrier_code)

tracking = provider.get_tracking(
    shipment.awb_number,
    credentials
)
```

Then:

``` text
provider response
      ↓
validate
      ↓
save events
      ↓
update Shipment
      ↓
return API response
```

This is the most important benefit of the provider abstraction.

------------------------------------------------------------------------

# 23. Shipment Update Logic

After successful tracking:

``` text
Shipment.tracking_status
Shipment.current_location
Shipment.delivered_at
```

should be updated where applicable.

Example:

``` text
DELIVERED
    ↓
tracking_status = DELIVERED
delivered_at = latest event time
```

For:

``` text
IN_TRANSIT
```

do not populate `delivered_at`.

For:

``` text
OUT_FOR_DELIVERY
```

update:

``` text
tracking_status
current_location
```

according to the existing project rules.

------------------------------------------------------------------------

# 24. Event Deduplication

Tracking APIs often return the same history repeatedly.

Do not create duplicate events every time tracking is requested.

Define a stable event identity using available fields such as:

``` text
shipment_id
event_time
raw status
location
```

or preferably a carrier event ID if Delhivery provides one.

Conceptual uniqueness:

``` text
shipment_id
+
event_time
+
status_raw
+
location
```

Before inserting:

``` text
Does this event already exist?
       ↓
YES → skip
NO  → insert
```

This prevents:

``` text
10:30 Delivered
10:30 Delivered
10:30 Delivered
10:30 Delivered
```

from appearing in the timeline.

------------------------------------------------------------------------

# 25. Error Handling

Handle at least these cases.

## Invalid credentials

Return:

``` text
401/403-style application error
```

according to the existing API error conventions.

Message:

``` text
Delhivery authentication failed.
Please verify the configured credentials.
```

Do not expose raw API secrets.

------------------------------------------------------------------------

## Invalid AWB

Return a controlled validation/business error.

Example:

``` text
The provided Delhivery AWB could not be tracked.
```

------------------------------------------------------------------------

## API timeout

Use a finite timeout.

Never allow:

``` text
request → hangs indefinitely
```

Return:

``` text
Delhivery tracking service timed out.
```

------------------------------------------------------------------------

## Delhivery server error

Handle:

``` text
5xx
```

without crashing the application.

Record:

``` text
last_error_message
```

and log the provider error safely.

------------------------------------------------------------------------

## Rate limit

If Delhivery returns a rate-limit response:

-   Do not blindly retry immediately.
-   Respect `Retry-After` if supplied.
-   Use backoff for background polling.
-   Avoid hammering the API.

------------------------------------------------------------------------

## Malformed response

If the API returns an unexpected structure:

``` text
Do not insert corrupted ShipmentEvent data.
```

Instead:

``` text
log parsing failure
mark provider attempt as failed
return controlled error
```

------------------------------------------------------------------------

# 26. HTTP Client Rules

Use a shared HTTP client if your backend already has one.

Recommended behavior:

``` text
Connect timeout
Read timeout
Total request timeout
Retry only for safe transient failures
Structured logging
```

Do not retry authentication failures.

Do not retry invalid AWBs.

Retries are appropriate mainly for temporary network/server conditions.

------------------------------------------------------------------------

# 27. Phase 10 --- Frontend Carrier Settings

Current code apparently contains:

``` typescript
const KNOWN = [
    "DTDC",
    "TIRUPATI",
    "INDIA_POST",
    "MANUAL"
];
```

Do not simply append:

``` text
"DELHIVERY"
```

and leave the architecture unchanged.

Prefer:

``` text
GET /api/v1/carriers
```

as the source of truth.

Then:

``` text
Backend carrier registry
        ↓
GET /carriers
        ↓
Frontend
```

This eliminates duplicate carrier configuration.

------------------------------------------------------------------------

# 28. `CarriersSettings.tsx`

Add Delhivery automatically through API-driven carrier discovery.

UI should show:

``` text
Delhivery
────────────
Status: Connected / Not Connected

Capabilities:
✓ Tracking

[Connect]
```

If connected:

``` text
Delhivery
────────────
Status: Connected
Last successful sync: ...
[Disconnect]
```

If failed:

``` text
Delhivery
────────────
Status: Error
Last error: Authentication failed
[Reconnect]
```

Do not expose credentials in the UI after saving.

------------------------------------------------------------------------

# 29. Delhivery Connection Form

The exact fields depend on your Delhivery account/API.

The frontend should not assume fields before confirming the official
authentication contract.

Build the form from the backend-defined requirements where practical.

Conceptual:

``` text
Delhivery Credentials

API Key / Token
[________________]

[Validate & Connect]
```

If more fields are required:

``` text
Client ID
Username
Password
API Key
```

only expose the fields actually required.

------------------------------------------------------------------------

# 30. `AddShipmentDialog.tsx`

Delhivery should appear as:

``` text
Carrier
[ India Post ▼ ]

India Post
DTDC
Delhivery
Manual
```

When:

``` text
carrier = DELHIVERY
```

the AWB field remains generic:

``` text
AWB Number
[________________]
```

Do not create:

``` text
Delhivery AWB field
```

because `awb_number` is already carrier-agnostic.

------------------------------------------------------------------------

# 31. `Tracking.tsx`

Carrier selection should come from the backend.

Conceptual:

``` text
Carrier:
[ Delhivery ▼ ]

AWB:
[ 123456789 ]

[Track]
```

Response:

``` text
DELHIVERY
123456789

● Picked Up
│
● In Transit
│
● Arrived at Ahmedabad
│
● Out for Delivery
```

The UI should use normalized statuses rather than hard-coded Delhivery
raw strings.

------------------------------------------------------------------------

# 32. Frontend Status Rendering

Frontend should understand:

``` text
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

It should not need:

``` text
"Shipment Delivered"
"DELIVERED TO CUSTOMER"
"Package Delivered Successfully"
```

because those are carrier-specific.

------------------------------------------------------------------------

# 33. Phase 11 --- Carrier Health

Existing endpoint:

``` http
GET /api/v1/carriers/health
```

should support:

``` text
DELHIVERY
```

Example:

``` json
{
  "code": "DELHIVERY",
  "status": "HEALTHY",
  "last_success_at": "2026-10-08T18:00:00",
  "last_error_message": null
}
```

On failure:

``` json
{
  "code": "DELHIVERY",
  "status": "ERROR",
  "last_success_at": "2026-10-08T17:30:00",
  "last_error_message": "Authentication failed"
}
```

------------------------------------------------------------------------

# 34. Phase 12 --- Database Migration

A migration may NOT be necessary if:

``` text
carrier_code
```

already accepts arbitrary provider codes.

Check whether it is:

``` text
VARCHAR
```

or an enum/check constraint.

If it uses a database enum or check constraint, add:

``` text
DELHIVERY
```

through an Alembic migration.

Example conceptual migration:

``` text
0012_add_delhivery_carrier
```

Do not create a new table only for Delhivery unless there is a genuine
Delhivery-specific data requirement.

------------------------------------------------------------------------

# 35. Optional `tracking_provider` Migration

If you decide to implement the architecture improvement now, add:

``` text
tracking_provider
```

to `Shipment`.

Migration:

``` text
0013_add_tracking_provider
```

Existing shipments can default to:

``` text
tracking_provider = carrier_code
```

or remain nullable depending on the current architecture.

This is optional for phase 1 but recommended if you know ShipSagar will
remain a fallback/aggregator.

------------------------------------------------------------------------

# 36. Phase 13 --- Unit Tests

Create:

``` text
backend/tests/carriers/test_delhivery.py
```

Minimum tests:

### Provider registration

``` text
get_provider("DELHIVERY")
```

must return:

``` text
DelhiveryProvider
```

------------------------------------------------------------------------

### Capabilities

Verify:

``` text
TRACKING
```

is present.

------------------------------------------------------------------------

### Status normalization

Test:

``` text
Delivered
Out for Delivery
In Transit
RTO
Returned
Lost
Failed Attempt
Unknown
```

against the expected internal status.

------------------------------------------------------------------------

### Tracking response parsing

Use mocked API responses.

Do NOT call the real Delhivery API in normal unit tests.

------------------------------------------------------------------------

### Invalid response

Test malformed responses.

Expected:

``` text
controlled parsing error
```

rather than:

``` text
500 Internal Server Error
```

------------------------------------------------------------------------

# 37. Phase 14 --- API Integration Tests

Test:

``` text
POST /api/v1/carriers/DELHIVERY/connect
```

with:

-   Valid credentials.
-   Invalid credentials.
-   Missing credentials.

Test:

``` text
GET /api/v1/carriers
```

and verify Delhivery appears.

Test:

``` text
GET /api/v1/carriers/health
```

and verify Delhivery health is returned.

Test:

``` text
GET /api/v1/shipments/{id}/tracking
```

for a Delhivery shipment.

------------------------------------------------------------------------

# 38. Phase 15 --- End-to-End Test

Use a real Delhivery test/production account according to the API's
available environment.

Test this complete flow:

``` text
1. Connect Delhivery
        ↓
2. Credentials validated
        ↓
3. CarrierConnection saved
        ↓
4. Create shipment
        ↓
5. carrier_code = DELHIVERY
        ↓
6. Enter AWB
        ↓
7. Save shipment
        ↓
8. Open tracking
        ↓
9. Backend resolves DELHIVERY provider
        ↓
10. Delhivery API called
        ↓
11. Response normalized
        ↓
12. ShipmentEvent created
        ↓
13. Shipment status updated
        ↓
14. Frontend displays tracking
```

This is the acceptance test for the integration.

------------------------------------------------------------------------

# 39. Logging Strategy

Use structured logs.

Example:

``` text
carrier=DELHIVERY
action=TRACK
shipment_id=123
awb=********789
result=SUCCESS
duration_ms=428
```

Failure:

``` text
carrier=DELHIVERY
action=TRACK
shipment_id=123
awb=********789
result=ERROR
error_type=TIMEOUT
```

Never log:

``` text
API token
password
authorization header
encrypted credentials
full credential payload
```

------------------------------------------------------------------------

# 40. Observability Metrics

If your project already supports metrics, track:

``` text
delhivery_tracking_requests_total
delhivery_tracking_success_total
delhivery_tracking_failure_total
delhivery_tracking_timeout_total
delhivery_tracking_latency
```

Useful operational values:

``` text
Success rate
Average response time
Failure rate
Timeout rate
Authentication failures
Unknown status count
```

------------------------------------------------------------------------

# 41. Background Tracking

If the application periodically refreshes shipment tracking, Delhivery
should use the same background tracking mechanism as existing carriers.

Do not create a Delhivery-specific scheduler.

Preferred:

``` text
Tracking Scheduler
        ↓
Shipment
        ↓
carrier_code
        ↓
Provider Registry
        ↓
DelhiveryProvider
```

This makes future carriers automatic.

------------------------------------------------------------------------

# 42. Webhooks

Do not implement Delhivery webhooks merely because the provider
interface supports:

``` text
WEBHOOK
```

First confirm whether your Delhivery API/account provides webhook/event
support that fits your use case.

Phase 1 can safely use:

``` text
polling
```

if that is what your current system supports.

If webhooks are added later:

``` text
Delhivery webhook
       ↓
signature verification
       ↓
event parsing
       ↓
status normalization
       ↓
ShipmentEvent
       ↓
Shipment update
```

------------------------------------------------------------------------

# 43. ShipSagar Compatibility

Do not remove ShipSagar.

The resulting architecture should allow:

``` text
DELHIVERY
    ├── Direct Delhivery API
    │
    └── ShipSagar
```

But phase 1 should implement only the selected primary route.

If direct Delhivery tracking is implemented first:

``` text
carrier_code = DELHIVERY
tracking_provider = DELHIVERY
```

Later, ShipSagar can be supported:

``` text
carrier_code = DELHIVERY
tracking_provider = SHIPSAGAR
```

This should not require changing the Shipment schema again.

------------------------------------------------------------------------

# 44. Security Requirements

Before production:

-   Encrypt credentials at rest.
-   Use HTTPS for Delhivery API requests.
-   Never log secrets.
-   Restrict carrier connection management to authorized roles.
-   Validate all request inputs.
-   Sanitize API error messages.
-   Set HTTP timeouts.
-   Avoid arbitrary URLs supplied by users.
-   Do not allow users to select a provider that is not registered.
-   Do not expose decrypted credentials through API responses.
-   Keep carrier credentials scoped to the correct tenant/store/account.

------------------------------------------------------------------------

# 45. Performance Requirements

Tracking should not block unnecessarily.

Use:

``` text
HTTP timeout
```

and, where appropriate:

``` text
background refresh
```

For a user-triggered tracking request:

``` text
Frontend
   ↓
Backend
   ↓
Delhivery API
   ↓
Response
```

For bulk synchronization:

``` text
Scheduler
   ↓
Queue/background task
   ↓
Delhivery API
```

Do not make a large shipment list trigger hundreds of synchronous
Delhivery requests from a single frontend request.

------------------------------------------------------------------------

# 46. Rate Limiting Strategy

If many shipments need tracking:

``` text
1000 shipments
```

do not execute:

``` text
1000 simultaneous API calls
```

Use:

``` text
batching
concurrency limit
retry/backoff
```

Example conceptual flow:

``` text
1000 shipments
      ↓
Batch 1: 25
Batch 2: 25
Batch 3: 25
...
```

The exact limits must follow the Delhivery API/account restrictions.

------------------------------------------------------------------------

# 47. Recommended File Changes

## New files

``` text
backend/app/carriers/delhivery.py
backend/tests/carriers/test_delhivery.py
```

Potentially:

``` text
backend/app/integrations/delhivery_client.py
```

if you separate provider logic from HTTP clients.

------------------------------------------------------------------------

## Files likely to modify

``` text
backend/app/carriers/registry.py

backend/app/models/shipment.py
    # only if tracking_provider or enum changes are needed

backend/app/api/carriers.py
    # if hard-coded carrier metadata exists

backend/app/api/shipments.py
    # only if tracking routing needs modification

backend/app/services/<tracking service>
    # wherever provider resolution/tracking persistence occurs

frontend/src/.../CarriersSettings.tsx
frontend/src/.../AddShipmentDialog.tsx
frontend/src/.../Tracking.tsx
frontend/src/.../Shipments.tsx
frontend/src/.../api.ts
```

------------------------------------------------------------------------

# 48. Do Not Modify Unnecessarily

Do NOT modify:

``` text
India Post implementation
DTDC implementation
ShipSagar implementation
```

unless the audit reveals that they depend on hard-coded carrier
assumptions.

Adding Delhivery should be an additive change.

------------------------------------------------------------------------

# 49. Implementation Checklist

## Backend foundation

-   [ ] Audit `CarrierProvider`.
-   [ ] Audit provider registry.
-   [ ] Audit credential loading.
-   [ ] Audit shipment tracking service.
-   [ ] Audit event persistence.
-   [ ] Confirm supported carrier-code format.

## Delhivery provider

-   [ ] Create `delhivery.py`.
-   [ ] Implement `capabilities()`.
-   [ ] Implement `validate_credentials()`.
-   [ ] Implement `get_tracking()`.
-   [ ] Implement `normalize_status()`.
-   [ ] Implement `build_tracking_url()`.
-   [ ] Add safe unknown-status handling.
-   [ ] Add API timeout handling.
-   [ ] Add API error handling.

## Registry

-   [ ] Register `DELHIVERY`.
-   [ ] Verify `get_provider("DELHIVERY")`.

## Credentials

-   [ ] Confirm official Delhivery authentication requirements.
-   [ ] Add required configuration/credential schema.
-   [ ] Encrypt credentials.
-   [ ] Validate before saving.
-   [ ] Prevent credential logging.

## Database

-   [ ] Check whether `carrier_code` supports `DELHIVERY`.
-   [ ] Create migration only if required.
-   [ ] Decide whether to add `tracking_provider`.
-   [ ] Add migration if required.

## Tracking

-   [ ] Call Delhivery API.
-   [ ] Parse response.
-   [ ] Normalize status.
-   [ ] Normalize events.
-   [ ] Persist `ShipmentEvent`.
-   [ ] Deduplicate events.
-   [ ] Update `Shipment`.
-   [ ] Preserve raw carrier status.

## Backend API

-   [ ] Delhivery appears in `/carriers`.
-   [ ] Connect endpoint works.
-   [ ] Disconnect endpoint works.
-   [ ] Health endpoint works.
-   [ ] Tracking endpoint works.

## Frontend

-   [ ] Remove/avoid hard-coded carrier lists where possible.
-   [ ] Delhivery appears in carrier settings.
-   [ ] Delhivery connection form works.
-   [ ] Delhivery appears in shipment creation.
-   [ ] Delhivery appears in tracking.
-   [ ] Normalized statuses render correctly.
-   [ ] API errors render correctly.

## Testing

-   [ ] Unit tests.
-   [ ] Mock API tests.
-   [ ] Authentication tests.
-   [ ] Invalid AWB tests.
-   [ ] Timeout tests.
-   [ ] Malformed response tests.
-   [ ] Event deduplication tests.
-   [ ] End-to-end real API test.

## Production

-   [ ] Secrets verified.
-   [ ] HTTPS verified.
-   [ ] Logging verified.
-   [ ] Health monitoring verified.
-   [ ] Rate limits reviewed.
-   [ ] Retry strategy verified.
-   [ ] Rollback plan prepared.

------------------------------------------------------------------------

# 50. Acceptance Criteria

The Delhivery integration is considered complete only when all of the
following are true:

### Carrier registration

``` text
GET /api/v1/carriers
```

returns:

``` text
DELHIVERY
```

with the correct capabilities.

### Connection

An administrator can connect Delhivery credentials and the system
validates them before saving.

### Shipment creation

A shipment can be created with:

``` text
carrier_code = DELHIVERY
```

and an AWB.

### Tracking

A valid Delhivery AWB can be tracked through the existing tracking API.

### Normalization

Delhivery-specific statuses are converted into the application's
standard statuses.

### Event history

Tracking checkpoints are stored in:

``` text
ShipmentEvent
```

without creating duplicates on repeated tracking calls.

### Current state

The latest tracking state updates:

``` text
Shipment.tracking_status
Shipment.current_location
Shipment.delivered_at
```

where appropriate.

### Frontend

Users can:

``` text
Connect Delhivery
Select Delhivery
Enter Delhivery AWB
Track shipment
View tracking history
```

### Failure handling

Invalid credentials, invalid AWBs, API errors, timeouts, and malformed
responses do not crash the application.

------------------------------------------------------------------------

# 51. Recommended Development Order

Implement in exactly this order:

``` text
STEP 1
Audit current carrier architecture
        ↓
STEP 2
Confirm official Delhivery API + authentication contract
        ↓
STEP 3
Create Delhivery HTTP client
        ↓
STEP 4
Create DelhiveryProvider
        ↓
STEP 5
Implement credential validation
        ↓
STEP 6
Implement tracking request
        ↓
STEP 7
Implement response normalization
        ↓
STEP 8
Implement status mapping
        ↓
STEP 9
Register provider
        ↓
STEP 10
Connect provider to existing tracking service
        ↓
STEP 11
Persist ShipmentEvents
        ↓
STEP 12
Update Shipment current state
        ↓
STEP 13
Add backend tests
        ↓
STEP 14
Expose Delhivery through carrier API
        ↓
STEP 15
Update Carrier Settings UI
        ↓
STEP 16
Update Add Shipment UI
        ↓
STEP 17
Update Tracking UI
        ↓
STEP 18
Run end-to-end testing
        ↓
STEP 19
Add health monitoring
        ↓
STEP 20
Production rollout
```

------------------------------------------------------------------------

# 52. Definition of Done

The implementation should **not** be considered done merely because:

``` text
DelhiveryProvider exists
```

It is done when:

``` text
Delhivery API
      ↓
DelhiveryProvider
      ↓
Provider Registry
      ↓
Shipment Tracking Service
      ↓
ShipmentEvent
      ↓
Shipment
      ↓
Backend API
      ↓
Frontend
```

works as one complete flow.

The most important architectural rule is:

> **Delhivery-specific logic stays inside the Delhivery adapter/client.
> The rest of the application works with the platform's common carrier
> and shipment abstractions.**

This keeps the next integrations---Blue Dart and any future
courier---small, predictable additions instead of requiring another
redesign.
