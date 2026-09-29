# Reusable Barcode Parcel System — Implementation Plan

## 1. Goal

Build a parcel/barcode system where:

- A large pool of reusable barcode IDs is generated in advance.
- A barcode is **not permanently linked to an order**.
- A worker assigns an available barcode to a parcel when preparing it for dispatch.
- The worker enters customer/order/parcel details **once**.
- The system remembers the relationship and automatically retrieves it whenever the barcode is scanned.
- Scanning a barcode that is already actively assigned to another parcel is blocked.
- A return scanner can scan the same parcel barcode and automatically identify the parcel/customer/order and create a return workflow.
- After a parcel lifecycle is closed, its barcode can return to the `AVAILABLE` pool and be reused.
- Every previous assignment remains in history.

## 2. Important Design Rule

Do **not** treat the barcode as the order itself.

Use this relationship:

```text
Barcode
   ↓
Current / Historical Parcel Assignment
   ↓
Order
   ↓
Customer
```

The barcode is a reusable physical identifier. The database stores who/what it currently represents.

---

# 3. Recommended Stack

## Frontend

- React + TypeScript
- Vite or Next.js
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query
- Barcode scanning library using the device camera

## Backend

- Node.js + Express.js + TypeScript
- REST API

Alternative:
- FastAPI if the backend is implemented in Python.

## Database

- PostgreSQL

PostgreSQL is appropriate because the system needs:

- Unique constraints
- Transactions
- Relationships
- Historical records
- Fast indexed barcode lookup
- Reliable concurrent assignment

## Barcode

Use **Code 128** for the physical barcode.

Important: Code 128 does **not** mean 128-bit storage. It is simply a barcode symbology.

Example encoded value:

```text
PKG-000001
```

or a stronger identifier:

```text
BC-7F3A91C82D
```

---

# 4. Barcode Pool

Generate a fixed pool initially.

Example:

```text
100,000 barcode IDs
```

Possible values:

```text
BC-00000001
BC-00000002
BC-00000003
...
BC-00100000
```

Recommended database state:

```text
AVAILABLE
ASSIGNED
IN_TRANSIT
DELIVERED
RETURN_RECEIVED
RETURN_INSPECTION
CLOSED
```

However, the barcode itself should not permanently remain in `DELIVERED` forever.

A better lifecycle is:

```text
AVAILABLE
    ↓
ASSIGNED
    ↓
IN_TRANSIT
    ↓
DELIVERED
    ↓
RETURN_RECEIVED (only if returned)
    ↓
RETURN_INSPECTION
    ↓
CLOSED
    ↓
AVAILABLE
```

A barcode can be reused **only after the previous parcel lifecycle is closed**.

---

# 5. Why Reusable Barcodes Are Better Here

Example:

```text
BC-00001234
```

First use:

```text
BC-00001234
   ↓
Parcel P-1001
   ↓
Order ORD-5001
   ↓
Customer Rahul
```

After the complete lifecycle:

```text
Parcel P-1001 → CLOSED
```

The barcode becomes:

```text
AVAILABLE
```

Later:

```text
BC-00001234
   ↓
Parcel P-2045
   ↓
Order ORD-6500
   ↓
Customer Amit
```

The old relationship is not deleted. It remains in the assignment history.

---

# 6. Barcode Sticker Design

The physical sticker should contain both machine-readable and human-readable information.

Recommended label:

```text
┌───────────────────────────────────────┐
│              COMPANY LOGO             │
│                                       │
│  SHIPMENT / PARCEL                    │
│                                       │
│  █ ▌██ ▌█ ▌███ ▌█ ██ ▌██ ▌█          │
│  ███ ▌█ ██ ▌█ ▌██ ▌███ ▌█             │
│                                       │
│          BC-00001234                  │
│                                       │
│  Customer: Rahul Sharma               │
│  Mobile:   +91 XXXXX XXXXX            │
│  Address:  12 MG Road                 │
│  City:     Mumbai                     │
│  State:    Maharashtra                │
│  Pincode:  400001                     │
│                                       │
│  Order: ORD-5001                      │
│  Parcel: P-1001                       │
└───────────────────────────────────────┘
```

## What should be encoded in the barcode?

Prefer encoding only:

```text
BC-00001234
```

Do **not** encode the full address/mobile/order details into Code 128.

Why?

- Smaller barcode
- Faster scanning
- Less sensitive information in the barcode
- Customer/address information can change without regenerating the barcode
- Database remains the source of truth

The printed text can display the details, while the barcode itself only identifies the parcel/barcode record.

---

# 7. Privacy Recommendation

Because the sticker contains customer information, do not print more information than operationally necessary.

Recommended:

```text
Customer: Rahul S.
Mobile: XXX XXX 1234
Address: 12 MG Road
City: Mumbai
Pincode: 400001
```

If the carrier/warehouse does not need the full mobile number, mask it.

Do not put sensitive information into the barcode payload itself.

---

# 8. Database Design

## `barcodes`

```sql
CREATE TABLE barcodes (
    id BIGSERIAL PRIMARY KEY,

    barcode_value VARCHAR(64) NOT NULL UNIQUE,

    status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Example:

```text
id | barcode_value | status
---|---------------|----------
1  | BC-00000001   | AVAILABLE
2  | BC-00000002   | ASSIGNED
3  | BC-00000003   | AVAILABLE
```

---

## `customers`

```sql
CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL,

    mobile VARCHAR(30) NOT NULL,

    email VARCHAR(255),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## `addresses`

```sql
CREATE TABLE addresses (
    id BIGSERIAL PRIMARY KEY,

    customer_id BIGINT REFERENCES customers(id),

    address_line_1 TEXT NOT NULL,

    address_line_2 TEXT,

    city VARCHAR(100) NOT NULL,

    state VARCHAR(100) NOT NULL,

    country VARCHAR(100) NOT NULL DEFAULT 'India',

    pincode VARCHAR(10) NOT NULL
);
```

Use `VARCHAR` for pincode rather than integer so leading zeroes are preserved.

---

## `orders`

```sql
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,

    order_number VARCHAR(100) NOT NULL UNIQUE,

    customer_id BIGINT NOT NULL REFERENCES customers(id),

    address_id BIGINT NOT NULL REFERENCES addresses(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## `parcels`

```sql
CREATE TABLE parcels (
    id BIGSERIAL PRIMARY KEY,

    parcel_number VARCHAR(100) NOT NULL UNIQUE,

    order_id BIGINT NOT NULL REFERENCES orders(id),

    customer_id BIGINT NOT NULL REFERENCES customers(id),

    address_id BIGINT NOT NULL REFERENCES addresses(id),

    status VARCHAR(40) NOT NULL DEFAULT 'CREATED',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 9. Barcode Assignment History

This is the most important table for reusable barcodes.

```sql
CREATE TABLE barcode_assignments (
    id BIGSERIAL PRIMARY KEY,

    barcode_id BIGINT NOT NULL REFERENCES barcodes(id),

    parcel_id BIGINT NOT NULL REFERENCES parcels(id),

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    released_at TIMESTAMPTZ,

    active BOOLEAN NOT NULL DEFAULT TRUE
);
```

Add a database rule so one barcode cannot have two active assignments:

```sql
CREATE UNIQUE INDEX one_active_assignment_per_barcode
ON barcode_assignments(barcode_id)
WHERE active = TRUE;
```

This is critical.

Even if two workers click "Assign" at almost exactly the same time, PostgreSQL prevents the same barcode from having two active assignments.

---

# 10. Parcel Status History

Do not overwrite history.

Create an event table:

```sql
CREATE TABLE parcel_events (
    id BIGSERIAL PRIMARY KEY,

    parcel_id BIGINT NOT NULL REFERENCES parcels(id),

    event_type VARCHAR(50) NOT NULL,

    location VARCHAR(255),

    performed_by BIGINT,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Example:

```text
Parcel P-1001

CREATED
ASSIGNED
PACKED
DISPATCHED
IN_TRANSIT
DELIVERED
RETURN_RECEIVED
RETURN_INSPECTION
CLOSED
```

---

# 11. Assignment Workflow

## Step 1 — Worker opens Create Parcel

UI:

```text
┌─────────────────────────────────────────────┐
│ Create Parcel                               │
├─────────────────────────────────────────────┤
│                                             │
│ Barcode                                     │
│ [ BC-00001234                    ] [SCAN]   │
│                                             │
│ Customer                                    │
│ [ Rahul Sharma                    ]         │
│                                             │
│ Mobile                                      │
│ [ +91 XXXXX XXXXX                ]          │
│                                             │
│ Address                                     │
│ [ 12 MG Road                    ]            │
│                                             │
│ City                                        │
│ [ Mumbai                         ]           │
│                                             │
│ State                                       │
│ [ Maharashtra                   ]            │
│                                             │
│ Pincode                                     │
│ [ 400001                         ]           │
│                                             │
│ Order Number                                │
│ [ ORD-5001                      ]            │
│                                             │
│ Product                                     │
│ [ iPhone 15                    ]             │
│                                             │
│ Quantity                                    │
│ [ 1 ]                                       │
│                                             │
│             [ ASSIGN BARCODE ]              │
└─────────────────────────────────────────────┘
```

---

# 12. Barcode Validation

When worker enters/scans:

```text
BC-00001234
```

Frontend calls:

```http
GET /api/barcodes/BC-00001234
```

Backend returns:

```json
{
  "barcode": "BC-00001234",
  "status": "AVAILABLE",
  "canAssign": true
}
```

UI:

```text
✓ Barcode available
```

If already active:

```json
{
  "barcode": "BC-00001234",
  "status": "ASSIGNED",
  "canAssign": false
}
```

UI:

```text
┌────────────────────────────────────┐
│ ❌ BARCODE ALREADY IN USE           │
│                                    │
│ Barcode: BC-00001234               │
│ Current Parcel: P-1001             │
│ Current Status: IN_TRANSIT         │
│                                    │
│ This barcode cannot be assigned.   │
└────────────────────────────────────┘
```

---

# 13. Race Condition Protection

Do not rely only on frontend validation.

Bad:

```text
Frontend checks AVAILABLE
        ↓
Worker A assigns
Worker B assigns
```

Both may see AVAILABLE.

Instead use a PostgreSQL transaction:

```text
BEGIN

Lock barcode row

Check active assignment

If active:
    ROLLBACK

Else:
    Create parcel
    Create assignment
    Change barcode status
    Create event

COMMIT
```

The database is the final authority.

---

# 14. Dispatch Scanner

Create a dedicated screen:

```text
┌──────────────────────────────────────────────┐
│              DISPATCH SCANNER                │
├──────────────────────────────────────────────┤
│                                              │
│             ┌─────────────────┐              │
│             │                 │              │
│             │   CAMERA        │              │
│             │   SCANNER       │              │
│             │                 │              │
│             └─────────────────┘              │
│                                              │
│          [ Scan Barcode ]                    │
│                                              │
│ Or enter manually:                          │
│ [ BC-00001234                 ] [SEARCH]     │
└──────────────────────────────────────────────┘
```

After scanning:

```text
┌──────────────────────────────────────────────┐
│ ✓ PARCEL FOUND                               │
├──────────────────────────────────────────────┤
│ Barcode: BC-00001234                         │
│ Parcel: P-1001                               │
│ Order: ORD-5001                              │
│                                              │
│ Rahul Sharma                                 │
│ +91 XXXXX XXXXX                              │
│                                              │
│ 12 MG Road                                   │
│ Mumbai, Maharashtra                          │
│ 400001                                       │
│                                              │
│ Status: READY_TO_DISPATCH                    │
│                                              │
│ [ MARK AS DISPATCHED ]                       │
└──────────────────────────────────────────────┘
```

---

# 15. Return Scanner

Create a separate return screen:

```text
┌──────────────────────────────────────────────┐
│               RETURN SCANNER                 │
├──────────────────────────────────────────────┤
│                                              │
│              [ OPEN CAMERA ]                 │
│                                              │
│ Barcode:                                     │
│ [ BC-00001234                   ] [SCAN]     │
│                                              │
└──────────────────────────────────────────────┘
```

After scan:

```text
┌──────────────────────────────────────────────┐
│ ✓ PARCEL IDENTIFIED                          │
├──────────────────────────────────────────────┤
│ Parcel: P-1001                               │
│ Order: ORD-5001                              │
│ Customer: Rahul Sharma                       │
│                                              │
│ Product: iPhone 15                           │
│                                              │
│ Original Status: DELIVERED                   │
│                                              │
│ [ RECEIVE RETURN ]                            │
└──────────────────────────────────────────────┘
```

Clicking `RECEIVE RETURN` automatically:

```text
parcel.status = RETURN_RECEIVED
```

and creates:

```text
parcel_events:
RETURN_RECEIVED
```

No need to manually enter customer information again.

---

# 16. Return Workflow

```text
DELIVERED
    ↓
Customer returns parcel
    ↓
Worker opens Return Scanner
    ↓
Scan barcode
    ↓
System finds parcel
    ↓
RETURN_RECEIVED
    ↓
RETURN_INSPECTION
    ↓
 ┌───────────────┐
 │ Product okay? │
 └──────┬────────┘
    YES │ NO
       ↓   ↓
 RESTOCK   DAMAGED
    ↓         ↓
 REFUND /    REFUND /
 REPLACEMENT REPLACEMENT
    ↓
 CLOSED
    ↓
Barcode AVAILABLE
```

---

# 17. Barcode Label Generation

Backend endpoint:

```http
POST /api/barcodes/generate
```

Request:

```json
{
  "quantity": 10000
}
```

Backend generates:

```text
BC-00000001
BC-00000002
...
BC-00010000
```

Each barcode is inserted into PostgreSQL with:

```text
status = AVAILABLE
```

Then create a print-ready label document containing:

- Barcode
- Human-readable barcode value
- Customer information if assigned
- Address
- Mobile
- Pincode
- Order number
- Parcel number

For bulk blank barcode generation, print only:

```text
Logo
Barcode
Barcode value
```

Do not print customer information until the barcode is assigned to a parcel.

---

# 18. Recommended Two-Stage Label System

This is better than printing customer information on 100,000 blank stickers.

### Stage 1 — Generate reusable barcode stickers

```text
┌─────────────────────┐
│      COMPANY        │
│                     │
│   || || || ||||     │
│   ||| |||| || ||    │
│                     │
│    BC-00001234      │
└─────────────────────┘
```

These are reusable physical barcode labels.

### Stage 2 — Parcel-specific shipping label

When a barcode is assigned:

```text
┌─────────────────────────────┐
│        SHIP TO              │
│                             │
│ Rahul Sharma                │
│ +91 XXXXX XXXXX             │
│ 12 MG Road                  │
│ Mumbai                      │
│ Maharashtra                 │
│ 400001                      │
│                             │
│ Order: ORD-5001             │
│ Parcel: P-1001              │
│                             │
│ Barcode: BC-00001234        │
└─────────────────────────────┘
```

This gives you flexibility.

---

# 19. UI Style

Use a professional warehouse/admin dashboard.

## Colors

Primary:

```text
Dark Navy / Slate
```

Success:

```text
Green
```

Warning:

```text
Amber
```

Error:

```text
Red
```

Background:

```text
#F8FAFC
```

Cards:

```text
White
```

Do not use excessive gradients or decorative animations. This is an operational application.

---

# 20. Dashboard

```text
┌────────────────────────────────────────────────────┐
│ Parcel Management                    👤 Admin      │
├────────────┬───────────────────────────────────────┤
│            │                                       │
│ Dashboard  │  Today's Overview                     │
│            │                                       │
│ Dispatch   │  ┌────────┐ ┌────────┐ ┌────────┐    │
│            │  │  1,245 │ │   842  │ │   123  │    │
│ Returns    │  │ Orders │ │Dispatched│ │Returns│   │
│            │  └────────┘ └────────┘ └────────┘    │
│ Barcodes   │                                       │
│            │  Barcode Pool                         │
│ Parcels    │  Available: 8,421                    │
│            │  Assigned: 1,120                     │
│ Customers  │                                       │
│            │  Recent Activity                     │
│ Settings   │  BC-000123 → Dispatched             │
│            │  BC-000456 → Return Received         │
└────────────┴───────────────────────────────────────┘
```

---

# 21. Barcode Pool Management

Screen:

```text
Barcode Pool

Total:       100,000
Available:    87,450
Assigned:     10,250
Active:        2,300

[ Generate More ]
[ Print Available Barcodes ]

Search:
[ BC-00001234                 ]

Status:
[ All ▼ ]
```

Table:

```text
Barcode       Status       Parcel       Updated
-----------------------------------------------------
BC-000001     AVAILABLE    —            10:22
BC-000002     ASSIGNED     P-1022       10:30
BC-000003     DELIVERED    P-1023       09:50
BC-000004     AVAILABLE    —            09:42
```

---

# 22. Parcel Details Page

```text
Parcel P-1001

┌─────────────────────────────────────┐
│ Status: ● IN TRANSIT                │
│                                     │
│ Barcode: BC-00001234                │
│ Order: ORD-5001                     │
└─────────────────────────────────────┘

Customer
---------------------------------------
Rahul Sharma
+91 XXXXX XXXXX

Delivery Address
---------------------------------------
12 MG Road
Mumbai
Maharashtra
400001

Items
---------------------------------------
iPhone 15 × 1

Timeline
---------------------------------------
✓ Created
✓ Assigned
✓ Packed
✓ Dispatched
● In Transit
○ Delivered
```

---

# 23. API Design

## Barcode APIs

```http
POST   /api/barcodes/generate
GET    /api/barcodes/:barcode
GET    /api/barcodes?status=AVAILABLE
POST   /api/barcodes/:barcode/assign
POST   /api/barcodes/:barcode/release
```

## Parcel APIs

```http
POST   /api/parcels
GET    /api/parcels/:id
GET    /api/parcels/barcode/:barcode
PATCH  /api/parcels/:id/status
```

## Scanner APIs

```http
POST /api/scanner/dispatch
POST /api/scanner/return
```

Example:

```json
{
  "barcode": "BC-00001234"
}
```

Backend returns parcel information.

---

# 24. Important Backend Rule

Never trust the frontend.

Frontend says:

```text
Barcode available
```

Backend must independently verify:

```text
Does barcode exist?
Is it active?
Does it already have an active assignment?
Is the requested transition valid?
Does the authenticated worker have permission?
```

---

# 25. Status Transition Rules

Do not allow arbitrary status changes.

Example:

```text
CREATED
  ↓
ASSIGNED
  ↓
PACKED
  ↓
READY_TO_DISPATCH
  ↓
DISPATCHED
  ↓
IN_TRANSIT
  ↓
DELIVERED
```

Return:

```text
DELIVERED
  ↓
RETURN_RECEIVED
  ↓
RETURN_INSPECTION
  ↓
CLOSED
```

If a worker tries:

```text
DELIVERED → DISPATCHED
```

the backend should reject it unless your business rules explicitly allow that operation.

---

# 26. Security

Implement:

- Authentication
- Role-based authorization
- Admin role
- Warehouse worker role
- Return worker role
- Audit logs
- Rate limiting
- Server-side validation
- Zod validation
- PostgreSQL transactions
- HTTPS
- Input sanitization

Example roles:

```text
ADMIN
WAREHOUSE_WORKER
DISPATCH_WORKER
RETURN_WORKER
```

A return worker should not automatically have permission to edit customer addresses.

---

# 27. Search and Performance

Create indexes:

```sql
CREATE INDEX idx_barcode_status
ON barcodes(status);

CREATE INDEX idx_parcel_status
ON parcels(status);

CREATE INDEX idx_parcel_events_parcel
ON parcel_events(parcel_id);

CREATE INDEX idx_barcode_assignments_parcel
ON barcode_assignments(parcel_id);
```

Barcode lookup should be extremely fast because:

```sql
barcode_value VARCHAR(64) UNIQUE
```

automatically provides a unique index.

---

# 28. Concurrency

This matters if multiple workers are using scanners simultaneously.

Scenario:

```text
Worker A → scans BC-00001234
Worker B → scans BC-00001234
```

Only one assignment must succeed.

Use:

```text
Database transaction
+
row locking
+
partial unique index
```

Never solve this only with React state.

---

# 29. Barcode Generation Strategy

You do not need 128-bit identifiers.

For your physical barcode pool, a sequential ID is perfectly practical:

```text
BC-00000001
BC-00000002
...
BC-00100000
```

If you don't want workers to guess IDs, use a random/cryptographically generated value:

```text
BC-7F3A91C82D
```

For a large system, a strong random identifier is preferable for external-facing IDs.

---

# 30. Do Not Generate 100 Million Physical Stickers

You technically could generate huge numbers of unique identifiers, but there is no operational reason to print them all.

Start with:

```text
10,000–100,000 physical barcode stickers
```

depending on expected parcel volume.

When the available pool becomes low:

```text
Available < 10%
```

automatically generate/print another batch.

Example:

```text
100,000 total
↓
Available falls below 10,000
↓
System alerts admin
↓
Generate 50,000 more
```

---

# 31. Recommended Final Architecture

```text
                 ┌────────────────────┐
                 │      FRONTEND      │
                 │ React + TypeScript │
                 └─────────┬──────────┘
                           │
                         REST
                           │
                 ┌─────────▼──────────┐
                 │       BACKEND      │
                 │ Node/Express/TS    │
                 └─────────┬──────────┘
                           │
                 ┌─────────▼──────────┐
                 │     PostgreSQL     │
                 │                    │
                 │ Barcodes           │
                 │ Parcels            │
                 │ Orders             │
                 │ Customers          │
                 │ Assignments        │
                 │ Events             │
                 └────────────────────┘

                         ▲
                         │
                 Barcode Scanner
                         │
               ┌─────────┴──────────┐
               │                    │
         Dispatch Scanner     Return Scanner
```

---

# 32. End-to-End Example

### Phase 1 — Barcode preparation

```text
Generate 100,000 IDs
        ↓
BC-00000001 ... BC-00100000
        ↓
Generate Code 128 images
        ↓
Print stickers
        ↓
status = AVAILABLE
```

### Phase 2 — Parcel creation

```text
Worker scans BC-00001234
        ↓
System checks availability
        ↓
AVAILABLE ✓
        ↓
Worker enters customer/order/address
        ↓
Create Parcel P-1001
        ↓
Assign BC-00001234
        ↓
Barcode status = ASSIGNED
```

### Phase 3 — Dispatch

```text
Worker scans BC-00001234
        ↓
System finds P-1001
        ↓
Shows customer/address/order
        ↓
Worker confirms dispatch
        ↓
Status = DISPATCHED
```

### Phase 4 — Delivery

```text
DISPATCHED
   ↓
IN_TRANSIT
   ↓
DELIVERED
```

### Phase 5 — Return

```text
Customer returns parcel
        ↓
Return worker scans BC-00001234
        ↓
System automatically identifies P-1001
        ↓
RETURN_RECEIVED
        ↓
RETURN_INSPECTION
```

### Phase 6 — Reuse

```text
Return completed
        ↓
Parcel lifecycle CLOSED
        ↓
Release BC-00001234
        ↓
status = AVAILABLE
        ↓
Can be assigned to another parcel
```

---

# 33. Implementation Order

Build it in this order:

### Phase 1 — Database

1. `customers`
2. `addresses`
3. `orders`
4. `parcels`
5. `barcodes`
6. `barcode_assignments`
7. `parcel_events`

### Phase 2 — Barcode pool

1. Generate IDs
2. Store them
3. Generate Code 128 images
4. Build bulk-print layout
5. Add available/assigned filtering

### Phase 3 — Parcel assignment

1. Scan/type barcode
2. Validate availability
3. Enter customer/address/order
4. Create parcel
5. Assign barcode transactionally
6. Record event

### Phase 4 — Dispatch scanner

1. Camera scanner
2. Manual barcode fallback
3. Parcel lookup
4. Display details
5. Status transition
6. Event logging

### Phase 5 — Return scanner

1. Camera scanner
2. Lookup parcel
3. Verify eligible return status
4. Create return event
5. Update status
6. Return inspection

### Phase 6 — Dashboard

1. Parcel statistics
2. Barcode pool statistics
3. Recent scans
4. Active parcels
5. Returns
6. Search/filter

### Phase 7 — Security

1. Authentication
2. Roles
3. Authorization
4. Audit logs
5. Rate limiting
6. Transaction protection

### Phase 8 — Production

1. PostgreSQL deployment
2. Backend deployment
3. Frontend deployment
4. HTTPS
5. Database backups
6. Monitoring
7. Error logging
8. Barcode printer integration

---

# 34. Final Principle

The system should behave like this:

```text
                 BARCODE
                    ↓
             "Who am I?"
                    ↓
                DATABASE
                    ↓
          ┌─────────┴─────────┐
          ↓                   ↓
       CURRENT             HISTORY
      PARCEL DATA          OF USES
          ↓
 Customer / Address
 Order / Products
 Status / Events
```

The worker should **scan**, not repeatedly type.

The database should be the **source of truth**.

The barcode should be a **reusable physical identifier**.

The assignment table should prevent **duplicate active usage**.

The event table should preserve **complete parcel history**.

And the return scanner should identify the parcel automatically from the barcode.
