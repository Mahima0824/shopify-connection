# Real-World MVP Implementation Plan
## Shopify + Central Barcode + Warehouse Scanning + Courier Tracking + Statement Reconciliation + Monthly P&L

**Status:** Implementation specification for the next production-focused phase

**Current stack**
- Backend: FastAPI, SQLAlchemy 2.0, Alembic
- Frontend: Next.js 14 App Router, TypeScript
- Database: Supabase PostgreSQL
- Auth: JWT Bearer, roles ADMIN / WAREHOUSE / ACCOUNTANT / VIEWER
- Current Shopify integration: API pull + webhooks + CSV import
- Current reconciliation: R001-R008
- Current reporting: dashboard + Excel + Tally mappings/export
- New primary modules: barcode generation, barcode scanning, shipment/AWB tracking, courier reconciliation, SLA monitoring, statement reconciliation, profitability

---

# 1. Product Objective

The product is an operational reconciliation layer between:

```text
Shopify
Warehouse reality
Courier/delivery partner reality
Payment/settlement reality
Accounting/reporting
```

The system should answer four questions for every order:

```text
1. What happened to the order?
2. Where is the physical parcel?
3. Where is the money?
4. Is anything wrong that requires action?
```

The core product loop is:

```text
SHOPIFY ORDER
   -> INTERNAL ORDER
   -> INTERNAL PARCEL
   -> INTERNAL BARCODE
   -> WAREHOUSE DISPATCH SCAN
   -> COURIER + AWB
   -> COURIER TRACKING
   -> DELIVERED / RTO / RETURN
   -> RETURN SCAN
   -> PAYMENT / REFUND / SETTLEMENT
   -> RECONCILIATION
   -> MONTHLY REPORT / P&L
   -> TALLY EXPORT
```

---

# 2. Current System vs Target System

## Current system

Already available:

```text
Shopify connection
Shopify order pull
30-day sync
Realtime webhooks
HMAC verification
Webhook idempotency
Webhook retries
Shopify CSV import
Refund rows
Orders page
Basic parcel support
R001-R008 reconciliation
Exceptions queue
Reason-gated resolution
Audit log
Order timeline
Dashboard KPIs
Financial dashboard
Tally mappings
Tally validation
Tally export batches
Excel export
Backend tests
Frontend tests
TypeScript clean
```

## Missing / incomplete

```text
Barcode generator
Printable barcode labels
Warehouse dispatch scanner
Warehouse return scanner
Warehouse RTO scanner
Internal barcode lifecycle
Internal barcode <-> courier AWB relationship
Shipment entity
Shipment event history
Carrier abstraction
Carrier credentials
Carrier tracking sync
Carrier webhooks if available
Courier SLA monitoring
Outstanding parcel dashboard
Courier settlement/collection reconciliation
Monthly statement workflow
Statement <-> order/shipment matching
Management P&L with configurable costs
Production security hardening
```

---

# 3. Priority Order

## P0 - Production safety blockers

Must be completed before putting real customer credentials/data into production.

```text
[ ] Strong JWT_SECRET
[ ] Generate ENCRYPTION_KEY
[ ] Encrypt Shopify tokens at rest
[ ] Encrypt courier/API credentials at rest
[ ] Remove development CORS-seed logic
[ ] Remove development seed code from production entrypoint
[ ] Fix GET /tally/batches serialization failure
[ ] Verify webhook authenticity validation
[ ] Verify secure cookie / token handling
[ ] Review Git history for secrets
[ ] Production database backups
[ ] Production logging review
```

## P1 - Barcode and warehouse operations

```text
[ ] Internal parcel ID generation
[ ] Code128 barcode generation
[ ] Label generation
[ ] Print/reprint
[ ] Backfill existing orders
[ ] USB scanner input
[ ] Dispatch scanner
[ ] Return scanner
[ ] RTO scanner
[ ] Duplicate scan prevention
[ ] Concurrent scan protection
```

## P2 - Courier shipment tracking

```text
[ ] Shipment model
[ ] AWB model/link
[ ] Carrier abstraction
[ ] Carrier credentials
[ ] First carrier integration
[ ] Tracking event ingestion
[ ] Status normalization
[ ] Active shipment sync
[ ] Carrier webhook support where available
[ ] Shipment detail page
```

## P3 - Courier outstanding/SLA

```text
[ ] SLA configuration
[ ] Shipment aging
[ ] Approaching-SLA detection
[ ] SLA breach detection
[ ] Outstanding shipment dashboard
[ ] Money-at-risk calculation
[ ] Follow-up/case management
```

## P4 - Monthly statement and money reconciliation

```text
[ ] Statement upload
[ ] CSV/XLSX parser
[ ] Column mapping
[ ] Dry run
[ ] Exact-match engine
[ ] Manual-match UI
[ ] Unmatched/conflict queue
[ ] Settlement records
[ ] Expected vs received vs pending
```

## P5 - Monthly reporting and profitability

```text
[ ] Monthly order report
[ ] Courier report
[ ] Return/RTO report
[ ] Money report
[ ] Exception report
[ ] Product cost
[ ] Shipping cost
[ ] Gateway fee
[ ] Packaging cost
[ ] Return/RTO cost
[ ] Management P&L
```

## P6 - Tally

Keep current Tally work, but make it downstream of reconciled data rather than the next major product milestone.

---

# 4. Non-Negotiable Identifier Model

Do not use one identifier for everything.

```text
Shopify Order ID
        |
        v
Internal Order Number
        |
        v
Internal Parcel ID / Barcode
        |
        v
Shipment
        |
        v
Courier + AWB
```

Example:

```text
Shopify Order: #10521
Internal Order: ORD-00010521
Parcel: PKG-00010521
Courier: DTDC
AWB: D123456789
```

The internal barcode identifies the seller's parcel record.

The AWB identifies the shipment inside the courier network.

They must remain separate but linked.

---

# 5. Target Domain Model

```text
Business
  |
  +-- Shopify Store
  |
  +-- Users
  |
  +-- Orders
         |
         +-- Order Items
         |
         +-- Payments
         |
         +-- Refunds
         |
         +-- Returns
         |
         +-- Parcel
                |
                +-- Barcode
                |
                +-- Shipment
                       |
                       +-- Carrier
                       +-- AWB
                       +-- Shipment Events
                       +-- SLA
                       +-- Shipment Financials
                       +-- Shipment Cases
         |
         +-- Reconciliation Issues
```

---

# 6. Database Changes

The actual migration numbers must follow the existing database head. Do not blindly create duplicate tables if a current migration already contains part of the required structure.

Recommended new logical migrations:

```text
barcode_upgrade
shipments
shipment_events
carrier_connections
carrier_sla_rules
shipment_financials
statement_uploads
statement_rows
shipment_cases
notifications
product_cost_history
background_jobs
```

---

# 7. Parcel Model

Extend the parcel model to include:

```text
id UUID PK
business_id UUID FK
order_id UUID FK

parcel_code VARCHAR NOT NULL
barcode_value VARCHAR NOT NULL
barcode_format VARCHAR NOT NULL
barcode_version VARCHAR NULL

status VARCHAR NOT NULL

created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraints:

```text
UNIQUE(business_id, parcel_code)
UNIQUE(business_id, barcode_value)
```

MVP assumption:

```text
1 order -> 1 parcel
```

Architecture should still support later:

```text
1 order -> many parcels
```

---

# 8. Barcode Generation

## Goal

Every eligible parcel gets a persistent internal barcode.

Recommended value:

```text
PKG-00000001
```

The generator must be:

```text
unique
concurrency-safe
idempotent
non-sensitive
stable for the life of the parcel
```

Do not generate a new barcode every time Shopify updates an order.

---

# 9. Barcode Service

Create:

```text
backend/app/services/barcode_service.py
```

Responsibilities:

```text
generate_parcel_code()
generate_barcode_image()
generate_label()
validate_barcode()
backfill_missing_barcodes()
```

Recommended implementation flow:

```text
Order imported
   |
   v
Does parcel exist?
   | yes -> return existing parcel
   | no
   v
Generate unique parcel code
   |
   v
Generate Code128 barcode
   |
   v
Store metadata
```

---

# 10. Barcode Label

Minimum label:

```text
-------------------------------------
BUSINESS NAME

Order: #10521
Parcel: PKG-00010521

Customer: Rahul

[ CODE 128 BARCODE ]

PKG-00010521
-------------------------------------
```

Do not put unnecessary customer information on the label.

MVP print options:

```text
Browser print
A4 labels
PDF download
Batch print
Reprint
```

Later:

```text
4x6 thermal labels
Direct thermal printer support
Printer service
```

---

# 11. Existing-Order Barcode Backfill

Because the system already contains orders, create a safe backfill operation.

Endpoint:

```http
POST /api/v1/parcels/backfill
```

Process:

```text
Find eligible orders with no parcel
        -> create parcel
        -> generate barcode
        -> save
```

The operation must be idempotent.

Second run must not create duplicates.

---

# 12. Barcode Label Management UI

Add:

```text
/parcels/labels
```

Features:

```text
Today's labels
Missing labels
Selected labels
Print
Download
Reprint
Search by order/barcode
```

Example:

```text
Orders without barcode: 12

[Generate Missing]

[ ] #10521
[ ] #10522
[ ] #10523

[Print Selected]
```

---

# 13. Warehouse Dispatch Scanner

Create:

```text
/scan/dispatch
```

Primary workflow:

```text
Worker opens scanner
        -> input automatically focused
        -> scans internal barcode
        -> backend lookup
        -> validation
        -> show order summary
        -> confirm if required
        -> create dispatch event
        -> update parcel
        -> update operational status
        -> refocus input
```

---

# 14. Scanner Hardware Strategy

## MVP primary method

USB barcode scanner acting as a keyboard/HID device.

Architecture:

```text
USB Scanner
   -> Browser input
   -> POST /scan/dispatch
```

No native driver-specific application should be required for the MVP.

## Secondary method

Mobile camera scanning:

```text
/scan/mobile
```

Add this after USB scanning is stable.

---

# 15. Dispatch Scanner UX

```text
DISPATCH SCANNER

[ Scan Parcel Barcode________________ ]

LAST SCAN
--------------------------------------
Order: #10521
Customer: Rahul
Amount: ₹1,499
Payment: PAID
Parcel: PKG-00010521

Status: READY TO DISPATCH

[DISPATCH]
```

After success:

```text
✅ DISPATCH SUCCESSFUL

Order #10521
Parcel PKG-00010521
14:25
Worker: Raj

[SCAN NEXT]
```

Auto-focus the scanner field after completion.

---

# 16. Dispatch Validation Rules

Before allowing dispatch:

```text
1. Barcode exists
2. Parcel belongs to current business
3. User has WAREHOUSE permission
4. Order is not cancelled
5. Parcel has not already been dispatched
6. Parcel has not already been returned/closed
7. Required shipment/AWB workflow is satisfied if configured
```

Errors must be explicit.

Example:

```text
❌ ORDER CANCELLED

Shopify cancellation detected at 13:42.
This parcel cannot be dispatched.
```

---

# 17. Dispatch Database Transaction

Use a transaction and row lock.

Conceptually:

```text
BEGIN

SELECT parcel FOR UPDATE

validate current state

create scan_event(DISPATCHED)

update parcel.status
update order.operational_status

create/update shipment if applicable
create audit record

COMMIT
```

This protects against two workers scanning the same parcel at the same time.

---

# 18. Duplicate and Concurrency Tests

Test:

```text
Worker A scans PKG001
Worker B scans PKG001 simultaneously
```

Expected:

```text
A -> DISPATCHED
B -> PARCEL_ALREADY_DISPATCHED
```

Only one dispatch event may be persisted.

---

# 19. Return Scanner

Create:

```text
/scan/return
```

RTO can either be a separate route or an action inside the return scanner.

Workflow:

```text
Return parcel arrives
   -> scan internal barcode
   -> find parcel/order
   -> show courier + AWB
   -> select return type
   -> select reason
   -> select condition
   -> enter returned quantities
   -> confirm
   -> create return
   -> create event
   -> update warehouse state
   -> run reconciliation
```

---

# 20. Return Types

MVP:

```text
CUSTOMER_RETURN
RTO
PARTIAL_RETURN
```

Reasons:

```text
CUSTOMER_CHANGED_MIND
SIZE_ISSUE
WRONG_PRODUCT
DAMAGED
ADDRESS_ISSUE
CUSTOMER_REJECTED
DELIVERY_FAILED
OTHER
```

Conditions:

```text
GOOD
DAMAGED
USED
WRONG_PRODUCT
MISSING_ITEM
```

These lists should eventually be configurable.

---

# 21. Partial Return Model

Do not assume a whole order is returned.

Example:

```text
Ordered:
T-shirt x 3

Returned:
T-shirt x 1
```

Add return items:

```text
return_items

id
return_id
order_item_id
quantity
condition
```

Reject:

```text
returned_quantity > ordered_quantity
```

---

# 22. Shipment Model

Create:

```text
shipments
```

Fields:

```text
id UUID PK
business_id UUID FK
order_id UUID FK
parcel_id UUID FK

carrier_code VARCHAR
awb_number VARCHAR

tracking_status VARCHAR
carrier_status_raw VARCHAR NULL

current_location VARCHAR NULL
last_checkpoint_message TEXT NULL
last_checkpoint_at TIMESTAMP NULL

tracking_url TEXT NULL
estimated_delivery_at TIMESTAMP NULL

shipped_at TIMESTAMP NULL
delivered_at TIMESTAMP NULL
rto_at TIMESTAMP NULL
returned_at TIMESTAMP NULL

last_synced_at TIMESTAMP NULL

created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```text
UNIQUE(business_id, carrier_code, awb_number)
```

---

# 23. Shipment Event Model

Create:

```text
shipment_events
```

Fields:

```text
id
business_id
shipment_id
carrier_event_id
carrier_status_raw
normalized_status
message
location
event_time
received_at
source
raw_payload_json
created_at
```

Store the raw carrier event for debugging, but protect it as operational/customer data.

---

# 24. Shipment Status Model

Your database must preserve raw carrier status AND your normalized status.

Normalized statuses:

```text
BOOKED
PICKED_UP
IN_TRANSIT
AT_HUB
OUT_FOR_DELIVERY
DELIVERED
DELIVERY_EXCEPTION
RTO_INITIATED
RTO_IN_TRANSIT
RETURN_AT_HUB
RETURNED
LOST
DAMAGED
UNKNOWN
```

Example:

```text
Carrier raw status:
"Arrived at Ahmedabad DC"

Your normalized status:
AT_HUB
```

Never discard the raw carrier status.

---

# 25. Internal Physical Return vs Courier Return

These are different facts.

Courier says:

```text
RETURNED_TO_SELLER
```

Warehouse says:

```text
RETURN NOT RECEIVED
```

The system must be able to show:

```text
Courier return state:
RETURNED

Warehouse return state:
RETURN_EXPECTED

Exception:
RETURN NOT PHYSICALLY RECEIVED
```

When the warehouse scans the parcel:

```text
Warehouse state:
RETURN_RECEIVED
```

This distinction is one of the strongest reasons for your internal barcode system.

---

# 26. Carrier Architecture

Do not put DTDC-specific code into general order logic.

Create:

```text
backend/app/carriers/

base.py
registry.py
dtdc.py
tirupati.py
india_post.py
tracking_provider.py
```

Base interface:

```python
class CarrierProvider:
    def validate_credentials(self): ...
    def get_tracking(self, awb: str): ...
    def normalize_status(self, response): ...
    def build_tracking_url(self, awb: str): ...
```

Your business logic should depend on `CarrierProvider`, not directly on one courier.

---

# 27. Carrier Connections

Create:

```text
carrier_connections
```

Fields:

```text
id
business_id
carrier_code
credentials_encrypted
environment
is_active
last_success_at
last_error_at
last_error_message
created_at
updated_at
```

Never return decrypted credentials to the frontend.

---

# 28. Carrier Capabilities

Different carriers may provide different capabilities.

Represent:

```text
TRACKING
WEBHOOKS
AWB_VALIDATION
COD_DATA
SETTLEMENT_DATA
PICKUP_CREATION
LABEL_GENERATION
```

Do not promise functionality the connected provider does not actually expose.

---

# 29. DTDC Integration

DTDC currently states that it provides API/plugin integrations for e-commerce and that its enterprise logistics offering supports API-based integration with ERP/WMS/e-commerce systems for syncing and tracking. The actual credentials, endpoints, quotas, and capabilities must be obtained and verified with the customer's DTDC account. 

Implementation workflow:

```text
Customer has DTDC business account
        -> request API integration access
        -> receive credentials/documentation
        -> save encrypted credentials
        -> implement DTDC adapter
        -> track AWBs
        -> normalize statuses
        -> store shipment events
```

Do not build the production integration by scraping the public tracking page.

---

# 30. India Post Integration

India Post has published business/parcel material describing end-to-end tracking and API integration for bulk customers/business partners. Actual API access, credentials, supported operations, and authentication must be confirmed for the customer's business arrangement. 

Implementation workflow:

```text
Customer's India Post business arrangement
        -> confirm API access
        -> obtain credentials
        -> implement India Post adapter
        -> normalize events
        -> store checkpoints
```

Do not rely on scraping the public tracking website as the production architecture.

---

# 31. Shree Tirupati Integration

Treat Shree Tirupati as a carrier adapter whose API availability must be confirmed with the customer's account/provider representative before implementation.

Request:

```text
Tracking API
Authentication details
AWB lookup endpoint
Webhook capability
RTO status support
Return status support
COD/settlement data availability
Rate limits
```

Do not assume public website tracking is equivalent to a supported B2B API.

---

# 32. Tracking Aggregator Option

Architect the system so a commercial tracking aggregator can be plugged in.

```text
Your application
      -> TrackingProvider interface
      -> Aggregator
          -> DTDC
          -> Tirupati
          -> India Post
```

Use this when it reduces integration time and the commercial terms make sense.

Before choosing one, validate:

```text
carrier coverage
status completeness
RTO coverage
webhook support
API limits
tracking cost
data retention
settlement support
```

Do not make an aggregator the hidden source of truth without understanding its failure modes.

---

# 33. Carrier Tracking Synchronization

Preferred:

```text
Carrier/provider webhook
       -> your backend
       -> store event
       -> normalize event
       -> update shipment
       -> reconcile
```

Fallback:

```text
Scheduled polling
       -> find active shipments
       -> query tracking API
       -> compare latest event
       -> persist new event
       -> update shipment
```

Stop normal polling after:

```text
DELIVERED
RETURNED
LOST
CLOSED
```

Use more frequent checks for `OUT_FOR_DELIVERY` if API cost/limits allow.

---

# 34. Carrier Webhook Processing

Endpoint:

```http
POST /api/v1/webhooks/{carrier}
```

Flow:

```text
Receive request
   -> authenticate/verify signature if supported
   -> verify business/provider context
   -> store raw event
   -> return success quickly
   -> process asynchronously
   -> normalize status
   -> upsert shipment event
   -> update shipment
   -> run reconciliation
```

Store a provider event ID where available.

Duplicate carrier webhooks must not create duplicate shipment events.

---

# 35. Internal Barcode + AWB Dispatch Flow

Upgrade the current dispatch workflow to:

```text
SCAN INTERNAL BARCODE
        |
        v
PKG-00010521
        |
        v
ORDER FOUND
        |
        v
COURIER SELECTED
        |
        v
SCAN/ENTER AWB
        |
        v
DTDC / D123456789
        |
        v
CREATE SHIPMENT
        |
        v
DISPATCH CONFIRMED
        |
        v
TRACKING STARTED
```

Allow AWB to be:

```text
manually typed
scanned with another barcode scanner
```

---

# 36. Order Detail Page Upgrade

The order page should become the single place to understand an order.

```text
ORDER #10521

CUSTOMER
Rahul

ORDER VALUE
₹1,499

SHOPIFY
Financial: PAID
Fulfillment: FULFILLED
Cancellation: None

PARCEL
PKG-00010521

COURIER
DTDC
AWB: D123456789

TRACKING
IN_TRANSIT
Ahmedabad Hub
Last update: 28 Sep 16:42

MONEY
Expected: ₹1,499
Received: ₹0
Settlement: PENDING

RECONCILIATION
⚠ SETTLEMENT PENDING

TIMELINE
Created
Paid
Packed
Dispatched
Picked Up
In Transit
```

---

# 37. Shipment Detail Page

Create:

```text
/shipments/:id
```

Display:

```text
Order
Parcel
Courier
AWB
Current status
Last location
Last checkpoint
Expected delivery
Full event history
Money status
SLA status
Cases/followups
```

---

# 38. Courier SLA System

Do not globally hard-code the 45-day rule.

Create:

```text
carrier_sla_rules
```

Fields:

```text
id
business_id
carrier_code
event_type
allowed_days
warning_days
enabled
created_at
updated_at
```

Example:

```text
DTDC
RTO
45 days
warning at 7 days before deadline
```

Another carrier/business may have different rules.

---

# 39. SLA Clock Start Event

The SLA must define what starts the clock.

Possible events:

```text
RTO_INITIATED
RETURN_AT_HUB
RETURN_EXPECTED
DELIVERED
SETTLEMENT_DUE
REFUND_INITIATED
```

For each SLA rule store the start event.

Example:

```text
RTO recovery SLA
starts at RTO_INITIATED
```

This prevents incorrect age calculations.

---

# 40. SLA Status

Normalized:

```text
NORMAL
APPROACHING
BREACHED
RESOLVED
```

Example:

```text
Day 38 / 45
APPROACHING

Day 45 / 45
BREACHED

Day 46+
OVERDUE
```

---

# 41. Outstanding Shipment Dashboard

Create:

```text
/shipments/outstanding
```

Columns:

```text
Order
Parcel
Courier
AWB
Current status
Last location
Last event
Last event date
Age
SLA deadline
SLA status
Amount
Money status
Case status
```

Example:

```text
#10521 | PKG001 | DTDC | D123 | RTO | Ahmedabad | 41d | 45d | ₹1,499 | Pending
#10555 | PKG004 | TIRUPATI | T998 | AT_HUB | Surat | 33d | 45d | ₹899 | Pending
```

---

# 42. Outstanding Filters

```text
All
In Transit
At Hub
Out for Delivery
Delivery Exception
RTO
Return Pending
Money Pending
Approaching SLA
SLA Breached
```

Additional filters:

```text
Courier
Date
Amount
Age
Status
Payment method
```

---

# 43. Shipment Cases / Courier Follow-up

Create:

```text
shipment_cases
```

Fields:

```text
id
business_id
shipment_id
case_type
priority
complaint_reference
status
opened_at
last_followup_at
next_followup_at
notes
created_by
resolved_by
resolved_at
created_at
updated_at
```

Case types:

```text
RTO_DELAY
RETURN_DELAY
COD_SETTLEMENT_DELAY
LOST_SHIPMENT
DAMAGED_SHIPMENT
DELIVERY_EXCEPTION
```

This allows the seller to record:

```text
Courier contacted
Ticket number
Expected resolution
Next follow-up
```

---

# 44. Important Separation: Parcel State vs Money State

Never represent these with one status.

Example:

```text
PARCEL
DELIVERED

MONEY
COD SETTLEMENT PENDING
```

Another:

```text
PARCEL
RETURNED

MONEY
REFUND PENDING
```

Store separately:

```text
shipment/tracking status
payment status
refund status
settlement status
reconciliation status
```

---

# 45. Shipment Financial Model

Create a shipment/order settlement record.

Suggested fields:

```text
id
business_id
shipment_id
order_id

expected_cod_amount
collected_amount
settled_amount

fee_amount
other_deduction
net_settlement

settlement_reference
settlement_date

status

created_at
updated_at
```

Statuses:

```text
NOT_APPLICABLE
EXPECTED
COLLECTED
SETTLEMENT_PENDING
PARTIALLY_SETTLED
SETTLED
DISCREPANCY
```

---

# 46. Why Tracking Alone Is Not Enough

Example:

```text
Courier tracking:
DELIVERED

But:
COD settlement not received
```

The system must display:

```text
Parcel: DELIVERED ✅
Money: SETTLEMENT PENDING ⚠
```

Courier tracking and money settlement may come from separate data sources.

Potential money sources:

```text
Courier settlement API
Courier settlement CSV
Bank statement
Payment gateway statement
Manual settlement upload
```

---

# 47. Example: Stuck Return

```text
Order: #10589
Amount: ₹2,199
Parcel: PKG-00010589
Courier: DTDC
AWB: D987654321

Courier state:
RETURN_AT_HUB

Last event:
15 Aug 2026

Today:
28 Sep 2026

Age:
44 days

SLA:
45 days

Refund:
Pending

ACTION:
URGENT
```

The seller should be able to see this without checking every courier AWB manually.

---

# 48. Statement Upload Module

Create:

```text
/statements
```

Supported MVP file types:

```text
CSV
XLSX
```

Flow:

```text
Upload
   -> select statement type
   -> select provider
   -> select period
   -> parse headers
   -> map columns
   -> dry run
   -> validate
   -> import
   -> match
   -> show results
```

---

# 49. Statement Types

Do not treat all uploaded files as generic CSV.

Define:

```text
SHOPIFY_ORDER_EXPORT
COURIER_SETTLEMENT
BANK_STATEMENT
PAYMENT_GATEWAY_STATEMENT
COURIER_SHIPMENT_REPORT
```

Store:

```text
statement_type
provider
period_start
period_end
```

---

# 50. Statement Upload Table

Create:

```text
statement_uploads
```

Fields:

```text
id
business_id
statement_type
provider
period_start
period_end
original_filename
file_hash
row_count
status
uploaded_by
uploaded_at
processed_at
created_at
updated_at
```

Statuses:

```text
UPLOADED
PARSING
READY
PROCESSING
COMPLETED
FAILED
```

---

# 51. Statement Row Table

Create:

```text
statement_rows
```

Fields:

```text
id
statement_upload_id
row_number
external_reference
awb_number
order_reference
transaction_date
gross_amount
fee_amount
net_amount
transaction_type
status
raw_data_json
reconciliation_status
matched_order_id
matched_shipment_id
created_at
updated_at
```

---

# 52. Statement Duplicate Protection

Calculate a file SHA-256 hash.

If the same file is uploaded again:

```text
⚠ THIS STATEMENT IS ALREADY IMPORTED
```

Also protect against duplicate rows inside the file.

---

# 53. Statement Column Mapping

Example uploaded columns:

```text
AWB No
COD Amount
Settlement Date
Net Remittance
```

Map to:

```text
AWB No          -> awb_number
COD Amount      -> expected_cod_amount
Settlement Date -> settlement_date
Net Remittance  -> net_settlement
```

Never assume a provider will always use the exact same column names.

---

# 54. Statement Dry Run

Before import:

```text
Rows found: 1,240
Valid: 1,195
Warnings: 30
Errors: 15
```

Possible errors:

```text
Missing AWB
Invalid date
Invalid amount
Unknown order
Duplicate row
Invalid transaction type
```

User can download an error report.

---

# 55. Statement Matching Strategy

Matching priority:

```text
1. Internal transaction reference
2. Exact AWB
3. Shopify Order ID
4. Shopify Order Number
5. Configured external reference
6. Controlled date/amount match
7. Manual review
```

Do not match purely by amount.

`₹999` can belong to many orders.

---

# 56. Statement Result Types

Every imported row should end as one of:

```text
MATCHED
PARTIALLY_MATCHED
UNMATCHED
DUPLICATE
CONFLICT
IGNORED
```

Example:

```text
Statement AWB D123456789
₹1,499

Matched shipment:
PKG-00010521

Result:
MATCHED
```

---

# 57. Manual Statement Matching

UI:

```text
UNMATCHED ROW

AWB: D123456789
Amount: ₹1,499
Date: 25 Sep

Possible shipments:
#10521 - ₹1,499
#10545 - ₹1,499

[Match #10521]
```

Manual match requires:

```text
user
reason if needed
timestamp
audit record
```

---

# 58. Courier Settlement Reconciliation

For each settlement record calculate:

```text
Expected
Collected
Settled
Fees
Other deductions
Net settlement
Pending
```

Example:

```text
Expected COD          ₹1,499
Collected             ₹1,499
Courier fee              ₹80
Other deduction          ₹10
Net expected          ₹1,409
Settled               ₹0
Pending               ₹1,409
```

Do not compare `order.total` directly with every bank settlement without considering fees/deductions.

---

# 59. Monthly Reconciliation Dashboard

For September:

```text
STATEMENT RECONCILIATION

Uploaded rows            1,240
Matched                  1,180
Unmatched                   32
Duplicates                  10
Conflicts                   18

Expected money          ₹8,50,000
Settled                  ₹8,12,000
Pending                    ₹38,000
```

---

# 60. Reconciliation Engine Expansion

Existing R001-R008 remain.

Add:

```text
R009  DISPATCHED_WITHOUT_SHIPMENT
R010  AWB_MISSING
R011  SHIPMENT_STUCK
R012  RTO_DELAY
R013  RETURN_DELAY
R014  DELIVERED_COD_NOT_SETTLED
R015  SETTLEMENT_AMOUNT_MISMATCH
R016  RETURNED_REFUND_MISSING
R017  REFUND_WITHOUT_RETURN
R018  COURIER_STATUS_UNKNOWN
R019  STATEMENT_ROW_UNMATCHED
R020  DUPLICATE_SETTLEMENT
R021  COURIER_RETURNED_WAREHOUSE_NOT_RECEIVED
R022  SLA_BREACHED
```

---

# 61. Reconciliation Rule Examples

## R009

```text
IF local dispatch exists
AND shipment record does not exist
THEN exception
```

## R010

```text
IF parcel is dispatched
AND courier is required
AND AWB is missing
THEN exception
```

## R011

```text
IF shipment is active
AND current state has exceeded configured threshold
THEN review
```

## R014

```text
IF courier status = DELIVERED
AND payment type = COD
AND settlement is due
AND no settlement exists
THEN exception
```

## R021

```text
IF courier state = RETURNED
AND warehouse return scan does not exist
THEN review/exception
```

## R022

```text
IF SLA deadline passed
AND case not resolved
THEN critical exception
```

---

# 62. Exception Dashboard

Current `/exceptions` should now include courier/settlement issues.

Columns:

```text
Order
Parcel
AWB
Issue
Severity
Amount
Detected at
Age
Status
Action
```

Filter:

```text
Open
Resolved
High
Critical
Courier
Money
Returns
SLA
```

---

# 63. Money-at-Risk Calculation

Add a dashboard KPI:

```text
MONEY AT RISK
₹38,450
```

The definition must be explicit.

Possible components:

```text
unsettled COD
pending refunds
SLA-breached shipment value
```

Do not double-count the same order.

Store the calculation logic in one backend service rather than duplicating it across UI pages.

---

# 64. Monthly Business Report

Route:

```text
/reports/monthly
```

Sections:

```text
Orders
Parcels
Courier
Returns/RTO
Money
Exceptions
Costs
Profitability
```

Period selector:

```text
Month + year
```

Display:

```text
Last generated
Last updated
Source data period
```

---

# 65. Order Metrics

```text
Total Orders
Paid Orders
Unpaid Orders
Cancelled
Packed
Dispatched
Delivered
Returned
RTO
```

---

# 66. Courier Metrics

For each carrier:

```text
Shipment count
Delivered
In Transit
At Hub
Out for Delivery
RTO
Returned
Lost
SLA approaching
SLA breached
Money pending
```

Example:

```text
DTDC       800 orders
Tirupati   300 orders
India Post 140 orders
```

---

# 67. Return Metrics

```text
Customer returns
RTO
Partial returns
Full returns
Good condition
Damaged
Wrong product
Refund pending
Refund completed
```

---

# 68. Money Metrics

```text
Gross sales
Discounts
Refunds
Expected
Collected
Settled
Pending
Fees
Net settlement
```

Keep these separate from profitability.

---

# 69. Profitability Model

Do not call `sales - cash received` profit.

Profitability needs cost information.

Minimum cost inputs:

```text
COGS / product cost
Shipping
Payment gateway fees
Packaging
Return cost
RTO cost
Other configured expenses
```

---

# 70. Product Cost History

Create:

```text
product_cost_history
```

Fields:

```text
id
business_id
product_id
cost_price
currency
effective_from
effective_to
source
created_at
updated_at
```

This prevents old monthly P&L reports from changing because a product cost was edited today.

---

# 71. Cost Sources

Each cost can have a source:

```text
ACTUAL_STATEMENT
COURIER_API
MANUAL
CONFIGURED_DEFAULT
ESTIMATED
```

This lets the business distinguish actual from estimated values.

---

# 72. Management P&L

Example:

```text
SEPTEMBER 2026

REVENUE
Gross Sales                         ₹8,50,000
Discounts                             ₹40,000
Refunds                               ₹55,000
Net Revenue                         ₹7,55,000

COSTS
COGS                                ₹3,80,000
Shipping                              ₹85,000
Gateway Fees                          ₹18,000
Packaging                             ₹12,000
Returns/RTO                           ₹14,000
Other Expenses                        ₹10,000

ESTIMATED OPERATING PROFIT          ₹2,36,000
```

Clearly label the result as a management/profitability figure unless all accounting inputs have been established as complete.

---

# 73. Monthly Report Excel

Workbook:

```text
monthly_report_YYYY-MM.xlsx
```

Sheets:

```text
Summary
Orders
Order_Items
Parcels
Shipments
Shipment_Events
Returns
Payments
Refunds
Money
Statement_Reconciliation
Exceptions
Profitability
```

Use:

```text
freeze panes
filters
currency formats
date formats
conditional formatting
auto-sized columns
summary rows
```

---

# 74. Shipment Excel Columns

```text
Order ID
Internal Parcel ID
Courier
AWB
Shipment Status
Carrier Raw Status
Last Location
Last Event
Last Event Time
Dispatch Time
Delivered Time
RTO Time
Return Time
SLA Deadline
SLA Status
Expected Amount
Collected Amount
Settled Amount
Pending Amount
Money Status
```

---

# 75. Frontend Routes

Add:

```text
/scan/dispatch
/scan/return
/scan/rto

/parcels
/parcels/labels

/shipments
/shipments/outstanding
/shipments/:id

/statements
/statements/:id

/reports/monthly
/reports/courier
/reports/money
/reports/profitability

/settings/barcode
/settings/carriers
/settings/sla
/settings/costs
```

---

# 76. Backend API Additions

## Parcels

```http
GET  /api/v1/parcels
GET  /api/v1/parcels/{id}
POST /api/v1/parcels/backfill
GET  /api/v1/parcels/{id}/label
POST /api/v1/parcels/{id}/label
```

## Scanning

```http
POST /api/v1/scan/dispatch
POST /api/v1/scan/return
POST /api/v1/scan/rto
```

## Shipments

```http
GET  /api/v1/shipments
GET  /api/v1/shipments/{id}
POST /api/v1/shipments
POST /api/v1/shipments/{id}/sync
GET  /api/v1/shipments/{id}/events
```

## Carriers

```http
GET  /api/v1/carriers
GET  /api/v1/carriers/connections
POST /api/v1/carriers/{carrier}/connect
POST /api/v1/carriers/{carrier}/test
DELETE /api/v1/carriers/{carrier}/disconnect
```

## Statements

```http
POST /api/v1/statements/upload
GET  /api/v1/statements
GET  /api/v1/statements/{id}
POST /api/v1/statements/{id}/dry-run
POST /api/v1/statements/{id}/process
GET  /api/v1/statements/{id}/results
```

## Reconciliation

```http
POST /api/v1/reconciliation/order/{id}
POST /api/v1/reconciliation/run
GET  /api/v1/reconciliation/issues
POST /api/v1/reconciliation/issues/{id}/resolve
```

## Reports

```http
GET /api/v1/reports/monthly
GET /api/v1/reports/courier
GET /api/v1/reports/money
GET /api/v1/reports/profitability
```

---

# 77. Error Codes

Barcode:

```text
PARCEL_NOT_FOUND
BARCODE_ALREADY_EXISTS
BARCODE_INVALID
```

Dispatch:

```text
ORDER_CANCELLED
PARCEL_ALREADY_DISPATCHED
PARCEL_ALREADY_RETURNED
SHIPMENT_MISSING
AWB_REQUIRED
```

Return:

```text
RETURN_ALREADY_RECEIVED
INVALID_RETURN_QUANTITY
RETURN_NOT_ALLOWED
```

Carrier:

```text
CARRIER_NOT_CONNECTED
AWB_NOT_FOUND
TRACKING_PROVIDER_ERROR
CARRIER_RATE_LIMIT
```

Statement:

```text
STATEMENT_ALREADY_IMPORTED
INVALID_STATEMENT
MISSING_REQUIRED_COLUMN
DUPLICATE_STATEMENT_ROW
```

---

# 78. Background Jobs

Current FastAPI BackgroundTasks can be kept for lightweight work.

For production-scale carrier tracking and file processing, introduce a queue when needed.

Recommended jobs:

```text
shopify_sync
shopify_webhook_processing
carrier_tracking_sync
carrier_webhook_processing
statement_processing
reconciliation
excel_generation
monthly_report_generation
sla_monitor
```

Possible architecture:

```text
FastAPI
   -> Redis
   -> Worker
```

Do not process very large statement files synchronously inside an API request.

---

# 79. Job Reliability

Create `background_jobs` with:

```text
id
business_id
job_type
entity_type
entity_id
status
attempts
max_attempts
started_at
completed_at
error_message
created_at
updated_at
```

Transient failures should retry.

Permanent validation failures should stop and surface an error.

---

# 80. Authentication and Permissions

Roles:

```text
ADMIN
WAREHOUSE
ACCOUNTANT
VIEWER
```

Warehouse:

```text
View operational order data
Dispatch scan
Return scan
RTO scan
Print labels
```

Accountant:

```text
Financial data
Statement uploads
Money reconciliation
Reports
Exports
Tally
```

Admin:

```text
All
```

Viewer:

```text
Read-only
```

Never rely on frontend hiding buttons as authorization.

---

# 81. Audit Requirements

Audit:

```text
Barcode generation/reprint
Dispatch scan
Return scan
RTO scan
AWB correction
Shipment correction
Manual status override
Statement import
Manual statement match
Reconciliation resolve
SLA configuration
Cost configuration
Carrier connection
Monthly report
Tally export
```

Important mutations need:

```text
user
old value
new value
reason
timestamp
```

---

# 82. Manual Override Policy

Admin-only for important operational corrections.

Example:

```text
AWB changed:
D123456789 -> D123456790

Reason:
Courier handed over corrected AWB.
```

Never silently overwrite important history.

---

# 83. Security Rules

Mandatory:

```text
HTTPS
Strong JWT secret
Encrypted Shopify credentials
Encrypted carrier credentials
HTTP-only secure cookies where used
Backend authorization
Input validation
Rate limiting
Webhook authentication
Audit logs
Database backups
No secrets in Git
No tokens in logs
```

---

# 84. Performance Targets

Practical MVP targets under normal load:

```text
Barcode lookup: < 300 ms
Scan result: < 500 ms
Normal order detail: < 500 ms
Dashboard: < 1-2 sec
```

These are engineering targets, not contractual guarantees.

Index:

```text
business_id + barcode_value
business_id + awb_number
business_id + tracking_status
shipment_id + event_time
statement_upload_id
statement_rows.awb_number
orders.business_id + shopify_order_id
orders.business_id + order_date
```

---

# 85. Data Integrity

Use database constraints for:

```text
unique parcel barcode
unique order/provider references
unique shipment AWB per business/provider
non-negative monetary values
valid foreign keys
```

Do not depend only on Python validation for uniqueness.

---

# 86. Scanner Offline Behavior

Do not implement full offline mode initially.

If the network is unavailable:

```text
NETWORK ERROR

Scan not recorded.
Please reconnect before continuing.
```

Never show "dispatch successful" unless the transaction committed.

Offline scan queuing can be a future feature.

---

# 87. Search Requirements

Search by:

```text
Shopify order number
Internal order ID
Parcel ID
Barcode
Customer name
Customer phone
SKU
Courier
AWB
Tracking number
```

Barcode and AWB lookup should be indexed and fast.

---

# 88. Dashboard Design

Owner dashboard should answer:

```text
ORDERS
Total
Ready to dispatch
Dispatched
Delivered
Returns
RTO

PARCELS
In transit
At hub
Stuck
SLA approaching
SLA breached

MONEY
Expected
Received
Pending
Refund pending

EXCEPTIONS
Open
Critical
```

A warehouse screen should be much simpler and emphasize scanning.

---

# 89. Recommended Warehouse Home

```text
WAREHOUSE

[DISPATCH SCANNER]
[RETURN SCANNER]
[RTO SCANNER]
[PRINT LABELS]

Ready to Dispatch: 42
Dispatched Today: 380
Returns Today: 18
RTO Today: 7
```

---

# 90. Recommended Owner Home

```text
BUSINESS OVERVIEW

Orders today          247
Dispatched             198
Delivered              165
Returns                 18
RTO                     21

Money Expected      ₹3,48,500
Money Received      ₹3,20,400
Money Pending         ₹28,100

Exceptions                7
SLA Breaches               3
Refund Pending             5
```

---

# 91. P1 Implementation Sequence

Implement these before carrier work:

```text
1. Parcel schema review
2. Internal ID generation
3. Code128 generation
4. Label rendering
5. Backfill
6. Label management
7. Dispatch scanner API
8. Dispatch scanner UI
9. Return scanner API
10. Return scanner UI
11. RTO support
12. Concurrency tests
```

Milestone:

```text
Real worker can print a label, place it on a parcel, scan it at dispatch, then scan it again when it physically returns.
```

---

# 92. P2 Implementation Sequence

```text
1. Shipment model
2. Shipment event model
3. Carrier connection model
4. Carrier interface
5. Carrier credential encryption
6. AWB capture in dispatch flow
7. Shipment detail page
8. First carrier integration
9. Event normalization
10. Scheduled synchronization
11. Webhook support
12. Other carrier adapters
```

Milestone:

```text
Internal parcel -> courier AWB -> automatic tracking status.
```

---

# 93. P3 Implementation Sequence

```text
1. SLA rule model
2. SLA calculator
3. Shipment aging query
4. Background SLA monitor
5. Outstanding dashboard
6. Money-at-risk
7. Shipment case/follow-up
8. Notifications
```

Milestone:

```text
Seller can identify the parcels that require courier follow-up without manually checking AWBs.
```

---

# 94. P4 Implementation Sequence

```text
1. Statement upload model
2. CSV/XLSX parser
3. Column mapper
4. Dry-run preview
5. Row persistence
6. Matching engine
7. Manual matching UI
8. Settlement model
9. Money dashboard
10. Reconciliation integration
```

Milestone:

```text
Seller uploads one actual monthly statement and gets matched/unmatched/conflict results.
```

---

# 95. P5 Implementation Sequence

```text
1. Monthly reporting queries
2. Courier summary
3. Return/RTO summary
4. Money summary
5. Exception summary
6. Product cost history
7. Cost configuration
8. Profitability calculation
9. Monthly Excel export
10. Report validation
```

Milestone:

```text
Seller can generate one monthly operational + financial management report.
```

---

# 96. Tally Position

Keep the existing Tally module, but do not use it to define your core domain model.

Correct architecture:

```text
Shopify
 + Barcode
 + Courier
 + Statements
      |
      v
Reconciled internal ledger
      |
      v
Accounting mapping
      |
      v
Tally export
```

Do not make the internal system merely a Tally file generator.

---

# 97. Critical Tally Boundary

The application should not claim:

```text
"We replace Tally."
```

The product should claim, where accurate:

```text
"We reconcile operational e-commerce data and prepare accounting-ready exports."
```

This keeps accounting logic auditable and allows different businesses to use different Tally ledger structures.

---

# 98. Testing Strategy

Use four layers:

```text
Unit
Integration
End-to-end
Concurrency / failure tests
```

---

# 99. Unit Test Requirements

Barcode:

```text
unique generation
format validation
backfill idempotency
```

Scanner:

```text
valid scan
invalid scan
cancelled order
duplicate scan
```

Returns:

```text
full return
partial return
invalid quantity
RTO
```

Courier:

```text
status normalization
unknown status
duplicate event
tracking timeout
```

SLA:

```text
warning
deadline
breach
resolution
```

Statement:

```text
match
unmatched
duplicate
conflict
```

P&L:

```text
revenue
refunds
COGS
shipping
fees
packaging
returns/RTO
```

---

# 100. Integration Test Requirements

Shopify:

```text
order created
order updated
cancelled
refund
fulfillment
webhook duplicate
webhook retry
```

Warehouse:

```text
barcode -> parcel
parcel -> dispatch
parcel -> return
```

Carrier:

```text
AWB -> shipment
tracking event -> shipment
webhook duplicate
API timeout
unknown status
```

Statements:

```text
upload
parse
map
match
manual match
duplicate upload
```

---

# 101. End-to-End Test 1 - Successful Delivery

```text
1. Shopify order created
2. Order synced
3. Parcel created
4. Barcode generated
5. Label printed
6. Warehouse scans dispatch
7. Courier + AWB saved
8. Tracking event arrives
9. Shipment becomes DELIVERED
10. COD settlement statement uploaded
11. Settlement matched
12. Reconciliation passes
13. Monthly report includes order
```

Expected:

```text
Order: reconciled
Parcel: delivered
Money: settled
Exception: none
```

---

# 102. End-to-End Test 2 - RTO/Refund Problem

```text
1. Shopify order
2. Parcel created
3. Dispatch scan
4. AWB linked
5. Courier reports RTO
6. Courier reports return
7. Warehouse has not scanned return yet
8. System shows RETURNED / WAREHOUSE NOT RECEIVED
9. Warehouse scans returned parcel
10. Refund is still missing
11. System creates RETURNED_REFUND_MISSING
12. SLA clock checked
13. Exception resolved after refund
```

---

# 103. Test Data Set

Create at least 30 realistic synthetic cases:

```text
Normal prepaid delivery
Normal COD delivery
Cancelled before packing
Cancelled after packing
Cancelled after dispatch
Customer return
RTO
Partial return
Return + refund
Return + refund pending
Delivered + settlement pending
Settlement amount mismatch
At hub 10 days
At hub near SLA
SLA breached
Unknown carrier status
Duplicate dispatch
Duplicate return
Missing AWB
Wrong AWB
Duplicate statement row
Unmatched statement row
Duplicate settlement
Lost shipment
Damaged shipment
Courier says returned, warehouse not received
Refund without return
Payment missing
Courier tracking timeout
Webhook duplicated
```

---

# 104. Production Monitoring

Monitor:

```text
Shopify sync errors
Shopify webhook failures
Carrier API failures
Carrier webhook failures
Background job failures
Statement processing failures
Database health
API latency
Scan endpoint latency
SLA monitor failures
```

Useful metrics:

```text
active shipments
unreconciled orders
money pending
SLA breaches
failed syncs
failed jobs
```

---

# 105. Backup and Recovery

Production database must have:

```text
automated backups
retention policy
restore procedure
restore test
```

Do not consider backups complete until restoration has actually been tested.

---

# 106. Deployment

Current suggested topology:

```text
Vercel
   -> Next.js frontend

Render/AWS
   -> FastAPI backend

Supabase
   -> PostgreSQL

Redis (when required)
   -> jobs/cache
```

Production domains:

```text
app.example.com
api.example.com
```

Use environment-specific secrets.

---

# 107. Environment Variables

Minimum:

```env
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
ENCRYPTION_KEY=
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_API_VERSION=
NEXT_PUBLIC_API_URL=
```

Additional carrier credentials should be stored through encrypted application configuration, not hard-coded in the frontend.

---

# 108. Customer Onboarding

For an actual pilot:

```text
1. Create business
2. Create admin
3. Connect Shopify OR import Shopify CSV
4. Backfill/create parcels
5. Print barcode labels
6. Add carrier connections
7. Configure SLA
8. Configure cost rules
9. Upload a recent settlement/statement
10. Validate reconciliation
11. Start warehouse scanning
```

---

# 109. Two Shopify Onboarding Modes

## Connected Store

```text
Shopify API
    -> order sync
    -> webhooks
    -> realtime updates
```

## CSV Mode

```text
Shopify export
    -> upload
    -> order import
```

For CSV customers, show:

```text
Connection mode: CSV
Last imported: <timestamp>
Realtime Shopify events: unavailable
```

Do not imply realtime synchronization for CSV-only customers.

---

# 110. Courier Tracking in CSV Mode

Courier tracking should remain independent of Shopify connection mode.

```text
CSV order import
      -> internal order
      -> internal parcel
      -> barcode
      -> AWB
      -> courier tracking
```

This is a strong architectural advantage.

---

# 111. What the System Must Never Do

```text
Never claim money was received because a parcel was delivered.
Never claim a parcel is physically at a hub without carrier evidence.
Never silently change historical scan events.
Never silently overwrite an AWB.
Never create duplicate dispatch events.
Never import the same statement twice.
Never generate duplicate accounting exports.
Never expose API credentials to the frontend.
Never call a management P&L "true accounting profit" unless the required inputs are complete.
```

---

# 112. Pilot Strategy

Use one real seller first.

Recommended starting scope:

```text
1 Shopify store
1 warehouse
2-5 workers
1 accountant
1-3 courier partners
500-5,000 monthly orders
```

Do not onboard many businesses before the first real workflow is stable.

---

# 113. Pilot Week 1

Focus on:

```text
Barcode labels
Dispatch scanner
Return/RTO scanner
```

Measure:

```text
scan time
worker errors
duplicate scans
label issues
return processing time
```

---

# 114. Pilot Week 2

Add:

```text
Courier tracking
AWB association
Shipment detail
Outstanding parcels
SLA
```

Measure:

```text
tracking coverage
unknown status frequency
carrier failures
stuck parcels discovered
```

---

# 115. Pilot Week 3

Add:

```text
Statement upload
Settlement reconciliation
Monthly report
Profitability
```

Measure:

```text
match rate
unmatched rows
money pending discovered
manual corrections
```

---

# 116. Real-World Acceptance Criteria

The MVP is acceptable only when a real business can perform this workflow without manually maintaining a second operational spreadsheet:

```text
Shopify order
   -> internal order
   -> barcode label
   -> warehouse dispatch scan
   -> courier AWB
   -> automatic tracking
   -> delivery / RTO / return
   -> physical return scan
   -> statement upload
   -> order/shipment/money reconciliation
   -> stuck parcel detection
   -> SLA warning/breach
   -> monthly report
   -> profitability report
```

---

# 117. Definition of Done - Barcode

```text
[ ] Every eligible order has a persistent parcel ID
[ ] Code128 generated
[ ] Label printable
[ ] Batch print works
[ ] Reprint works
[ ] Existing orders can be backfilled
[ ] Duplicate barcode prevented
[ ] Barcode lookup is fast
```

---

# 118. Definition of Done - Dispatch

```text
[ ] USB scanner works
[ ] Scan field auto-focuses
[ ] Order loaded immediately
[ ] Cancelled order blocked
[ ] Duplicate dispatch blocked
[ ] Dispatch event audited
[ ] Worker identity stored
[ ] Concurrent scan tested
```

---

# 119. Definition of Done - Return

```text
[ ] Return scanner works
[ ] RTO works
[ ] Partial quantity works
[ ] Reason recorded
[ ] Condition recorded
[ ] Warehouse return state recorded
[ ] Return history preserved
[ ] Reconciliation triggered
```

---

# 120. Definition of Done - Courier

```text
[ ] Internal parcel linked to AWB
[ ] Courier stored separately
[ ] Tracking status stored
[ ] Raw status preserved
[ ] Checkpoint stored
[ ] Duplicate events prevented
[ ] Failed sync retried
[ ] Completed shipments stop polling
[ ] Shipment detail page works
```

---

# 121. Definition of Done - SLA / Outstanding

```text
[ ] SLA configurable per business/carrier/event
[ ] Aging calculated correctly
[ ] Warning status works
[ ] Breach status works
[ ] Outstanding dashboard works
[ ] Amount visible
[ ] Follow-up case can be created
```

---

# 122. Definition of Done - Statement

```text
[ ] CSV/XLSX upload
[ ] File hash
[ ] Dry run
[ ] Column mapping
[ ] Duplicate detection
[ ] Exact AWB matching
[ ] Manual matching
[ ] Unmatched queue
[ ] Settlement records
[ ] Audit
```

---

# 123. Definition of Done - Monthly Report

```text
[ ] Orders
[ ] Dispatch
[ ] Delivery
[ ] Returns
[ ] RTO
[ ] Courier breakdown
[ ] Money expected
[ ] Money settled
[ ] Money pending
[ ] Refund pending
[ ] Exceptions
[ ] Costs
[ ] Profitability
[ ] Excel export
```

---

# 124. Recommended Immediate Work Order

Start from the current repository with this sequence:

```text
STEP 1
Fix P0 security/production blockers.

STEP 2
Review current parcel model and migrations.

STEP 3
Implement internal parcel ID + Code128 generator.

STEP 4
Implement printable label and batch printing.

STEP 5
Backfill all existing eligible orders.

STEP 6
Implement USB dispatch scanner.

STEP 7
Implement return/RTO scanner.

STEP 8
Add shipment + AWB schema.

STEP 9
Modify dispatch flow to capture courier + AWB.

STEP 10
Implement carrier abstraction.

STEP 11
Integrate the first courier using real provider credentials.

STEP 12
Implement tracking events + status normalization.

STEP 13
Add remaining carriers.

STEP 14
Implement SLA/aging/outstanding parcel dashboard.

STEP 15
Build statement upload + reconciliation.

STEP 16
Build settlement/money reconciliation.

STEP 17
Build monthly report + management P&L.

STEP 18
Run real pilot.

STEP 19
Only after the operational ledger is proven, finalize Tally automation.
```

---

# 125. Final System Architecture

```text
                         SHOPIFY
                            |
                  API / CSV / WEBHOOK
                            |
                            v
                    ┌───────────────┐
                    │  ORDER CORE   │
                    └───────┬───────┘
                            |
                            v
                    INTERNAL PARCEL
                            |
                            v
                    INTERNAL BARCODE
                            |
              ┌─────────────┴─────────────┐
              |                           |
              v                           v
       DISPATCH SCAN                RETURN/RTO SCAN
              |                           |
              └─────────────┬─────────────┘
                            v
                        SHIPMENT
                            |
                    COURIER + AWB
                            |
          ┌─────────────────┼─────────────────┐
          v                 v                 v
        DTDC             TIRUPATI         INDIA POST
          |                 |                 |
          └─────────────────┼─────────────────┘
                            v
                    TRACKING EVENTS
                            |
                            v
                     POSTGRESQL
                            |
         ┌──────────────────┼───────────────────┐
         v                  v                   v
      PARCEL              MONEY               STATUS
       STATE              STATE            RECONCILIATION
         |                  |                   |
         └──────────────────┼───────────────────┘
                            v
                     EXCEPTION ENGINE
                            |
                 ┌──────────┼───────────┐
                 v          v           v
                SLA      FOLLOW-UP    REPORTS
                            |
                            v
                     MONTHLY REPORT
                            |
                            v
                    MANAGEMENT P&L
                            |
                            v
                          TALLY
```

---

# 126. Final Product Definition

The product should be positioned internally as:

> **A central e-commerce order, parcel, courier, money, and reconciliation platform.**

The five most important links are:

```text
Shopify Order
      ↕
Internal Parcel / Barcode
      ↕
Courier Shipment / AWB
      ↕
Settlement / Refund Money
      ↕
Accounting / Tally
```

The barcode is the bridge between the seller's **digital order** and **physical warehouse parcel**.

The AWB is the bridge between the seller's parcel and the **courier network**.

The statement/settlement layer is the bridge between the order and **actual money movement**.

The reconciliation engine connects all of them and exposes the records that need action.

---

# 127. Final Business Outcome

A seller should be able to open the system and immediately see:

```text
WHAT DID I SELL?
WHAT DID I DISPATCH?
WHERE IS EACH PARCEL?
WHICH PARCELS ARE RETURNING?
WHICH PARCELS ARE STUCK?
WHICH PARCELS ARE CLOSE TO THE SLA?
WHICH MONEY HAS ARRIVED?
WHICH MONEY IS STILL PENDING?
WHICH REFUNDS ARE PENDING?
WHICH RECORDS DO NOT MATCH?
HOW DID THE BUSINESS PERFORM THIS MONTH?
```

That is the real MVP.

Tally is downstream. Barcode, shipment/AWB, courier status, settlement, and reconciliation are the operational core.
