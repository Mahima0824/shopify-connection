# Barcode Generator + Mobile Camera Scanner
## Full Implementation Plan for the Existing E-commerce Reconciliation System

**Purpose:** Add a production-ready internal parcel barcode system to the existing Shopify reconciliation website.

**Core rule:** The barcode identifies a **parcel**, not a customer and not a product.

**Target flow:**

`Shopify Order → Parcel → Internal Barcode → Print → Put on Parcel → Mobile Camera Scan → Dispatch/Return/RTO → Shipment/AWB → Reconciliation`

---

# 1. Current System Context

The current system already has:

- FastAPI backend
- Next.js 14 frontend
- Supabase PostgreSQL
- Shopify connection
- Shopify order synchronization
- Shopify CSV import
- Orders page
- Basic parcel support
- Returns/RTO
- Reconciliation R001-R008
- Exception queue
- Audit
- Order timeline
- Dashboard
- Excel/CSV exports
- Tally-related modules

The barcode work should be integrated into this application. Do not create a separate barcode service/application.

---

# 2. What the Barcode Module Must Do

The module has four responsibilities:

## 2.1 Generate

For a parcel, assign a unique internal value such as:

```text
PKG-0000000001
```

Render that value as a Code 128 barcode.

## 2.2 Print

Generate a physical label containing:

```text
Business Name
Order: #10521
Parcel: PKG-0000000001

[ CODE 128 BARCODE ]
PKG-0000000001
```

## 2.3 Scan

The worker opens the website on a phone:

```text
Scan button
    ↓
rear camera
    ↓
barcode detected locally
    ↓
PKG-0000000001
```

## 2.4 Resolve

The scanned value is sent to the backend:

```text
PKG-0000000001
       ↓
Parcel
       ↓
Order
       ↓
Order Items
       ↓
Shipment/AWB
```

The backend then performs the requested operation:

```text
Dispatch
Return
RTO
Lookup
```

---

# 3. Critical Data Model Decision

Do not use:

```text
barcode → product
```

for the current warehouse use case.

Use:

```text
barcode → parcel → order → items
```

Then separately:

```text
parcel → shipment → courier + AWB
```

Final relationship:

```text
                     Shopify Order
                           |
                       Order #10521
                           |
                           v
                         Parcel
                           |
                    PKG-0000000001
                           |
                        Barcode
                           |
                 ┌─────────┴─────────┐
                 |                   |
            Parcel Items          Shipment
                                     |
                                  Courier
                                     |
                                   AWB
```

---

# 4. Why One Barcode Per Parcel

Suppose an order has:

```text
Order #10521

T-Shirt × 2
Jeans × 1
Cap × 1
```

Put only one internal barcode on the parcel:

```text
PKG-0000000001
```

The database tells you what is inside:

```text
PKG-0000000001
        ↓
Order #10521
        ↓
T-Shirt × 2
Jeans × 1
Cap × 1
```

This is the right model for your current process:

```text
Pack parcel
→ attach one label
→ scan parcel at dispatch
→ scan same parcel when returned
```

---

# 5. Product Barcode vs Parcel Barcode

A product can already have a manufacturer/SKU barcode:

```text
EAN/UPC/SKU
   ↓
Product
```

Your system's internal barcode is different:

```text
Code 128
   ↓
Parcel
   ↓
Order
   ↓
Products
```

Do not replace existing product barcodes.

Do not reuse a product barcode as your parcel identifier.

---

# 6. Barcode Technology Decision

## Use Code 128

Recommended internal barcode:

```text
Code 128
```

Example value:

```text
PKG-0000000001
```

Code 128 is appropriate for an internal alphanumeric parcel identifier.

## Generator

Use:

```text
bwip-js
```

`bwip-js` supports Code 128 and browser/server rendering, including SVG and PNG output. citeturn191073search3turn840838view1

## Scanner

Use:

```text
@zxing/browser
```

It supports browser camera/video decoding and continuous scanning. citeturn840838view0

## Do not use native BarcodeDetector as the only scanner

The browser-native Barcode Detection API currently has limited availability across browsers. citeturn191073search0turn191073search1

Use ZXing as the primary decoder.

---

# 7. Database Model

## 7.1 parcels

Extend the existing `parcels` table as necessary:

```text
id UUID PK
business_id UUID FK
order_id UUID FK
parcel_code VARCHAR
barcode_value VARCHAR
barcode_format VARCHAR
status VARCHAR
created_at TIMESTAMP
updated_at TIMESTAMP
```

Example:

```text
parcel_code  = PKG-0000000001
barcode_value = PKG-0000000001
barcode_format = CODE128
```

Add:

```sql
UNIQUE (business_id, barcode_value)
```

---

# 8. Parcel Items

Create a `parcel_items` table even if MVP normally creates one parcel per order.

```text
id UUID PK
business_id UUID FK
parcel_id UUID FK
order_item_id UUID FK
quantity INTEGER
created_at TIMESTAMP
updated_at TIMESTAMP
```

This supports future multi-parcel orders.

Example:

```text
Order #5002
   |
   +-- Parcel A
   |     T-Shirt × 2
   |     Cap × 1
   |
   +-- Parcel B
         Jeans × 1
```

---

# 9. Do Not Make the Barcode the DB Primary Key

Use two identities:

```text
DB primary key:
UUID
```

and:

```text
warehouse identifier:
PKG-0000000001
```

Example:

```text
parcel.id = 8f3e...UUID
parcel_code = PKG-0000000001
barcode_value = PKG-0000000001
```

This separates database identity from the human/warehouse identifier.

---

# 10. Barcode Number Generation

Recommended format:

```text
PKG-0000000001
```

Use a PostgreSQL sequence or another concurrency-safe allocator.

Do **not** use:

```python
last_id + 1
```

without database locking.

Concurrent Shopify events can otherwise produce duplicate values.

---

# 11. PostgreSQL Sequence

Simplest MVP:

```text
parcel_barcode_seq
```

Sequence:

```text
1
2
3
4
```

Formatting:

```text
PKG-{number:010d}
```

Result:

```text
PKG-0000000001
PKG-0000000002
PKG-0000000003
```

This provides billions of possible sequential parcel values.

---

# 12. Barcode Creation Trigger

Whenever an order is imported or synchronized:

```text
Order exists
    ↓
Does parcel exist?
    ↓
NO
    ↓
Create parcel
    ↓
Allocate barcode
    ↓
Create parcel items
```

If the order is updated later:

```text
Parcel already exists
    ↓
DO NOT generate new barcode
```

The physical parcel identity must remain stable.

---

# 13. Works With Both Shopify Onboarding Paths

## Connected Shopify

```text
Shopify webhook/API
      ↓
order upsert
      ↓
ensure parcel
      ↓
barcode
```

## CSV import

```text
Shopify CSV
      ↓
order import
      ↓
ensure parcel
      ↓
barcode
```

Both paths must use the same `ensure_parcel_for_order()` logic.

---

# 14. Barcode Backfill

Existing orders need barcodes.

Add:

```http
POST /api/v1/parcels/backfill
```

Process:

```text
Find orders without parcel
      ↓
Create parcel
      ↓
Generate barcode
      ↓
Create parcel items
```

Run twice safely:

```text
First run: 500 parcels created
Second run: 0 parcels created
```

No duplicates.

---

# 15. Backend Service Structure

Add:

```text
backend/app/services/
    parcel_service.py
    barcode_service.py
    scanning_service.py
```

## `parcel_service.py`

Responsibilities:

```text
ensure_parcel_for_order()
create_parcel()
sync_parcel_items()
backfill_missing_parcels()
get_parcel_by_barcode()
```

## `barcode_service.py`

Responsibilities:

```text
generate_parcel_code()
normalize_barcode()
validate_barcode_format()
```

Do not put order/dispatch business logic here.

---

# 16. Barcode Rendering Architecture

Recommended:

```text
PostgreSQL
    ↓
barcode_value
    ↓
Next.js
    ↓
bwip-js
    ↓
SVG/canvas
    ↓
Preview / Print
```

The backend stores the value.

The frontend renders the barcode.

This avoids storing millions of unnecessary image files.

---

# 17. Why Client-Side Rendering Is Good for This MVP

The barcode itself contains only:

```text
PKG-0000000001
```

No sensitive data.

There is no reason to call an external barcode-generation service for every label.

Client-side rendering gives:

- no barcode API cost
- no image storage dependency
- immediate preview
- easy batch printing
- easy reprinting
- deterministic output

---

# 18. `bwip-js` Installation

Frontend:

```bash
npm install bwip-js
```

Pin and test a known version in `package-lock.json` rather than allowing uncontrolled dependency changes.

---

# 19. Barcode Component

Create:

```text
frontend/components/barcode/ParcelBarcode.tsx
```

Responsibilities:

```text
receive barcode value
render Code 128
show human-readable text
handle render errors
```

Conceptual implementation:

```tsx
'use client';

import bwipjs from 'bwip-js';
import { useEffect, useRef } from 'react';

type Props = {
  value: string;
};

export function ParcelBarcode({ value }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    try {
      bwipjs.toCanvas(ref.current, {
        bcid: 'code128',
        text: value,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
      });
    } catch (error) {
      console.error('Barcode generation failed', error);
    }
  }, [value]);

  return <canvas ref={ref} aria-label={`Barcode ${value}`} />;
}
```

For print quality, test SVG output as well. `bwip-js` supports SVG output. citeturn191073search3

---

# 20. Prefer SVG for Printed Labels

For print layouts, SVG is preferable where practical because it stays sharp when scaled.

Architecture:

```text
barcode value
   ↓
bwip-js
   ↓
SVG
   ↓
print CSS
```

Use actual printed tests to choose final dimensions.

---

# 21. Label Design

MVP label:

```text
┌────────────────────────────────────┐
│            BUSINESS NAME            │
│                                    │
│ Order: #10521                      │
│ Parcel: PKG-0000000001             │
│                                    │
│     [ CODE 128 BARCODE ]           │
│                                    │
│       PKG-0000000001               │
└────────────────────────────────────┘
```

Use:

- dark bars
- white background
- adequate barcode width
- adequate bar height
- whitespace around barcode
- human-readable value

Do not put graphics over the barcode.

---

# 22. Barcode Quiet Zone

Leave visible whitespace around the barcode.

Do not place:

- borders immediately against the bars
- logos inside the bars
- text over the bars
- dark backgrounds behind the bars

Physical scanning reliability matters more than visual styling.

---

# 23. Label Information

Recommended:

```text
Business name
Order number
Parcel code
Barcode
```

Optional:

```text
Customer name
Short item summary
```

Do not put:

```text
phone number
full address
payment amount
private data
```

unless there is a separate operational reason.

---

# 24. Reprint Policy

A reprint must use the **same barcode**.

Example:

```text
PKG-0000000001
```

If the label is damaged:

```text
Find parcel
→ Reprint same barcode
```

Do not create a new parcel/barcode just because a label needs reprinting.

---

# 25. Prevent Duplicate Physical Parcel Identity

If the same barcode gets printed twice accidentally, two physical parcels may carry the same barcode.

To reduce risk:

- show `REPRINT` visibly on reprints
- log reprints
- never allow the database to create another parcel with the same barcode
- block duplicate dispatch at the backend

A duplicate label is a warehouse-process issue; the software should make it detectable.

---

# 26. Print Page

Create:

```text
app/parcels/labels/page.tsx
```

Features:

```text
Today's labels
Missing labels
Selected labels
Print Selected
Preview
Reprint
```

Batch printing must render one print document rather than opening many browser tabs.

---

# 27. Browser Printing

MVP:

```javascript
window.print()
```

Use a dedicated print stylesheet:

```css
@media print {
  .no-print {
    display: none !important;
  }

  .label {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
```

Also provide normal browser `Save as PDF` functionality.

Later, if customers require stored PDFs or exact thermal-printer dimensions, add server-side PDF generation.

---

# 28. Label Size Strategy

Support initially:

```text
A4 printable sheet
```

Design the component so dimensions can later support:

```text
4×6 inch thermal label
```

Do not hard-code the entire system around one printer model.

---

# 29. Mobile Scanner Technology

Use:

```text
@zxing/browser
```

It provides browser camera/video decoding and device selection functionality. citeturn840838view0

Install:

```bash
npm install @zxing/browser
```

Use a shared scanner component throughout Dispatch, Return, and RTO.

---

# 30. Mobile Camera Permission

Camera access uses browser media APIs.

`getUserMedia()` requires a secure context such as HTTPS and requires user permission. citeturn269306search0

Therefore production scanner URL must be:

```text
https://app.yourdomain.com/scan
```

Development:

```text
http://localhost
```

A plain LAN HTTP address can fail camera access because it is not a secure context.

---

# 31. Permissions Policy

Ensure deployment does not block camera access.

If needed, configure:

```http
Permissions-Policy: camera=(self)
```

A restrictive Permissions Policy can cause `getUserMedia()` to fail. citeturn269306search3

---

# 32. Scanner Component

Create:

```text
frontend/components/scanner/BarcodeScanner.tsx
```

Responsibilities:

```text
start camera
stop camera
select camera
prefer rear camera
continuous scanning
duplicate suppression
return decoded value
camera error handling
```

The scanner should know nothing about dispatch/return business logic.

It only returns:

```text
barcode string
```

---

# 33. Scanner Component Contract

Example:

```typescript
type BarcodeScannerProps = {
  onDetected: (barcode: string) => void;
  onError?: (error: Error) => void;
  active?: boolean;
};
```

Usage:

```tsx
<BarcodeScanner
  active={true}
  onDetected={handleBarcodeDetected}
/>
```

Dispatch/Return/RTO pages decide what happens after detection.

---

# 34. Camera Flow

```text
User clicks Scan
       ↓
Request camera permission
       ↓
Open rear camera
       ↓
Show scanner guide
       ↓
ZXing decodes frames locally
       ↓
Barcode found
       ↓
Stop duplicate processing for that value
       ↓
Call backend
```

Do not upload a camera image to your server for ordinary barcode detection.

---

# 35. Continuous Scanning

Warehouse mode should remain open.

```text
Scan 1
 ↓
Process
 ↓
Success
 ↓
Return to camera
 ↓
Scan 2
 ↓
Process
```

Do not make the worker repeatedly tap `Open Scanner`.

---

# 36. Duplicate Decoder Results

Camera decoders may detect the same barcode in multiple consecutive frames.

Keep:

```text
lastDetectedValue
lastDetectedAt
```

Ignore repeated identical values for a short UI debounce window.

Backend duplicate protection remains mandatory.

---

# 37. Manual Fallback

Always provide:

```text
[Enter Barcode Manually]
```

because real warehouses can have:

- poor lighting
- glare
- damaged labels
- dirty labels
- bad phone cameras
- camera permission errors
- network problems

The manual field should use the same backend action endpoint.

---

# 38. Scanner UI

Dispatch screen:

```text
┌─────────────────────────────┐
│       DISPATCH SCANNER      │
│                             │
│      ┌───────────────┐      │
│      │               │      │
│      │    CAMERA     │      │
│      │               │      │
│      │   SCAN HERE   │      │
│      │               │      │
│      └───────────────┘      │
│                             │
│ [Stop Camera]               │
│                             │
│ Enter manually:             │
│ [____________________]      │
└─────────────────────────────┘
```

---

# 39. Camera Selection

Prefer the environment/rear camera on phones.

If multiple cameras exist, support:

```text
[Switch Camera]
```

Do not assume the first camera is always the rear camera.

ZXing's browser layer exposes video input device discovery and video-device decoding APIs. citeturn840838view0

---

# 40. Camera Stop Lifecycle

When scanner component unmounts:

```text
stop ZXing controls
stop MediaStream tracks
release video element
```

Never leave the phone camera running after the user leaves the scanner.

---

# 41. Scanner Error States

Use explicit errors:

```text
CAMERA_PERMISSION_DENIED
CAMERA_NOT_FOUND
CAMERA_NOT_READABLE
DECODER_ERROR
SCAN_TIMEOUT
NETWORK_ERROR
```

Example UI:

```text
Camera access was denied.
Allow camera permission in your browser settings and try again.
```

---

# 42. Scanner Timeout

If nothing is detected for a reasonable period:

```text
Barcode not detected.
Move the camera closer or improve lighting.

[Try Again]
[Enter Manually]
```

Do not close the scanner too aggressively during warehouse use.

---

# 43. Barcode Format Validation

Your internal barcode format:

```text
^PKG-\d{10}$
```

Example valid:

```text
PKG-0000000001
```

But this is client-side validation only.

The backend remains authoritative.

---

# 44. Barcode Normalization

Backend:

```python
barcode = barcode.strip().upper()
```

Then validate.

Do not remove arbitrary characters because that can turn a wrong barcode into a different valid barcode.

---

# 45. Lookup API

Create:

```http
GET /api/v1/parcels/barcode/{barcode}
```

Purpose:

> Tell me what this barcode belongs to.

Example response:

```json
{
  "success": true,
  "data": {
    "parcel": {
      "id": "...",
      "parcel_code": "PKG-0000000001",
      "status": "READY_TO_DISPATCH"
    },
    "order": {
      "order_number": "#10521",
      "customer_name": "Rahul"
    },
    "items": [
      {
        "name": "Blue T-Shirt",
        "quantity": 2
      }
    ]
  }
}
```

---

# 46. Action APIs

Keep lookup separate from state-changing actions.

Dispatch:

```http
POST /api/v1/scan/dispatch
```

Return:

```http
POST /api/v1/scan/return
```

RTO:

```http
POST /api/v1/scan/rto
```

This separation makes the system easier to maintain and secure.

---

# 47. Dispatch Request

Minimal:

```json
{
  "barcode": "PKG-0000000001"
}
```

Optional:

```json
{
  "barcode": "PKG-0000000001",
  "device_id": "warehouse-phone-03"
}
```

If shipment/AWB is not already present, a second step can collect it.

---

# 48. Dispatch Backend Workflow

```text
1. Authenticate user
2. Verify warehouse permission
3. Normalize barcode
4. Find parcel using business_id + barcode
5. Lock parcel row
6. Load order
7. Check cancellation
8. Check current parcel state
9. Check shipment/AWB requirements
10. Create dispatch scan event
11. Update parcel
12. Update operational order status
13. Audit
14. Trigger shipment/tracking processing
15. Commit
```

---

# 49. Dispatch Transaction Safety

Use a DB transaction.

Concept:

```text
BEGIN

SELECT parcel FOR UPDATE

validate

create scan_event

update parcel

update order

audit

COMMIT
```

This prevents two workers from successfully dispatching the same parcel at the same time.

---

# 50. Dispatch Validation Rules

Block if:

```text
barcode doesn't exist
order is cancelled
parcel already dispatched
parcel already returned
user not authorized
required shipment data is missing
```

Example:

```text
❌ ORDER CANCELLED

Shopify cancellation:
28 Sep 2026 13:42

This parcel cannot be dispatched.
```

---

# 51. Duplicate Dispatch

Worker A:

```text
scan PKG-0000000001
```

Worker B immediately:

```text
scan PKG-0000000001
```

Expected:

```text
Worker A → DISPATCHED ✅
Worker B → ALREADY DISPATCHED ❌
```

Only one dispatch event is valid.

---

# 52. Scan Idempotency

Add optional `client_scan_id`:

```json
{
  "barcode": "PKG-0000000001",
  "client_scan_id": "uuid"
}
```

This helps prevent duplicates when a request times out and the client retries.

Backend state validation remains mandatory.

---

# 53. Return Scanner

Create:

```text
app/scan/return/page.tsx
```

Workflow:

```text
Scan internal barcode
      ↓
Find parcel
      ↓
Show original order
      ↓
Select return type
      ↓
Select reason
      ↓
Select condition
      ↓
Enter return quantities
      ↓
Confirm
```

---

# 54. Return UI

```text
RETURN SCANNER

[ Camera Scanner ]

Detected:
PKG-0000000001

Order: #10521
Customer: Rahul

Product:
Blue T-Shirt × 2

Courier:
DTDC

AWB:
D123456789

Return Type:
[ Customer Return ▼ ]

Condition:
[ Good ▼ ]

Reason:
[ Size Issue ▼ ]

Returned Quantity:
1

[CONFIRM RETURN]
```

---

# 55. RTO Scanner

Create:

```text
POST /api/v1/scan/rto
```

Use exactly the same internal barcode.

Do not create another barcode type for RTO.

The difference is the event:

```text
CUSTOMER_RETURN
```

versus:

```text
RTO
```

---

# 56. Return Quantity Rules

Example:

```text
Ordered: 3
Already returned: 1
New return: 2
```

Valid.

But:

```text
Ordered: 3
Already returned: 2
New return: 2
```

must be rejected because:

```text
2 + 2 > 3
```

---

# 57. One Barcode Throughout Lifecycle

Do not generate a new barcode for every state.

Example:

```text
PKG-0000000001
```

Timeline:

```text
CREATED
PACKED
DISPATCHED
IN_TRANSIT
RTO
RETURN_RECEIVED
INSPECTED
```

The barcode remains the same.

---

# 58. Shipment/AWB Relationship

After warehouse dispatch, associate the parcel with a shipment.

Concept:

```text
Parcel
  |
  +-- Internal Barcode
  |
  +-- Shipment
        |
        +-- Carrier
        +-- AWB
```

Example:

```text
Parcel:
PKG-0000000001

Carrier:
DTDC

AWB:
D123456789
```

---

# 59. Shipment Table

Add if not already present:

```text
shipments
------------------------------------
id UUID PK
business_id UUID FK
order_id UUID FK
parcel_id UUID FK
carrier_code VARCHAR
awb_number VARCHAR
tracking_status VARCHAR
carrier_status_raw VARCHAR
current_location VARCHAR NULL
last_checkpoint_message TEXT NULL
last_checkpoint_at TIMESTAMP NULL
tracking_url TEXT NULL
shipped_at TIMESTAMP NULL
estimated_delivery_at TIMESTAMP NULL
delivered_at TIMESTAMP NULL
rto_at TIMESTAMP NULL
returned_at TIMESTAMP NULL
last_synced_at TIMESTAMP NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

Unique:

```text
business_id + carrier_code + awb_number
```

---

# 60. Dispatch Flow With AWB

Recommended:

```text
Scan internal barcode
      ↓
Find parcel
      ↓
Does shipment/AWB already exist?
      |
      +-- YES → dispatch
      |
      +-- NO → choose courier + enter/scan AWB
                         ↓
                      create shipment
                         ↓
                       dispatch
```

This prevents unnecessary data entry when AWB information is already available.

---

# 61. What the Worker Should See After Scan

Example:

```text
✅ DISPATCH SUCCESSFUL

Order #10521
Parcel PKG-0000000001

Items:
Blue T-Shirt × 2
Jeans × 1

Courier:
DTDC

AWB:
D123456789
```

Then the camera returns to scanning mode.

---

# 62. Parcel Page

Create:

```text
app/parcels/page.tsx
```

Columns:

```text
Parcel ID
Order
Barcode
Status
Courier
AWB
Created
```

Actions:

```text
View
Print
Reprint
```

---

# 63. Parcel Detail Page

Example:

```text
PARCEL PKG-0000000001

Barcode:
[ CODE 128 ]

Order:
#10521

Customer:
Rahul

Items:
T-Shirt × 2
Jeans × 1

Status:
DISPATCHED

Courier:
DTDC

AWB:
D123456789

Timeline:
Created
Packed
Dispatched
In Transit
```

---

# 64. Order Detail Integration

Add to existing order detail page:

```text
PARCEL

PKG-0000000001

[Barcode]

[Print Label]

STATUS:
DISPATCHED
```

Then:

```text
SHIPMENT

DTDC
AWB D123456789
IN TRANSIT
```

---

# 65. Frontend Routes

Add:

```text
app/
├── parcels/
│   ├── page.tsx
│   ├── [id]/page.tsx
│   └── labels/page.tsx
│
└── scan/
    ├── page.tsx
    ├── dispatch/page.tsx
    ├── return/page.tsx
    └── rto/page.tsx
```

---

# 66. Frontend Components

```text
components/
├── barcode/
│   ├── ParcelBarcode.tsx
│   ├── BarcodePreview.tsx
│   └── LabelPreview.tsx
│
└── scanner/
    ├── BarcodeScanner.tsx
    ├── ScannerViewport.tsx
    ├── ScannerResult.tsx
    ├── ScannerError.tsx
    └── ManualBarcodeInput.tsx
```

---

# 67. Mobile Scanner Page Architecture

Do not duplicate camera logic.

Use:

```text
BarcodeScanner
       |
       +---- dispatch page
       |
       +---- return page
       |
       +---- RTO page
```

The business pages perform different API actions after the same scanner returns a barcode.

---

# 68. Scanner Security Model

The scanner only produces:

```text
barcode string
```

The backend decides:

```text
which business owns it
whether it exists
whether the user can act
whether dispatch is allowed
whether return is allowed
```

Never trust frontend validation for business decisions.

---

# 69. Multi-Tenant Barcode Security

Every lookup must include the authenticated business:

```text
business_id + barcode_value
```

Not simply:

```text
barcode_value
```

Otherwise a barcode collision or malicious request could expose another tenant's parcel.

---

# 70. Device Metadata

Optionally store:

```text
device_id
```

with scan events.

Example:

```text
warehouse-phone-03
```

This is helpful for debugging and audit but is not required for the first scanner release.

---

# 71. Scan Event Table

Use/extend:

```text
scan_events
------------------------------------
id UUID PK
business_id UUID FK
parcel_id UUID FK
order_id UUID FK
event_type VARCHAR
performed_by UUID FK
device_id VARCHAR NULL
metadata JSONB NULL
created_at TIMESTAMP
```

Events:

```text
PACKED
DISPATCHED
RETURN_RECEIVED
RTO_RECEIVED
INSPECTED
```

---

# 72. Append-Only Event History

Do not rely only on:

```text
parcel.status = RETURNED
```

Store the history:

```text
PACKED
DISPATCHED
RTO
RETURN_RECEIVED
```

This gives you an audit trail and a reliable order timeline.

---

# 73. Barcode Reconciliation

The barcode is the link between physical reality and your digital database.

Example:

```text
Physical parcel:
PKG-0000000001
```

Digital:

```text
PKG-0000000001
  ↓
Order #10521
  ↓
Products
  ↓
Shipment
  ↓
AWB
```

If the worker scans the wrong parcel, the system will show the wrong order immediately before the worker confirms the action.

---

# 74. Scan Preview Before Action

For higher operational safety, the scanner should show:

```text
Order #10521
Customer Rahul
Items T-Shirt × 2
Amount ₹1,499
Parcel PKG-0000000001
```

then allow:

```text
[Confirm Dispatch]
```

For very high-volume warehouses, an auto-confirm mode can be added later after the workflow has been proven.

---

# 75. Recommended MVP Dispatch UX

Start with:

```text
Scan
 ↓
Show parcel/order
 ↓
[Confirm Dispatch]
 ↓
Success
 ↓
Resume scan
```

This is slightly slower than zero-confirmation scanning, but safer for the first real deployment.

After you measure error rates, you can introduce configurable auto-confirm for trusted workflows.

---

# 76. Camera Scanner UX

Requirements:

```text
large camera viewport
clear scan box
rear camera default
camera switching
manual fallback
success feedback
error feedback
continuous mode
```

Avoid:

```text
small preview
multiple modal dialogs
required typing
opening a new page after every scan
```

---

# 77. Scanner Feedback

Success:

```text
✅ DISPATCHED
```

Optionally:

```text
vibration
short sound
```

Error:

```text
❌ ORDER CANCELLED
```

Do not depend on color alone.

---

# 78. Network Failure

If:

```text
barcode decoded
```

but API request fails:

```text
Barcode detected, but dispatch was not confirmed.
Check the internet connection and try again.
```

Never show `Dispatch successful` until the transaction is committed.

---

# 79. Offline Mode

Do not implement offline transactional scanning in this MVP.

Reason:

```text
offline worker A scans
offline worker B scans
network returns
conflicting state transitions
```

For a system affecting operational and financial reconciliation, server-committed transactions are safer for the first release.

---

# 80. Camera Privacy

Normal barcode decoding should happen locally:

```text
Camera
 ↓
ZXing
 ↓
barcode string
 ↓
API
```

Do not upload/store camera frames for standard scans.

---

# 81. Scanner Performance

Target:

```text
barcode visible
→ detected
→ backend result
```

within a practical sub-second response under normal network conditions.

Actual performance must be tested on real devices and real network conditions.

---

# 82. Barcode Lookup Index

Create:

```sql
CREATE UNIQUE INDEX idx_parcel_business_barcode
ON parcels (business_id, barcode_value);
```

This is critical for large datasets.

---

# 83. Other Recommended Indexes

```text
parcels.business_id + status
parcels.order_id
scan_events.parcel_id + created_at
shipments.parcel_id
shipments.business_id + awb_number
```

Add only indexes supported by actual query patterns, but barcode lookup must be indexed.

---

# 84. Barcode API Error Codes

Use structured codes:

```text
PARCEL_NOT_FOUND
INVALID_BARCODE
ORDER_CANCELLED
PARCEL_ALREADY_DISPATCHED
PARCEL_ALREADY_RETURNED
USER_NOT_AUTHORIZED
RETURN_ALREADY_RECEIVED
INVALID_RETURN_QUANTITY
```

Example:

```json
{
  "success": false,
  "error": {
    "code": "PARCEL_ALREADY_DISPATCHED",
    "message": "This parcel was dispatched at 14:25."
  }
}
```

---

# 85. Barcode API Authorization

Every endpoint must:

```text
authenticate user
verify business
verify role
```

Warehouse role should have access to:

```text
dispatch scan
return scan
RTO scan
parcel lookup
label printing
```

Viewer role must not create scan events.

---

# 86. Backend Transaction Example

Conceptual:

```python
def dispatch_parcel(business_id, barcode, user_id):
    barcode = normalize_barcode(barcode)

    with db.transaction():
        parcel = get_parcel_for_update(
            business_id,
            barcode,
        )

        if not parcel:
            raise ParcelNotFound()

        if parcel.order.cancelled_at:
            raise OrderCancelled()

        if parcel.status == 'DISPATCHED':
            raise AlreadyDispatched()

        create_scan_event(
            parcel_id=parcel.id,
            order_id=parcel.order_id,
            event_type='DISPATCHED',
            performed_by=user_id,
        )

        parcel.status = 'DISPATCHED'
        parcel.order.operational_status = 'DISPATCHED'

        create_audit_log(...)
```

Keep this logic in the service layer, not the FastAPI router.

---

# 87. Mobile Camera Package API

Use a dedicated client component around `@zxing/browser`.

Do not spread raw ZXing calls throughout pages.

Structure:

```text
BarcodeScanner.tsx
    ↓
ZXing browser API
    ↓
scan result
    ↓
onDetected(value)
```

This makes future decoder replacement possible without changing business pages.

---

# 88. Browser Compatibility

Target real customer browsers rather than assuming every browser behaves identically.

At minimum test your target combination such as:

```text
Android Chrome
iPhone Safari if customers use iPhone
```

Do not rely on `BarcodeDetector` alone because current browser support is not universal. citeturn191073search0

---

# 89. Production Camera URL Requirement

Before production:

```text
https://your-domain.com
```

must work correctly.

Test:

```text
/scan/dispatch
/scan/return
/scan/rto
```

from the actual phone over mobile data, not only on the development laptop.

---

# 90. Scanner Test Sheet

Create a permanent regression page containing:

```text
PKG-0000000001
PKG-0000000002
PKG-0000000003
PKG-0000000100
PKG-0000010000
PKG-1234567890
```

Print it.

Every scanner-library upgrade must be tested against the physical sheet.

---

# 91. Physical Barcode Test

Print 10-20 labels.

Test:

```text
normal lighting
low lighting
slight angle
different distances
slight glare
slightly wrinkled label
multiple barcode sizes
```

Use the actual phone models intended for warehouse use.

---

# 92. Scanner Acceptance Test

Pilot target:

```text
99/100 successful scans
```

under normal operating conditions.

If failure rate is too high, tune:

```text
barcode width
bar height
label quality
quiet zone
camera resolution
lighting
```

Do not solve every scanning problem by adding complex software. Often the physical label is the problem.

---

# 93. Barcode Label Failure Cases

Test labels that are:

```text
slightly folded
slightly scratched
partially dirty
printed on low-quality paper
under transparent tape
```

Decide whether the label remains operationally reliable.

---

# 94. Barcode Generator Tests

Unit/component tests:

```text
[ ] generates correct value
[ ] renders Code 128
[ ] renders human-readable text
[ ] handles invalid value
[ ] same value renders same barcode
[ ] batch generation works
```

---

# 95. Barcode Allocation Tests

```text
[ ] 1 order → 1 barcode
[ ] same order update → same barcode
[ ] backfill is idempotent
[ ] concurrent creation → unique codes
[ ] tenant isolation works
```

---

# 96. Scanner Tests

```text
[ ] camera permission accepted
[ ] camera permission denied
[ ] no camera
[ ] rear camera
[ ] camera switching
[ ] barcode detected
[ ] duplicate result suppressed
[ ] manual entry
[ ] network failure
[ ] camera stopped on unmount
```

---

# 97. Dispatch Tests

```text
[ ] valid parcel
[ ] invalid barcode
[ ] cancelled order
[ ] already dispatched
[ ] already returned
[ ] unauthorized user
[ ] concurrent dispatch
[ ] shipment/AWB already exists
[ ] shipment/AWB missing
```

---

# 98. Return/RTO Tests

```text
[ ] customer return
[ ] RTO
[ ] partial return
[ ] invalid quantity
[ ] duplicate return
[ ] unknown barcode
[ ] return event in timeline
```

---

# 99. End-to-End Barcode Test

Run this exact workflow:

```text
1. Create Shopify test order
2. Import/sync order
3. Confirm parcel automatically created
4. Confirm barcode generated
5. Open label page
6. Print label
7. Attach label to physical parcel
8. Open website on mobile
9. Open Dispatch Scanner
10. Allow camera
11. Scan printed barcode
12. Verify correct order appears
13. Confirm dispatch
14. Verify DB scan event
15. Verify parcel status
16. Add courier/AWB
17. Later open Return Scanner
18. Scan same physical barcode
19. Record return
20. Verify timeline
21. Verify reconciliation
```

If this complete test works, the core barcode system is operational.

---

# 100. Multi-Parcel Test

Test:

```text
Order #5002

Parcel A
PKG-0000000002
T-Shirt × 2

Parcel B
PKG-0000000003
Jeans × 1
```

Expected:

```text
scan Parcel A
→ only Parcel A is dispatched

scan Parcel B
→ only Parcel B is dispatched
```

The parent order can remain partially fulfilled/in transit.

---

# 101. Wrong Barcode Test

Scan:

```text
PKG-9999999999
```

if it does not exist.

Expected:

```text
❌ PARCEL NOT FOUND
```

No order should be modified.

---

# 102. Wrong Business Test

Business A:

```text
PKG-0000000001
```

User from Business B scans the same value.

Expected:

```text
PARCEL NOT FOUND
```

Do not reveal Business A's data.

---

# 103. Barcode Reprint Test

```text
Print PKG-0000000001
Reprint PKG-0000000001
```

Expected:

```text
same barcode value
same parcel
same order
```

Only print/audit metadata changes.

---

# 104. Label Deletion Policy

The database should not depend on the physical image file.

If a stored label file is deleted:

```text
barcode value remains in DB
→ regenerate label
```

This is another reason to store the string rather than only the image.

---

# 105. Barcode Module APIs

Minimum:

```http
GET  /api/v1/parcels
GET  /api/v1/parcels/{id}
GET  /api/v1/parcels/barcode/{barcode}
POST /api/v1/parcels/backfill

POST /api/v1/scan/dispatch
POST /api/v1/scan/return
POST /api/v1/scan/rto
```

---

# 106. Frontend Data Flow

```text
Orders page
      ↓
Parcel exists
      ↓
Barcode displayed
      ↓
Print label
```

Warehouse:

```text
Scan button
      ↓
Camera
      ↓
ZXing
      ↓
barcode
      ↓
API
      ↓
PostgreSQL
      ↓
success/error
```

---

# 107. Final Data Flow

```text
SHOPIFY
   |
   v
ORDER
   |
   v
PARCEL
   |
   +--> parcel_code
   |
   +--> barcode_value
   |
   +--> parcel_items
   |
   v
PRINT LABEL
   |
   v
PHYSICAL PARCEL
   |
   v
MOBILE CAMERA
   |
   v
ZXING
   |
   v
BARCODE STRING
   |
   v
FASTAPI
   |
   v
POSTGRESQL
   |
   +--> DISPATCH
   +--> RETURN
   +--> RTO
   |
   v
SHIPMENT
   |
   +--> COURIER
   +--> AWB
   +--> TRACKING
```

---

# 108. Suggested Implementation Order

Implement in this exact order:

```text
PHASE 1  Database/model review
PHASE 2  Safe barcode ID generation
PHASE 3  Parcel creation/backfill
PHASE 4  Code128 rendering
PHASE 5  Label preview/printing
PHASE 6  Parcel/label management UI
PHASE 7  Mobile camera scanner
PHASE 8  Dispatch scanning
PHASE 9  Return/RTO scanning
PHASE 10 Shipment/AWB link
PHASE 11 Physical testing
PHASE 12 Production hardening
```

Do not start with the camera UI before the parcel identity model is correct.

---

# 109. Phase 1 — Review Existing Code

Before changing anything:

```text
[ ] Inspect existing parcels model
[ ] Inspect current parcel routes
[ ] Inspect order import flow
[ ] Inspect webhook order creation flow
[ ] Inspect order status transitions
[ ] Inspect audit implementation
[ ] Inspect existing reconciliation events
[ ] Decide whether existing event table can be reused
```

Avoid creating duplicate models if the current repository already contains equivalent functionality.

---

# 110. Phase 2 — Barcode Identity

Tasks:

```text
[ ] Add barcode_value
[ ] Add parcel_code
[ ] Add barcode_format
[ ] Add unique constraint
[ ] Add PostgreSQL sequence
[ ] Implement safe allocation
[ ] Unit test allocation
```

Deliverable:

```text
New parcels always receive a stable unique Code128 identifier.
```

---

# 111. Phase 3 — Parcel Creation/Backfill

Tasks:

```text
[ ] ensure_parcel_for_order()
[ ] parcel_items creation
[ ] backfill endpoint
[ ] backfill UI/progress reporting
[ ] idempotency tests
```

Deliverable:

```text
All existing/new orders have parcel identity.
```

---

# 112. Phase 4 — Generator

Tasks:

```text
[ ] Install bwip-js
[ ] ParcelBarcode component
[ ] Code128 rendering
[ ] SVG option
[ ] Error state
[ ] Tests
```

Deliverable:

```text
Each parcel has a visually scannable barcode.
```

---

# 113. Phase 5 — Label Printing

Tasks:

```text
[ ] Label template
[ ] Print CSS
[ ] Preview
[ ] Single print
[ ] Batch print
[ ] Reprint
[ ] Physical print testing
```

Deliverable:

```text
Business can physically attach the barcode to parcels.
```

---

# 114. Phase 6 — Parcel UI

Tasks:

```text
[ ] Parcels list
[ ] Parcel detail
[ ] Barcode preview
[ ] Print action
[ ] Reprint action
[ ] Missing-label filter
```

---

# 115. Phase 7 — Camera Scanner

Tasks:

```text
[ ] Install @zxing/browser
[ ] BarcodeScanner component
[ ] Camera permission
[ ] rear camera
[ ] camera switching
[ ] duplicate suppression
[ ] manual entry
[ ] start/stop lifecycle
[ ] mobile styling
```

Deliverable:

```text
Website button → phone camera → barcode string.
```

---

# 116. Phase 8 — Dispatch

Tasks:

```text
[ ] dispatch endpoint
[ ] lookup
[ ] validation
[ ] DB transaction
[ ] scan event
[ ] audit
[ ] success feedback
[ ] continuous scanning
```

Deliverable:

```text
Phone scan → correct parcel validated → dispatch recorded.
```

---

# 117. Phase 9 — Return/RTO

Tasks:

```text
[ ] return scanner
[ ] RTO scanner
[ ] reason
[ ] condition
[ ] partial quantities
[ ] scan events
[ ] audit
[ ] reconciliation trigger
```

Deliverable:

```text
Same barcode can be scanned when the parcel returns.
```

---

# 118. Phase 10 — Shipment/AWB

Tasks:

```text
[ ] shipment table
[ ] AWB mapping
[ ] carrier field
[ ] dispatch integration
[ ] shipment detail
[ ] order detail integration
```

Deliverable:

```text
Internal parcel identity is linked to the carrier shipment.
```

---

# 119. Phase 11 — Physical Pilot

Start with:

```text
1 business
1 warehouse
1 phone
1 worker
10-50 parcels
```

Then expand:

```text
2-5 workers
100-500 parcels
```

Measure before scaling the process.

---

# 120. Phase 12 — Production Hardening

Before real use:

```text
[ ] HTTPS
[ ] Camera permissions verified
[ ] CORS production config
[ ] Authentication
[ ] Authorization
[ ] Barcode tenant isolation
[ ] DB constraints
[ ] DB backups
[ ] Logs
[ ] Error monitoring
[ ] No secrets in frontend
```

---

# 121. Real-World Operational Policy

Workers should not need to understand:

```text
Shopify IDs
PostgreSQL IDs
internal UUIDs
```

The worker uses:

```text
phone
→ scanner
→ parcel label
```

The software handles everything else.

---

# 122. Worker Workflow

```text
1. Take packed parcel
2. Verify printed label
3. Attach label
4. Open Dispatch Scanner
5. Scan barcode
6. Verify parcel details
7. Confirm dispatch
8. Put parcel with courier handover
```

Return:

```text
1. Receive returned parcel
2. Open Return Scanner
3. Scan barcode
4. Verify original order
5. Select return/RTO details
6. Confirm
```

---

# 123. Owner Workflow

Owner sees:

```text
Orders
Parcels
Shipments
Exceptions
```

For an order:

```text
Shopify state
+
Physical parcel state
+
Courier state
+
Money state
```

The barcode is what connects the physical parcel to the digital record.

---

# 124. What the Final Product Should Answer

When a seller asks:

> "Where is order #10521?"

the application should answer:

```text
Order #10521
     ↓
Parcel PKG-0000000001
     ↓
Courier DTDC
     ↓
AWB D123456789
     ↓
IN TRANSIT
     ↓
Last location: Ahmedabad Hub
```

If the parcel comes back:

```text
same barcode
     ↓
RETURN RECEIVED
```

No manual search is required.

---

# 125. What the Product Should NOT Do

Do not make the barcode contain:

```text
customer data
payment data
order JSON
courier credentials
```

Do not create a new barcode when:

```text
order changes
shipment status changes
refund happens
return happens
label is reprinted
```

Do not use the barcode as a product SKU.

---

# 126. Recommended Final Identifier Architecture

```text
                 BUSINESS
                    |
                    v
                  ORDER
                    |
                    v
                  PARCEL
                    |
          ┌─────────┴─────────┐
          v                   v
   Internal Barcode        Parcel Items
   PKG-0000000001               |
          |                     v
          |                  Products
          |
          v
       SHIPMENT
          |
     ┌────┴────┐
     v         v
  Courier     AWB
```

---

# 127. Technology Summary

| Requirement | Recommended choice |
|---|---|
| Internal barcode | Code 128 |
| Barcode value | `PKG-0000000001` |
| Generator | `bwip-js` |
| Barcode output | SVG for print where practical |
| Mobile scanner | `@zxing/browser` |
| Camera API | browser media APIs / `getUserMedia()` |
| Camera | rear/environment preference |
| Database | Supabase PostgreSQL |
| ID storage | UUID + human-readable parcel code |
| Barcode uniqueness | `business_id + barcode_value` |
| Barcode mapping | barcode → parcel → order → items |
| Courier mapping | parcel → shipment → carrier + AWB |
| Printing | browser print + printable HTML |
| Primary scan mode | continuous camera scanning |
| Fallback | manual barcode entry |
| Offline transactional scan | not in MVP |

---

# 128. Barcode Module Definition of Done

The module is complete when:

```text
[ ] New order automatically gets a parcel
[ ] Parcel gets a unique internal barcode
[ ] Existing orders can be backfilled
[ ] Barcode values are stored in PostgreSQL
[ ] Code128 renders correctly
[ ] Barcode prints correctly
[ ] Same barcode can be reprinted
[ ] Mobile camera opens from website
[ ] Rear camera is preferred
[ ] Barcode is decoded locally
[ ] Invalid barcode is rejected
[ ] Correct parcel/order is displayed
[ ] Dispatch scan works
[ ] Return scan works
[ ] RTO scan works
[ ] Duplicate dispatch is blocked
[ ] Worker identity is recorded
[ ] Scan history is preserved
[ ] Parcel can link to shipment/AWB
[ ] Multi-parcel schema exists
[ ] Physical scanning test passes
[ ] HTTPS production scanner works
```

---

# 129. Final Architecture

```text
                         SHOPIFY
                            |
                            v
                         ORDER
                            |
                            v
                         PARCEL
                            |
                 PKG-0000000001
                            |
                         BARCODE
                            |
                            v
                      PRINT LABEL
                            |
                            v
                    PHYSICAL PARCEL
                            |
                            v
                       PHONE CAMERA
                            |
                            v
                          ZXING
                            |
                            v
                    BARCODE STRING
                            |
                            v
                         FASTAPI
                            |
                            v
                       POSTGRESQL
                            |
                 ┌──────────┼──────────┐
                 v          v          v
             DISPATCH     RETURN      RTO
                 |
                 v
              SHIPMENT
                 |
            COURIER + AWB
                 |
                 v
              TRACKING
                 |
                 v
            RECONCILIATION
```

---

# 130. Final Product Principle

The barcode is not the product.

The barcode is the **physical identity bridge**.

The complete chain is:

```text
SHOPIFY ORDER
      ↓
PHYSICAL PARCEL
      ↓
INTERNAL BARCODE
      ↓
WAREHOUSE SCAN
      ↓
COURIER SHIPMENT
      ↓
AWB
      ↓
DELIVERY / RTO / RETURN
      ↓
MONEY / REFUND
      ↓
RECONCILIATION
```

This architecture allows the same parcel barcode to support:

```text
printing
packing

warehouse dispatch
return receiving
RTO receiving

courier tracking linkage

exception detection
monthly reporting
```

without changing the parcel's identity.

---

# 131. Technical References

- `bwip-js`: Code 128 generation and browser/server rendering: https://github.com/metafloor/bwip-js
- `@zxing/browser`: browser camera/video barcode decoding: https://github.com/zxing-js/browser
- MDN `BarcodeDetector`: browser support and secure-context notes: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- MDN `getUserMedia()`: camera permission and HTTPS/security requirements: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

Always pin and test the exact dependency versions used in production instead of using floating `latest` versions.
