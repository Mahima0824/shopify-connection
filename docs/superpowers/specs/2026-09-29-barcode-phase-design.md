# Barcode Phase Spec — Client Rendering, Labels, Mobile Scanner — 2026-09-29

Source: `barcode_generator_mobile_scanner_full_implementation_plan.md` (§§6–8, 10, 15–19, 24–28, 32–43, 52, 55, 62–67, 82–83, 90, 105, 108–112, 114–115, 128).
Format decision (user-approved): keep generating `P00000001`; validators accept `^P\d{8}$` (legacy) AND `^PKG-\d{10}$` (plan). Never re-encode existing parcels.

## 1. Goal
Print sharp client-rendered labels, manage/reprint them with audit, and scan parcels from a phone camera into the existing dispatch/return/RTO pipeline.

## 2. Backend (migration 0010)
- `parcels`: add `barcode_format VARCHAR default 'CODE128'` (informational; all values Code128).
- New `parcel_items` (id, business_id, parcel_id, order_item_id, quantity CHECK >= 0, created/updated): populated on parcel creation from order items (whole-order contents); future splits reuse it.
- Indexes: `shipments(business_id, awb_number)`, `parcels(business_id, status)`. (business+barcode unique + others already exist.)
- `barcode_service`: `normalize_barcode(v) = v.strip().upper()` (no char-stripping per §44/118); `validate_barcode_format(v) -> bool` accepting both formats; `ensure_parcel_for_order` also syncs parcel_items + sets barcode_format (idempotent, no new barcode on update).
- Scan endpoints accept optional `client_scan_id` (DispatchIn/ReturnIn): first-seen wins per (business, client_scan_id) — store in scan event_metadata; duplicate id returns the ORIGINAL result without new event. Needs `scan_events.device_id`? No schema change: metadata carries it; enforce via query on metadata? SQLite JSON query is awkward — implement as: query ScanEvent by business+metadata client id in Python loop over recent events? Too heavy. Simpler correct: UNIQUE constraint can't target JSON. Decision: keep in-memory? No — multi-worker. Pragmatic MVP: `client_scans` table (business_id, client_scan_id UNIQUE per business, result JSON, created_at). Small, exact, testable.
- New `POST /api/v1/scan/rto` (thin over record_return with return_type=RTO; same validation/audit). Existing return_type path untouched.
- Reprint audit: `POST /api/v1/parcels/{id}/reprint` (authed, any role with parcel view? WAREHOUSE+) → audit `LABEL_REPRINTED` + returns label HTML with REPRINT banner. No DB change to parcel.

## 3. Frontend rendering (bwip-js, pinned)
`npm install bwip-js@4.6.0` (verify latest 4.x at install; pin exact in package.json + lockfile).
- `components/barcode/ParcelBarcode.tsx`: props {value, scale?}; canvas via bwip-js code128 + human text; error state on invalid (validate client-side with same regexes, backend authoritative).
- `components/barcode/LabelPreview.tsx`: props {businessName, orderName, parcelCode, customer?, itemCount?}; white card, quiet-zone padding, dark-on-white, bwip SVG (`bwipjs.toSVG`) for print sharpness.
- `/parcels/labels`: today's parcels (created today) + missing-barcode filter (should be ~0 via backfill) + checkbox select + single-doc batch print (`window.print`, `.no-print` CSS, one label per `.label` block) + reprint button per row (calls reprint endpoint, shows REPRINT tag).
- Parcel detail: replace/augment SVG img with ParcelBarcode + Print + PNG download (keep existing server endpoints as fallback).

## 4. Mobile scanner (@zxing/browser, pinned)
`npm install @zxing/browser@0.1.5` (verify at install; pin exact).
- `components/scanner/BarcodeScanner.tsx`: props {onDetected, onError?, active?}; rear-camera preference (`facingMode: environment` + device list w/ Switch Camera button); continuous decode; same-value debounce 2.5s; unmount stops tracks + controls; explicit error codes CAMERA_PERMISSION_DENIED/NOT_FOUND/NOT_READABLE/DECODER_ERROR; timeout 30s idle → SCAN_TIMEOUT UI with Try Again; ManualBarcodeInput always rendered below.
- Wire into `/scan/dispatch` + `/scan/return` (camera section above manual input; detected value fills input + auto-submits? Plan §35 continuous: auto-submit on detect, debounce guards doubles) + new `/scan/rto` page (scan → confirm RTO via `/scan/rto` endpoint) + `/scan` hub (three big buttons + counters).
- HTTPS note in README (camera needs secure context; localhost OK).

## 5. Scanner test sheet + misc
- `/parcels/test-sheet`: renders ParcelBarcode for P00000001/P00000002/fixture barcodes + instructions to print for scanner-upgrade regression (§90 adapted to P-format).
- `/parcels` list page (Parcel ID/Order/Barcode/Status/Courier/AWB/Created + View/Print/Reprint actions).

## 6. Testing
Backend: normalize/validate both formats; parcel_items populated; client_scan_id retry returns original without new event; /scan/rto happy path + validation parity; reprint audit row; indexes present (smoke: EXPLAIN? No — assert migration SQL contains CREATE INDEX).
Frontend: ParcelBarcode renders canvas for valid + error state for invalid (jsdom canvas? bwip-js needs canvas — jsdom lacks it; test error-state + props contract only, document physical-test requirement); debounce unit test on pure helper `shouldSuppress(last, now)` extracted to `lib/scan-debounce.ts` (2.5s window).

## 7. Out of scope
Format migration P→PKG, thermal sizes, offline queue, sound/vibration (leave hooks commented? No — skip entirely), aggregator, native apps.

## 8. Acceptance (§128 adapted)
New order → parcel P… auto; backfill idempotent; bwip renders == server PNG value; batch print one doc; reprint same value + audit; phone camera → string → dispatch/return/RTO recorded; duplicates blocked; tenant isolation (B user scanning A value → NOT FOUND).
