# India Post New Order + Filters — Design Spec
Date: 2026-10-01
Status: Approved (user said "do")
Source Excel: `19082026.xlsx` sheet `ArticleDetails` A1:AV29

## 1. Goal
Change Orders route to support manual `New Order` creation matching the 48-column India Post bulk import format, with per-field worker help, plus full filters (COD-wise, date-wise, status + city/pincode + search) and direct-importable Excel download.

## 2. Evidence (verified)
- Excel header (48 cols, exact order):
  SERIAL NUMBER, BARCODE NO, PHYSICAL WEIGHT, SHAPE OF ARTICLE, LENGTH, BREADTH/DIAMETER, HEIGHT, PRIORITY FLAG, DELIVERY INSTRUCTION, INSTRUCTION RTS, SENDER NAME, SENDER COMPANY, SENDER ADD LINE 1, SENDER ADD LINE 2, SENDER CITY, SENDER STATE, SENDER PINCODE, SENDER EMAILID, SENDER ALT CONTACT, SENDER KYC, SENDER TAX REFERENCE, RECEIVER NAME, RECEIVER COMPANY, RECEIVER ADD LINE 1, RECEIVER ADD LINE 2, RECEIVER CITY, RECEIVER STATE, RECEIVER PINCODE, RECEIVER EMAILID, RECEIVER ALT CONTACT, RECEIVER KYC, RECEIVER TAX REFERENCE, ALT ADDRESS FLAG, PICKUP ADDRESS FLAG, DROP OFF PINCODE, DROPOFF/PICKUP OFFICE ID, SENDER MOBILE NO, RECEIVER MOBILE NO, PREPAYMENT CODE, VALUE OF PREPAYMENT, CODR/COD, VALUE FOR CODR/COD, INSURANCE TYPE, VALUE OF INSURANCE, ACK, REGISTRATION, OTP BASED DELIVERY, BULK REFERENCE
- Sample rows: sender fixed Reshamgath / FF-138/139 Rajhans Imperia Ring Road / Surat Gujarat 395002 / 9016822651; shape NROL 30x20x5; weight 925-960; CODR/COD=COD, value 1250/1350; ALT/PICKUP flags FALSE; drop 394210.
- Current frontend: `web/src/pages/Orders.tsx`, `web/src/components/OrderTable.tsx` — Shopify sync + CSV import only, single `search` input, no create, no COD/date/status filters.
- Current backend: `backend/app/api/orders.py` (`GET /api/v1/orders?search&status&page&page_size`), `backend/app/services/order_service.py::list_orders(search,status)`, `backend/app/models/order.py::Order` (Shopify-centric, no India Post address/COD columns).

## 3. Decisions (from clarifications)
- Save to DB + Excel download (not frontend-only).
- Full filter set: search + COD-wise + date-wise + status + city/pincode.
- Worker help = helper text + placeholder + inline validation per input (not background worker).

## 4. Approach Selected: A — DB-backed + exact Excel export
Rejected B (frontend-only, no persistence/filters) and C (separate manifest page, splits UX).

## 5. Architecture
- Extend `orders` table with nullable India Post columns (migration `0012`+): receiver_name/company/add1/add2/city/state/pincode/email/alt_contact/kyc/tax_ref/mobile, sender_* override columns (default from constants), weight_grams, length/breadth/height, shape, barcode_no, bulk_reference, cod_mode (COD|PREPAID), cod_value, prepayment_code/value, insurance_type/value, priority_flag, delivery_instruction, instruction_rts, alt_address_flag, pickup_address_flag, dropoff_pincode, dropoff_office_id, ack/registration/otp flags.
- Sender defaults constant: Reshamgath / Surat / Gujarat / 395002 / 9016822651 (editable in dialog, collapsible).
- Backend endpoints:
  - `POST /api/v1/orders` — manual create, returns envelope `{success,data}`.
  - `GET /api/v1/orders?search&cod_mode&date_from&date_to&status&city&pincode&page&page_size` — extended filter query.
  - `GET /api/v1/orders/export/india-post.xlsx?{same filters}` or `POST .../export` with ids — generates xlsx with openpyxl, exact 48 header strings/order, correct types (numbers numeric, flags boolean FALSE, empty as None).
  - `GET /api/v1/orders/{id}/export/india-post.xlsx` — single-order download.
- Frontend `Orders.tsx`: `New Order` button → dialog; filter bar (search input + COD dropdown + date range + status dropdown + city/pincode inputs + Clear); `Export filtered (.xlsx)` + per-row download; reuse `OrderTable` extended with COD + pincode + city columns.
- Excel writer is the contract: byte-compare header test ensures India Post direct import with no manual edits.

## 6. Components / Dialog (5 groups, helper text each)
1. Sender (prefilled, collapsible): name/company/add1/add2/city/state/pincode/mobile/email/kyc/tax. Help e.g. "PINCODE 6 digits".
2. Receiver (required): name, mobile 10-digit, add1, city, state, pincode 6-digit (auto-copies to DROP OFF PINCODE, editable), email, alt-contact, kyc, tax. Help e.g. "Used for DROP OFF PINCODE".
3. Parcel: SERIAL auto, BARCODE auto `EG...IN` or blank, PHYSICAL WEIGHT grams >0, SHAPE default NROL, L/B/H defaults 30/20/5, priority/delivery/RTS, bulk ref.
4. COD/Insurance: CODR/COD dropdown COD|PREPAID (maps cod_mode, financial_status), VALUE FOR COD required if COD, prepayment code/value, insurance type/value, ACK/REGISTRATION/OTP checkboxes.
5. Flags: ALT ADDRESS FLAG, PICKUP ADDRESS FLAG (bool), DROPOFF/PICKUP OFFICE ID.
- Validation blocks save on: pincode/mobile format, weight>0, COD value required if COD, receiver name/address/city/state/pincode present. Inline errors, no silent coerce.

## 7. Data Flow
Fill → inline validate → POST → list shows new order → Download single or filtered-bulk xlsx → import file directly in India Post portal.
Filters: search → name/barcode/mobile/order name; cod_mode → COD|PREPAID; date_from/to → order_date range; status → operational_status; city/pincode → receiver city/pincode. All combine with AND, drive both list and export.

## 8. Error Handling
- 422 returns field-level messages shown under inputs.
- Export with 0 rows → warning toast, no empty download.
- India Post rejection (if portal changes spec) → fix writer mapping only, no dialog change needed.
- No secrets in frontend; sender defaults are non-secret business address.

## 9. Testing
- Backend: extend `backend/tests/test_route_order.py` — create manual COD + PREPAID, filter cod_mode/date/status/pincode, export header exact-match (48 strings in order), single-row values match input.
- Frontend: extend `web/tests/orders.test.tsx` — dialog opens, helper texts present, validation blocks bad pincode, filter bar calls API with correct params, export button triggers download.
- Manual: download from app, open `19082026.xlsx` side-by-side, import test file in India Post test/upload (user acceptance).

## 10. Out of Scope
- No courier API booking (India Post API per `courier_integration_india_post_dtdc_implementation_plan.md` stays separate).
- No AWB/tracking auto-fill; BARCODE NO is user/auto-generated, not courier-returned AWB.
- No change to Shopify sync flow; manual orders have null `shopify_order_id`.

## 11. Self-Review
- No TBD/TODO; requirements explicit.
- Consistent: DB save + export + filters all on same field set.
- Scoped to single Orders route change; no second exception system, no new auth.
- Ambiguity resolved: worker=helper text, sender prefilled but editable, DROP OFF PINCODE defaults to receiver pincode.
